#!/usr/bin/env node
/**
 * CP-073 — Restauration depuis .sql.gz (psql ou docker exec + psql).
 *
 * Stratégie par défaut : recréer entièrement la base cible (DROP DATABASE … WITH (FORCE) puis CREATE DATABASE)
 * depuis une connexion à la base d’administration (postgres), puis appliquer le dump — état identique au backup,
 * sans objets résiduels créés après la sauvegarde.
 *
 * Variables :
 *   BACKUP_PSQL_TIMEOUT_MS (défaut 7200000)
 *   BACKUP_USE_DOCKER, BACKUP_DOCKER_CONTAINER
 *   BACKUP_PSQL_MAINTENANCE_DB — base pour DROP/CREATE (défaut : postgres)
 *   BACKUP_RESTORE_RESET — database | schema (défaut : database). « schema » = DROP SCHEMA public CASCADE + CREATE SCHEMA public
 *     (si DROP DATABASE interdit sur l’hébergement, sans droits superuser, etc.)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { createReadStream } from "fs";
import { createGunzip } from "zlib";
import { once } from "events";

import {
  getPgConnectionFromEnv,
  buildPgEnv,
  formatConnLogLine,
  classifyDbTarget,
} from "./lib/pgConnFromEnv.mjs";
import {
  resolveRestoreExecutionMode,
  detectPostgresContainerName,
  dockerPsqlArgs,
  dockerBinary,
} from "./lib/pgToolsRunner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/**
 * Identifiant SQL double-quoté (nom de base ou autre).
 * @param {string} ident
 */
function sqlQuoteIdent(ident) {
  return `"${String(ident).replace(/"/g, '""')}"`;
}

/**
 * Exécute une commande SQL unique (psql -c) en mode hôte ou Docker.
 * @param {Record<string, string>} pgEnv
 * @param {"host" | "docker"} mode
 * @param {string} sql
 * @param {string} [connectDatabase] — base de connexion (défaut : pgEnv.PGDATABASE)
 */
function runPsqlOneShot(pgEnv, mode, sql, connectDatabase = pgEnv.PGDATABASE) {
  return new Promise((resolve, reject) => {
    let child;
    if (mode === "docker") {
      const container = detectPostgresContainerName();
      if (!container) {
        reject(new Error("Fallback Docker : aucun conteneur Postgres détecté."));
        return;
      }
      child = spawn(dockerBinary(), [
        "exec",
        "-e",
        `PGPASSWORD=${pgEnv.PGPASSWORD}`,
        container,
        "psql",
        "-h",
        "127.0.0.1",
        "-p",
        "5432",
        "-U",
        pgEnv.PGUSER,
        "-d",
        connectDatabase,
        "-v",
        "ON_ERROR_STOP=1",
        "-c",
        sql,
      ], { stdio: ["ignore", "inherit", "inherit"] });
    } else {
      child = spawn(
        "psql",
        [
          "-h",
          pgEnv.PGHOST,
          "-p",
          String(pgEnv.PGPORT),
          "-U",
          pgEnv.PGUSER,
          "-d",
          connectDatabase,
          "-v",
          "ON_ERROR_STOP=1",
          "-c",
          sql,
        ],
        { env: pgEnv, stdio: ["ignore", "inherit", "inherit"] }
      );
    }
    child.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`psql -c a échoué (code ${code})`));
    });
    child.on("error", reject);
  });
}

/**
 * Recrée la base cible (vide) pour que le dump soit le seul état final.
 * @param {Record<string, string>} pgEnv
 * @param {"host" | "docker"} mode
 * @param {ReturnType<typeof getPgConnectionFromEnv>} conn
 */
async function recreateTargetDatabase(pgEnv, mode, conn) {
  const maintenanceDb =
    String(process.env.BACKUP_PSQL_MAINTENANCE_DB || "postgres").trim() || "postgres";
  const dbIdent = sqlQuoteIdent(conn.database);
  console.log(
    `[db-restore] Réinitialisation complète : DROP + CREATE DATABASE ${conn.database} (via -d ${maintenanceDb})…`
  );
  // Deux appels séparés : DROP DATABASE ne peut pas s’exécuter dans un bloc transactionnel
  // (certaines versions de psql avec plusieurs instructions dans un seul -c le regroupent).
  await runPsqlOneShot(
    pgEnv,
    mode,
    `DROP DATABASE IF EXISTS ${dbIdent} WITH (FORCE);`,
    maintenanceDb
  );
  await runPsqlOneShot(
    pgEnv,
    mode,
    `CREATE DATABASE ${dbIdent} WITH TEMPLATE = template0 ENCODING = 'UTF8';`,
    maintenanceDb
  );
}

/**
 * Alternative lorsque DROP DATABASE n’est pas autorisé : vide le schéma public.
 * @param {Record<string, string>} pgEnv
 * @param {"host" | "docker"} mode
 */
async function resetPublicSchema(pgEnv, mode) {
  const sql = [
    "DROP SCHEMA IF EXISTS public CASCADE;",
    "CREATE SCHEMA public;",
    "GRANT ALL ON SCHEMA public TO postgres;",
    "GRANT ALL ON SCHEMA public TO public;",
  ].join("\n");
  console.log("[db-restore] Réinitialisation : DROP SCHEMA public CASCADE + CREATE SCHEMA public…");
  await runPsqlOneShot(pgEnv, mode, sql, pgEnv.PGDATABASE);
}

/**
 * @param {Record<string, string>} pgEnv
 * @param {"host" | "docker"} mode
 * @param {ReturnType<typeof getPgConnectionFromEnv>} conn
 */
async function prepareEmptyTargetForRestore(pgEnv, mode, conn) {
  const raw = String(process.env.BACKUP_RESTORE_RESET || "database").trim().toLowerCase();
  if (raw === "schema") {
    await resetPublicSchema(pgEnv, mode);
    return;
  }
  if (raw === "database" || raw === "dropdb" || raw === "") {
    await recreateTargetDatabase(pgEnv, mode, conn);
    return;
  }
  throw new Error(
    `BACKUP_RESTORE_RESET invalide : "${raw}" (attendu : database, dropdb, schema).`
  );
}

function parseArgs(argv) {
  const args = argv.slice(2);
  let yes = false;
  const rest = [];
  for (const a of args) {
    if (a === "--yes" || a === "-y") yes = true;
    else rest.push(a);
  }
  const file = rest.find((x) => !x.startsWith("-")) || null;
  return { file, yes };
}

/**
 * @param {string} backupPath
 * @param {Record<string, string>} pgEnv
 * @param {ReturnType<typeof getPgConnectionFromEnv>} conn
 */
async function runRestore(backupPath, pgEnv, conn) {
  const timeoutMs = Math.max(
    60000,
    parseInt(String(process.env.BACKUP_PSQL_TIMEOUT_MS || "7200000"), 10) || 7200000
  );
  const mode = resolveRestoreExecutionMode();
  const cat = classifyDbTarget(conn);
  console.log(`[db-restore] Mode exécution : ${mode} (cible : ${cat})`);

  let child;
  if (mode === "docker") {
    const container = detectPostgresContainerName();
    if (!container) {
      throw new Error(
        "Fallback Docker : aucun conteneur détecté. Définissez BACKUP_DOCKER_CONTAINER ou lancez Docker."
      );
    }
    child = spawn(dockerBinary(), dockerPsqlArgs(pgEnv, container), {
      stdio: ["pipe", "inherit", "inherit"],
    });
  } else {
    child = spawn("psql", [
      "-h",
      pgEnv.PGHOST,
      "-p",
      String(pgEnv.PGPORT),
      "-U",
      pgEnv.PGUSER,
      "-d",
      pgEnv.PGDATABASE,
      "-v",
      "ON_ERROR_STOP=1",
      "-f",
      "-",
    ], {
      env: pgEnv,
      stdio: ["pipe", "inherit", "inherit"],
    });
  }

  if (!child.stdin) {
    throw new Error("psql : stdin indisponible.");
  }

  let errText = "";
  if (child.stderr) {
    child.stderr.on("data", (ch) => {
      errText += String(ch);
    });
  }

  const killTimer = setTimeout(() => {
    console.error(`[db-restore] Timeout ${timeoutMs}ms — arrêt forcé.`);
    try {
      child.kill("SIGKILL");
    } catch (_) {}
  }, timeoutMs);

  const src = createReadStream(backupPath);
  const gunzip = createGunzip();

  try {
    child.once("error", (e) => {
      errText += e?.message || String(e);
    });
    await pipeline(src, gunzip, child.stdin);
    const [code] = await once(child, "close");
    clearTimeout(killTimer);
    if (code !== 0) {
      throw new Error(`psql a échoué (code ${code}). ${errText.slice(0, 2000)}`);
    }
  } catch (e) {
    clearTimeout(killTimer);
    try {
      child.kill("SIGKILL");
    } catch (_) {}
    throw e;
  }
}

async function main() {
  const { file, yes } = parseArgs(process.argv);
  const envYes = String(process.env.CONFIRM_RESTORE || "").trim() === "YES";

  if (!file) {
    console.error("Usage : node scripts/db-restore.js [--yes] <chemin/vers/fichier.sql.gz>");
    process.exit(1);
  }

  const abs = path.isAbsolute(file) ? file : path.resolve(process.cwd(), file);
  if (!fs.existsSync(abs)) {
    console.error("[db-restore] Fichier introuvable :", abs);
    process.exit(1);
  }
  if (!abs.endsWith(".sql.gz")) {
    console.error("[db-restore] Attendu un fichier .sql.gz");
    process.exit(1);
  }

  if (!yes && !envYes) {
    console.error(
      "[db-restore] Opération destructive : la base cible sera supprimée puis recréée (ou schéma public vidé si BACKUP_RESTORE_RESET=schema),\n" +
        "  puis remplie depuis le fichier .sql.gz.\n" +
        "  Pour confirmer : CONFIRM_RESTORE=YES node scripts/db-restore.js \"" +
        file +
        "\"\n" +
        "  ou : node scripts/db-restore.js --yes \"" +
        file +
        "\""
    );
    process.exit(1);
  }

  let conn;
  try {
    conn = getPgConnectionFromEnv();
  } catch (e) {
    console.error("[db-restore]", e.message);
    process.exit(1);
  }

  const pgEnv = buildPgEnv(conn);
  console.log("[db-restore] Connexion :", formatConnLogLine(conn));
  console.log("[db-restore] Source :", abs);

  try {
    const mode = resolveRestoreExecutionMode();
    await prepareEmptyTargetForRestore(pgEnv, mode, conn);
    await runRestore(abs, pgEnv, conn);
    console.log("[db-restore] Restauration terminée avec succès (exit 0).");
  } catch (e) {
    console.error("[db-restore] Échec :", e?.message || e);
    process.exit(1);
  }
}

main().catch((e) => {
  console.error("[db-restore]", e);
  process.exit(1);
});
