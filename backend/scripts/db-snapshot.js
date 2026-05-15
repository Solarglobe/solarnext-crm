#!/usr/bin/env node
/**
 * Step #7 — Snapshot de schema PostgreSQL (pg_dump --schema-only)
 *
 * Ecrit le DDL complet (sans donnees) dans backend/db/schema.sql.
 * A executer apres chaque migration pour garder un historique lisible du schema.
 *
 * Usage :
 *   node scripts/db-snapshot.js           # mode normal
 *   node scripts/db-snapshot.js --quiet   # silence logs (CI)
 *
 * Variables d'environnement :
 *   DATABASE_URL              — connexion PostgreSQL (obligatoire)
 *   BACKUP_USE_DOCKER=1       — force le mode docker exec
 *   BACKUP_DOCKER_CONTAINER   — nom du conteneur Postgres (auto-detect sinon)
 *   SNAPSHOT_TIMEOUT_MS       — timeout pg_dump en ms (defaut 60000)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { once } from "events";

import {
  getPgConnectionFromEnv,
  buildPgEnv,
  formatConnLogLine,
} from "./lib/pgConnFromEnv.mjs";
import {
  resolveBackupExecutionMode,
  detectPostgresContainerName,
  dockerBinary,
} from "./lib/pgToolsRunner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const OUT_FILE = path.join(BACKEND_ROOT, "db", "schema.sql");

const QUIET = process.argv.includes("--quiet");

function log(...args) {
  if (!QUIET) console.log("[db-snapshot]", ...args);
}

function err(...args) {
  console.error("[db-snapshot]", ...args);
}

/**
 * Construit les arguments pg_dump pour un dump schema-only.
 * @param {Record<string, string>} pgEnv
 * @returns {string[]}
 */
function pgDumpSchemaArgs(pgEnv) {
  return [
    "--format=plain",
    "--schema-only",
    "--no-owner",
    "--no-acl",
    "--no-comments",
    "-h", pgEnv.PGHOST,
    "-p", String(pgEnv.PGPORT),
    "-U", pgEnv.PGUSER,
    "-d", pgEnv.PGDATABASE,
  ];
}

/**
 * Construit les arguments docker exec pg_dump pour un dump schema-only.
 * @param {Record<string, string>} pgEnv
 * @param {string} container
 * @returns {string[]}
 */
function dockerSchemaArgs(pgEnv, container) {
  return [
    "exec", "-i", container,
    "pg_dump",
    "--format=plain",
    "--schema-only",
    "--no-owner",
    "--no-acl",
    "--no-comments",
    "-h", pgEnv.PGHOST || "localhost",
    "-p", String(pgEnv.PGPORT || 5432),
    "-U", pgEnv.PGUSER,
    "-d", pgEnv.PGDATABASE,
  ];
}

/**
 * Capture la sortie de pg_dump --schema-only et l'ecrit dans OUT_FILE.
 * @param {Record<string, string>} pgEnv
 */
async function runPgDumpSchema(pgEnv) {
  const timeoutMs = Math.max(
    5000,
    parseInt(String(process.env.SNAPSHOT_TIMEOUT_MS || "60000"), 10) || 60000
  );
  const mode = resolveBackupExecutionMode();
  log(`Mode execution : ${mode}`);

  let child;
  if (mode === "docker") {
    const container = detectPostgresContainerName();
    if (!container) {
      throw new Error(
        "Fallback Docker : aucun conteneur detecte. Definissez BACKUP_DOCKER_CONTAINER=nom_du_conteneur."
      );
    }
    log(`Conteneur Docker : ${container}`);
    child = spawn(dockerBinary(), dockerSchemaArgs(pgEnv, container), {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    child = spawn("pg_dump", pgDumpSchemaArgs(pgEnv), {
      env: { ...process.env, ...pgEnv },
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  if (!child.stdout) {
    throw new Error(
      "pg_dump : stdout indisponible. Installez les outils client PostgreSQL (apt install postgresql-client)."
    );
  }

  const chunks = [];
  let errText = "";

  child.stdout.on("data", (chunk) => chunks.push(chunk));
  child.stderr?.on("data", (chunk) => { errText += String(chunk); });
  child.on("error", (e) => { errText += e?.message || String(e); });

  const killTimer = setTimeout(() => {
    err(`Timeout ${timeoutMs}ms — arret force.`);
    try { child.kill("SIGKILL"); } catch (_) {}
  }, timeoutMs);

  try {
    const [code] = await once(child, "close");
    clearTimeout(killTimer);
    if (code !== 0) {
      throw new Error(`pg_dump a echoue (code ${code}). ${errText.slice(0, 2000)}`);
    }
  } catch (e) {
    clearTimeout(killTimer);
    try { child.kill("SIGKILL"); } catch (_) {}
    throw e;
  }

  const raw = Buffer.concat(chunks).toString("utf8");
  if (!raw.trim()) {
    throw new Error("pg_dump a produit une sortie vide — schema introuvable ?");
  }

  // En-tete lisible avec timestamp et connexion
  const header = [
    "-- SolarNext CRM — Schema PostgreSQL (generé par db-snapshot.js)",
    `-- Date     : ${new Date().toISOString()}`,
    `-- Base     : ${pgEnv.PGDATABASE} @ ${pgEnv.PGHOST}:${pgEnv.PGPORT}`,
    "-- NE PAS MODIFIER MANUELLEMENT — fichier regenere apres chaque migration",
    "",
  ].join("\n");

  return header + raw;
}

async function main() {
  let conn;
  try {
    conn = getPgConnectionFromEnv();
  } catch (e) {
    err(e.message);
    process.exit(1);
  }

  const pgEnv = buildPgEnv(conn);
  log("Connexion :", formatConnLogLine(conn));
  log("Cible     :", path.relative(process.cwd(), OUT_FILE));

  // Cree db/ si absent
  fs.mkdirSync(path.dirname(OUT_FILE), { recursive: true });

  let sql;
  try {
    sql = await runPgDumpSchema(pgEnv);
  } catch (e) {
    err("Echec :", e?.message || e);
    process.exit(1);
  }

  fs.writeFileSync(OUT_FILE, sql, "utf8");
  const stat = fs.statSync(OUT_FILE);
  log(`OK — ${stat.size} octets ecrits dans db/schema.sql`);
  log("Pensez a committer db/schema.sql apres chaque migration.");
}

main().catch((e) => {
  console.error("[db-snapshot]", e);
  process.exit(1);
});
