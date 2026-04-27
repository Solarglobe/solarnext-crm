#!/usr/bin/env node
/**
 * Restaure les fichiers d’un backup local vers la racine de stockage (ex. /app/storage sur Railway).
 * L’arborescence du backup doit reproduire storage_key : orgId/entityType/entityId/… ou orgId/mail/yyyy/mm/…
 *
 * Usage:
 *   node backend/scripts/restore-storage-from-backup.mjs <backupDir> [targetDir]
 *   BACKUP_DIR=./storage STORAGE_TARGET=/app/storage node backend/scripts/restore-storage-from-backup.mjs
 *
 * Options:
 *   --dry-run     Affiche les opérations sans copier
 *   --verify-db   Après copie, vérifie chaque storage_key (entity_documents) sur le disque cible (nécessite DATABASE_URL)
 *   --help
 */

import fs from "fs/promises";
import path from "path";
import "../config/register-local-env.js";
import "../config/script-env-tail.js";

const DEFAULT_TARGET = process.env.STORAGE_TARGET || process.env.RAILWAY_VOLUME_MOUNT_PATH || "/app/storage";

function parseArgs(argv) {
  const out = { backup: null, target: null, dryRun: false, verifyDb: false, help: false };
  for (const a of argv) {
    if (a === "--help" || a === "-h") out.help = true;
    else if (a === "--dry-run") out.dryRun = true;
    else if (a === "--verify-db") out.verifyDb = true;
    else if (!a.startsWith("-")) {
      if (!out.backup) out.backup = a;
      else if (!out.target) out.target = a;
    }
  }
  return out;
}

function printHelp() {
  console.log(`restore-storage-from-backup.mjs

Copie chaque fichier depuis <backupDir> vers [targetDir] en conservant le chemin relatif
(= storage_key : organizationId/lead|client|.../...).

Variables:
  BACKUP_DIR       chemin source si 1er argument absent
  STORAGE_TARGET   cible (défaut: /app/storage ou RAILWAY_VOLUME_MOUNT_PATH)

Exemples:
  node restore-storage-from-backup.mjs ./storage /app/storage
  node restore-storage-from-backup.mjs /backup/crm-storage --verify-db
`);
}

/** @param {string} rel */
function assertSafeRelative(rel) {
  const n = rel.replace(/\\/g, "/");
  if (n === "" || n.startsWith("..") || n.includes("/../") || n === "..") {
    throw new Error(`Chemin dangereux refusé: ${rel}`);
  }
}

/**
 * @param {string} dir
 * @yields {string} chemins absolus fichiers
 */
async function* walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      yield* walkFiles(p);
    } else if (e.isFile()) {
      yield p;
    }
  }
}

/**
 * @param {string} fileAbs
 * @param {string} rootAbs
 * @returns {string} clé type DB (séparateurs /)
 */
function fileToStorageKey(fileAbs, rootAbs) {
  let rel = path.relative(rootAbs, fileAbs);
  rel = rel.split(path.sep).join("/");
  assertSafeRelative(rel);
  return rel;
}

/**
 * @param {string} key
 * @param {string} targetRoot
 */
function keyToDestAbs(key, targetRoot) {
  const parts = key.split("/").filter(Boolean);
  return path.join(targetRoot, ...parts);
}

/**
 * @param {import('pg').Pool} pool
 */
async function verifyEntityDocumentsKeys(targetRoot) {
  const databaseUrl = process.env.DATABASE_URL;
  if (!databaseUrl?.trim()) {
    console.error("[restore-storage] --verify-db : DATABASE_URL manquant");
    return { ok: 0, missing: 0, errors: 0 };
  }
  const pg = (await import("pg")).default;
  const pool = new pg.Pool({
    connectionString: databaseUrl.replace(/\?.*$/, ""),
    ssl: { rejectUnauthorized: false },
  });
  let ok = 0;
  let missing = 0;
  let errors = 0;
  try {
    const r = await pool.query(
      `SELECT id, storage_key
       FROM entity_documents
       WHERE storage_key IS NOT NULL AND trim(storage_key) <> ''`
    );
    console.log(`[restore-storage] --verify-db : ${r.rows.length} ligne(s) avec storage_key`);
    for (const row of r.rows) {
      const key = String(row.storage_key).trim();
      if (!key) continue;
      const dest = keyToDestAbs(key, targetRoot);
      try {
        const st = await fs.stat(dest);
        if (st.isFile() && st.size > 0) {
          ok += 1;
        } else {
          missing += 1;
          console.error("[restore-storage] ERREUR: fichier absent ou vide (DB id=%s) storage_key=%j -> %s", row.id, key, dest);
        }
      } catch (e) {
        missing += 1;
        console.error(
          "[restore-storage] ERREUR: clé en base introuvable sur disque (id=%s) storage_key=%j -> %s : %s",
          row.id,
          key,
          dest,
          e?.message || e
        );
      }
    }
  } catch (e) {
    errors += 1;
    console.error("[restore-storage] ERREUR requête DB:", e?.message || e);
  } finally {
    await pool.end();
  }
  console.log(`[restore-storage] --verify-db : OK fichiers=%s manquants=%s erreurs_requête=%s`, ok, missing, errors);
  return { ok, missing, errors };
}

async function main() {
  const raw = process.argv.slice(2);
  const opts = parseArgs(raw);
  if (opts.help) {
    printHelp();
    process.exit(0);
  }

  const backupRoot = path.resolve(
    opts.backup || process.env.BACKUP_DIR || ""
  );
  const targetRoot = path.resolve(opts.target || DEFAULT_TARGET);

  if (!opts.backup && !process.env.BACKUP_DIR) {
    console.error("Indiquez le dossier backup : 1er argument ou BACKUP_DIR=...");
    printHelp();
    process.exit(1);
  }

  let statB;
  try {
    statB = await fs.stat(backupRoot);
  } catch (e) {
    console.error("[restore-storage] ERREUR: backup introuvable:", backupRoot, e?.message || e);
    process.exit(1);
  }
  if (!statB.isDirectory()) {
    console.error("[restore-storage] ERREUR: le backup n'est pas un dossier:", backupRoot);
    process.exit(1);
  }
  if (path.resolve(backupRoot) === path.resolve(targetRoot)) {
    console.error("[restore-storage] ERREUR: source et cible identiques — opération refusée.");
    process.exit(1);
  }

  console.log("[restore-storage] source (backup):", backupRoot);
  console.log("[restore-storage] cible (STORAGE):", targetRoot);
  if (opts.dryRun) console.log("[restore-storage] mode --dry-run (aucune écriture)");

  let copied = 0;
  let failed = 0;

  for await (const fileAbs of walkFiles(backupRoot)) {
    let storageKey;
    try {
      storageKey = fileToStorageKey(fileAbs, backupRoot);
    } catch (e) {
      failed += 1;
      console.error("[restore-storage] ERREUR chemin relatif:", fileAbs, e?.message || e);
      continue;
    }
    const destAbs = keyToDestAbs(storageKey, targetRoot);
    try {
      if (opts.dryRun) {
        console.log("[restore-storage] [dry-run] copierait:", storageKey, "->", destAbs);
        copied += 1;
        continue;
      }
      await fs.mkdir(path.dirname(destAbs), { recursive: true });
      await fs.copyFile(fileAbs, destAbs);
      copied += 1;
      console.log("[restore-storage] fichier restauré", { storageKey, dest: destAbs });
    } catch (e) {
      failed += 1;
      console.error("[restore-storage] ERREUR copie", { storageKey, dest: destAbs, err: e?.message || e });
    }
  }

  console.log("[restore-storage] fin copie: restaurés=%s échecs=%s", copied, failed);

  if (opts.verifyDb) {
    await verifyEntityDocumentsKeys(targetRoot);
  }
}

main().catch((e) => {
  console.error("[restore-storage] FATAL:", e);
  process.exit(1);
});
