/** Standalone, no dotenv, application bootstrap, integrations or migration runner. */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { TARGET, SQL, fail, reconcileLeadSources } from "../services/system/reconciliation/leadSourcesReconciliation.js";

export function parseArgs(args) {
  const options = { mode: "dry-run" }; let selected = false;
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (["--dry-run", "--apply", "--verify"].includes(arg)) {
      if (selected) throw fail("RECONCILIATION_ARGUMENTS_INVALID");
      options.mode = arg.slice(2); selected = true;
    } else if (arg === "--confirm-writers-stopped") {
      if (options.writersStopped) throw fail("RECONCILIATION_ARGUMENTS_INVALID");
      options.writersStopped = true;
    } else if (["--confirm-database", "--confirm-migration", "--report", "--receipt", "--preflight"].includes(arg) && args[i + 1] && !args[i + 1].startsWith("--")) {
      if (options[arg] !== undefined) throw fail("RECONCILIATION_ARGUMENTS_INVALID");
      options[arg] = args[++i];
    } else throw fail("RECONCILIATION_ARGUMENTS_INVALID");
  }
  if (!options["--confirm-database"] || options["--confirm-migration"] !== TARGET) throw fail("RECONCILIATION_CONFIRMATION_REQUIRED");
  if (options.mode === "apply" && (!options.writersStopped || !options["--receipt"] || !options["--preflight"])) throw fail("RECONCILIATION_APPLY_CONFIRMATIONS_REQUIRED");
  if (options.mode === "dry-run" && !options["--report"]) throw fail("RECONCILIATION_REPORT_REQUIRED");
  if (options.mode === "verify" && !options["--receipt"]) throw fail("RECONCILIATION_RECEIPT_REQUIRED");
  return options;
}
export function connectionOptions(env, mode) {
  if (env.MIGRATION_AUTO_REPAIR_CHECKSUMS) throw fail("RECONCILIATION_AUTO_REPAIR_FORBIDDEN");
  let url;
  try { url = new URL(env.MIGRATION_RECONCILIATION_DATABASE_URL); } catch { throw fail("RECONCILIATION_URL_REQUIRED"); }
  if (!["postgres:", "postgresql:"].includes(url.protocol) || !url.hostname || !url.username || url.pathname.length < 2 || url.hash || [...url.searchParams.keys()].some(k => k !== "sslmode")) throw fail("RECONCILIATION_URL_INVALID");
  const sslmode = url.searchParams.get("sslmode");
  if (sslmode && !["disable", "verify-full"].includes(sslmode)) throw fail("RECONCILIATION_URL_INVALID");
  return { host: url.hostname, port: Number(url.port || 5432), user: decodeURIComponent(url.username), password: decodeURIComponent(url.password), database: decodeURIComponent(url.pathname.slice(1)), ssl: sslmode === "verify-full" ? { rejectUnauthorized: true } : false, application_name: "lead-sources-single-checksum-proposal", connectionTimeoutMillis: 5000, options: `-c default_transaction_read_only=${mode === "apply" ? "off" : "on"} -c statement_timeout=15000 -c lock_timeout=1000` };
}

/** Reserve first, restrict ACL before writing, never overwrite. No decrypted data. */
export function writePrivateJson(filename, value) {
  const full = path.resolve(filename), parent = fs.realpathSync(path.dirname(full));
  if (parent !== path.dirname(full)) throw fail("RECONCILIATION_RECEIPT_SYMLINK_REFUSED");
  const fd = fs.openSync(full, "wx", 0o600);
  try {
    if (process.platform === "win32") {
      const who = spawnSync("whoami", ["/user", "/fo", "csv", "/nh"], { encoding: "utf8", windowsHide: true });
      const sid = who.stdout?.match(/S-1-\d+(?:-\d+)+/)?.[0];
      if (who.status !== 0 || !sid) throw fail("RECONCILIATION_PRIVATE_ACL_FAILED");
      const acl = spawnSync("icacls", [full, "/inheritance:r", "/grant:r", `*${sid}:(F)`], { windowsHide: true, stdio: "ignore" });
      if (acl.status !== 0) throw fail("RECONCILIATION_PRIVATE_ACL_FAILED");
    } else {
      fs.fchmodSync(fd, 0o600);
      if ((fs.fstatSync(fd).mode & 0o077) !== 0) throw fail("RECONCILIATION_PRIVATE_MODE_FAILED");
    }
    fs.writeFileSync(fd, JSON.stringify(value, null, 2)); fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  // Persist the directory entry before the database UPDATE (POSIX production).
  if (process.platform !== "win32") { const dir = fs.openSync(parent, "r"); try { fs.fsyncSync(dir); } finally { fs.closeSync(dir); } }
}
export function validatePreflight(report, configuration, identity, now = Date.now()) {
  const age = now - Date.parse(report?.at);
  if (report?.version !== 1 || report.result?.mode !== "dry-run" || report.result.status !== "COMPATIBLE" || report.result.migration !== TARGET || report.target?.host !== configuration.host || report.target?.port !== configuration.port || report.target?.database !== configuration.database || JSON.stringify(report.identity) !== JSON.stringify(identity) || !Number.isFinite(age) || age < 0 || age > 3600000) throw fail("RECONCILIATION_PREFLIGHT_INVALID");
}

async function main() {
  let client; const controller = new AbortController(); const stop = () => controller.abort();
  process.on("SIGINT", stop); process.on("SIGTERM", stop);
  try {
    const options = parseArgs(process.argv.slice(2));
    const config = connectionOptions(process.env, options.mode);
    if (config.database !== options["--confirm-database"]) throw fail("RECONCILIATION_TARGET_DIFFERENT");
    const priorReceipt = options.mode === "verify" ? JSON.parse(fs.readFileSync(options["--receipt"], "utf8")) : undefined;
    const { Client } = (await import("pg")).default;
    client = new Client(config); client.on("error", stop); await client.connect();
    const identity = (await client.query(SQL.identity)).rows[0];
    if (options.mode === "apply") validatePreflight(JSON.parse(fs.readFileSync(options["--preflight"], "utf8")), config, identity);
    const result = await reconcileLeadSources({ client, mode: options.mode, confirmDatabase: config.database, writersStopped: options.writersStopped, signal: controller.signal, priorReceipt,
      receipt: options.mode === "apply" ? value => writePrivateJson(options["--receipt"], value) : undefined });
    const report = { version: 1, at: new Date().toISOString(), target: { host: config.host, port: config.port, database: config.database }, identity, result };
    if (options["--report"]) writePrivateJson(options["--report"], report);
    // Do not emit database identity, hashes, row values, arguments or raw errors.
    console.log(JSON.stringify(result));
  } catch (error) {
    console.error(JSON.stringify({ status: "REFUSED", code: error?.code?.startsWith("RECONCILIATION_") ? error.code : "RECONCILIATION_ABORTED", values_logged: false }));
    process.exitCode = 1;
  } finally {
    if (client) { try { await client.end(); } catch { /* No raw errors. */ } }
    process.off("SIGINT", stop); process.off("SIGTERM", stop);
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await main();
