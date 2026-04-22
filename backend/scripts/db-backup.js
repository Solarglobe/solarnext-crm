#!/usr/bin/env node
/**
 * CP-073 — Sauvegarde PostgreSQL (pg_dump → gzip) dans backend/backups/YYYY-MM/
 *
 * Exécution : pg_dump sur la machine hôte si disponible ; sinon fallback `docker exec` (voir pgToolsRunner).
 *
 * Variables : DATABASE_URL, BACKUP_RETENTION (défaut 14), BACKUP_PG_DUMP_TIMEOUT_MS (défaut 3600000),
 * BACKUP_USE_DOCKER=0|1 (force), BACKUP_DOCKER_CONTAINER (nom du conteneur Postgres).
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import { pipeline } from "stream/promises";
import { createWriteStream } from "fs";
import { createGzip } from "zlib";
import { once } from "events";

import {
  getPgConnectionFromEnv,
  buildPgEnv,
  formatConnLogLine,
  classifyDbTarget,
} from "./lib/pgConnFromEnv.mjs";
import {
  resolveBackupExecutionMode,
  detectPostgresContainerName,
  dockerPgDumpArgs,
  dockerBinary,
} from "./lib/pgToolsRunner.mjs";
import { pruneOldBackups as pruneBackupFiles } from "./lib/backupRetention.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const BACKUPS_ROOT = path.join(BACKEND_ROOT, "backups");

function pad2(n) {
  return String(n).padStart(2, "0");
}

function backupFileName(now = new Date()) {
  const y = now.getFullYear();
  const m = pad2(now.getMonth() + 1);
  const d = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mm = pad2(now.getMinutes());
  return `solarnext_backup_${y}-${m}-${d}_${hh}-${mm}.sql.gz`;
}

function monthDir(now = new Date()) {
  return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`;
}

/**
 * @param {string} outPath
 * @param {Record<string, string>} pgEnv
 * @param {ReturnType<typeof getPgConnectionFromEnv>} conn
 */
async function runPgDumpToGzip(outPath, pgEnv, conn) {
  const timeoutMs = Math.max(
    10000,
    parseInt(String(process.env.BACKUP_PG_DUMP_TIMEOUT_MS || "3600000"), 10) || 3600000
  );
  const mode = resolveBackupExecutionMode();
  const cat = classifyDbTarget(conn);
  console.log(`[db-backup] Mode exécution : ${mode} (cible : ${cat})`);

  let child;
  if (mode === "docker") {
    const container = detectPostgresContainerName();
    if (!container) {
      throw new Error(
        "Fallback Docker : aucun conteneur détecté. Lancez Docker ou définissez BACKUP_DOCKER_CONTAINER=nom_du_conteneur."
      );
    }
    child = spawn(dockerBinary(), dockerPgDumpArgs(pgEnv, container), {
      stdio: ["ignore", "pipe", "pipe"],
    });
  } else {
    child = spawn("pg_dump", [
      "--format=plain",
      "--clean",
      "--if-exists",
      "--no-owner",
      "--no-acl",
      "-h",
      pgEnv.PGHOST,
      "-p",
      String(pgEnv.PGPORT),
      "-U",
      pgEnv.PGUSER,
      "-d",
      pgEnv.PGDATABASE,
    ], {
      env: pgEnv,
      stdio: ["ignore", "pipe", "pipe"],
    });
  }

  if (!child.stdout) {
    throw new Error(
      "pg_dump : stdout indisponible. Installez les outils client PostgreSQL ou utilisez Docker (voir README dans l’en-tête du script)."
    );
  }

  let errText = "";
  child.stderr?.on("data", (ch) => {
    errText += String(ch);
  });

  const out = createWriteStream(outPath);
  const gzip = createGzip({ level: 9 });
  child.on("error", (e) => {
    errText += e?.message || String(e);
  });

  let killTimer = setTimeout(() => {
    console.error(`[db-backup] Timeout ${timeoutMs}ms — arrêt forcé.`);
    try {
      child.kill("SIGKILL");
    } catch (_) {}
  }, timeoutMs);

  try {
    await pipeline(child.stdout, gzip, out);
    const [code] = await once(child, "close");
    clearTimeout(killTimer);
    if (code !== 0) {
      throw new Error(`pg_dump a échoué (code ${code}). ${errText.slice(0, 2000)}`);
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
  const retention = Math.max(
    1,
    parseInt(String(process.env.BACKUP_RETENTION || "14"), 10) || 14
  );

  let conn;
  try {
    conn = getPgConnectionFromEnv();
  } catch (e) {
    console.error("[db-backup]", e.message);
    process.exit(1);
  }

  const pgEnv = buildPgEnv(conn);
  console.log("[db-backup] Connexion :", formatConnLogLine(conn));

  const now = new Date();
  const sub = monthDir(now);
  const dir = path.join(BACKUPS_ROOT, sub);
  fs.mkdirSync(dir, { recursive: true });

  const name = backupFileName(now);
  const outPath = path.join(dir, name);

  console.log("[db-backup] Cible :", path.relative(BACKEND_ROOT, outPath));

  try {
    await runPgDumpToGzip(outPath, pgEnv, conn);
    const st = fs.statSync(outPath);
    if (st.size === 0) {
      throw new Error("Fichier de sauvegarde vide (0 octet).");
    }
    console.log("[db-backup] OK — taille", st.size, "octets");
    console.log("[db-backup] Chemin absolu :", outPath);
  } catch (e) {
    console.error("[db-backup] Échec :", e?.message || e);
    try {
      if (fs.existsSync(outPath)) fs.unlinkSync(outPath);
    } catch (_) {}
    process.exit(1);
  }

  pruneBackupFiles(BACKUPS_ROOT, retention, (msg) => console.log("[db-backup] Rétention —", msg));
  console.log("[db-backup] Terminé (exit 0).");
}

main().catch((e) => {
  console.error("[db-backup]", e);
  process.exit(1);
});
