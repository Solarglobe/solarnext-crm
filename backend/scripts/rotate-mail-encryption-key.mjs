/** Standalone: never imports app environment loaders, migration runner or workers.
 * Default: dry run. Secrets only through the dedicated process environment.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createMailCipher } from "../services/security/encryption.service.js";
import { rotateMailSecrets } from "../services/security/mailSecretRotation.js";
import { mailCryptoError } from "../services/security/mailKeyring.js";

export function parseRotationArgs(args) {
  const options = { mode: "dry-run", batchSize: 100 };
  let modeSet = false;
  const fields = new Map([["--batch-size", "batchSize"], ["--confirm-database", "database"], ["--confirm-active-key", "activeId"], ["--dry-run-report", "preflightReport"], ["--report", "report"]]);
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--dry-run", "--apply", "--verify-active-only"].includes(arg)) {
      if (modeSet) throw mailCryptoError("MAIL_ROTATION_ARGUMENTS_INVALID");
      options.mode = arg.slice(2); modeSet = true;
    } else if (fields.has(arg) && args[i + 1] && !args[i + 1].startsWith("--")) {
      const field = fields.get(arg);
      if (options[field] !== undefined && field !== "batchSize") throw mailCryptoError("MAIL_ROTATION_ARGUMENTS_INVALID");
      options[field] = args[++i];
    } else throw mailCryptoError("MAIL_ROTATION_ARGUMENTS_INVALID");
  }
  options.batchSize = Number(options.batchSize);
  if (!Number.isInteger(options.batchSize) || options.batchSize < 1 || options.batchSize > 1000) throw mailCryptoError("MAIL_ROTATION_ARGUMENTS_INVALID");
  if (!options.database || !options.activeId) throw mailCryptoError("MAIL_ROTATION_TARGET_CONFIRMATION_REQUIRED");
  if (options.mode === "apply" && !options.preflightReport) throw mailCryptoError("MAIL_ROTATION_DRY_RUN_REPORT_REQUIRED");
  return options;
}

export function connectionOptions(env, mode) {
  let url;
  try { url = new URL(env.MAIL_ROTATION_DATABASE_URL); } catch { throw mailCryptoError("MAIL_ROTATION_DATABASE_REQUIRED"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2 || url.hash) throw mailCryptoError("MAIL_ROTATION_DATABASE_INVALID");
  // Do not inherit PGHOST/PGDATABASE/PGOPTIONS or application DATABASE_URL.
  if ([...url.searchParams.keys()].some(k => !["sslmode"].includes(k))) throw mailCryptoError("MAIL_ROTATION_DATABASE_INVALID");
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode && !["disable", "verify-full"].includes(sslmode)) throw mailCryptoError("MAIL_ROTATION_DATABASE_INVALID");
  return {
    host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)),
    ssl: sslmode === "verify-full" ? { rejectUnauthorized: true } : false,
    application_name: "mail-key-rotation", connectionTimeoutMillis: 5000,
    options: `-c default_transaction_read_only=${mode === "apply" ? "off" : "on"} -c statement_timeout=15000 -c lock_timeout=1000`,
  };
}

export function validatePreflight(report, target, activeId, now = Date.now()) {
  if (report?.version !== 1 || report.mode !== "dry-run" || !report.result?.completed || report.result.totals.errors !== 0 || report.active_key_id !== activeId || JSON.stringify(report.target) !== JSON.stringify(target)) throw mailCryptoError("MAIL_ROTATION_DRY_RUN_REPORT_INVALID");
  const age = now - Date.parse(report.at);
  if (!Number.isFinite(age) || age < 0 || age > 3600000) throw mailCryptoError("MAIL_ROTATION_DRY_RUN_REPORT_EXPIRED");
}

async function main() {
  let client;
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const options = parseRotationArgs(process.argv.slice(2));
    const cipher = createMailCipher();
    if (cipher.activeId !== options.activeId) throw mailCryptoError("MAIL_ROTATION_ACTIVE_KEY_MISMATCH");
    const configuration = connectionOptions(process.env, options.mode);
    if (configuration.database !== options.database) throw mailCryptoError("MAIL_ROTATION_DATABASE_MISMATCH");
    // Reserve the audit destination before any write. Never overwrite a receipt.
    let reportFd;
    if (options.report) reportFd = fs.openSync(options.report, "wx", 0o600);
    try {
      const { Client } = (await import("pg")).default;
      client = new Client(configuration);
      client.on("error", stop);
      await client.connect();
      const identity = (await client.query("SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port")).rows[0];
      if (identity.database !== options.database) throw mailCryptoError("MAIL_ROTATION_DATABASE_MISMATCH");
      const target = { host: configuration.host, database: identity.database, address: identity.address, port: identity.port };
      if (options.mode === "apply") {
        let report;
        try { report = JSON.parse(fs.readFileSync(options.preflightReport, "utf8")); } catch { throw mailCryptoError("MAIL_ROTATION_DRY_RUN_REPORT_INVALID"); }
        validatePreflight(report, target, cipher.activeId);
      }
      const result = await rotateMailSecrets({ client, cipher, mode: options.mode, batchSize: options.batchSize, signal: controller.signal });
      const report = { version: 1, at: new Date().toISOString(), mode: options.mode, active_key_id: cipher.activeId, target, result };
      if (reportFd !== undefined) { fs.writeFileSync(reportFd, JSON.stringify(report, null, 2)); fs.fsyncSync(reportFd); }
      console.log(JSON.stringify(report));
      if (!result.completed) process.exitCode = result.interrupted ? 130 : 1;
    } finally { if (reportFd !== undefined) fs.closeSync(reportFd); }
  } catch {
    // Never print pg/OpenSSL exceptions, connection strings or command arguments.
    console.error(JSON.stringify({ status: "failed", code: "MAIL_ROTATION_ABORTED", values_logged: false }));
    process.exitCode = 1;
  } finally {
    if (client) { try { await client.end(); } catch { /* No raw errors. */ } }
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
