#!/usr/bin/env node
/**
 * CP-074 — Backup incrémental des fichiers métier vers backups/documents/YYYY-MM-DD/
 *
 * Variables : BACKUP_FORCE=1, FILES_BACKUP_RETENTION (défaut 7), FILES_BACKUP_INCLUDE_DSM, FILES_BACKUP_EXTRA_PATHS
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getDocumentRootsRelative, getCloudSyncHints } from "./lib/filesBackupRoots.mjs";
import { copyTreeIncremental, totalSizeBytes } from "./lib/filesBackupIncremental.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DOCUMENTS_BACKUP_ROOT = path.join(BACKEND_ROOT, "backups", "documents");

function todayYmd() {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}

function isDateDirName(name) {
  return /^\d{4}-\d{2}-\d{2}$/.test(name);
}

/**
 * @param {string} root
 * @param {number} keep
 */
function pruneDocumentSnapshots(root, keep) {
  if (!fs.existsSync(root)) return { removed: 0 };
  const dirs = fs
    .readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && isDateDirName(d.name))
    .map((d) => d.name)
    .sort()
    .reverse();
  if (dirs.length <= keep) {
    console.log(`[files-backup] Rétention : ${dirs.length} snapshot(s), rien à supprimer (max ${keep}).`);
    return { removed: 0 };
  }
  const toRemove = dirs.slice(keep);
  let removed = 0;
  for (const name of toRemove) {
    const p = path.join(root, name);
    try {
      fs.rmSync(p, { recursive: true, force: true });
      console.log(`[files-backup] Rétention — supprimé : ${p}`);
      removed += 1;
    } catch (e) {
      console.error(`[files-backup] Rétention — échec ${p}:`, e?.message || e);
    }
  }
  console.log(`[files-backup] Rétention : conservé ${keep} plus récent(s), supprimé ${removed} snapshot(s).`);
  return { removed };
}

async function main() {
  const t0 = Date.now();
  const ymd = todayYmd();
  const snapshotDir = path.join(DOCUMENTS_BACKUP_ROOT, ymd);
  const force = String(process.env.BACKUP_FORCE || "").trim() === "1";

  if (fs.existsSync(snapshotDir)) {
    if (!force) {
      console.log(`[files-backup] Snapshot du jour déjà présent : ${snapshotDir}`);
      console.log("[files-backup] Rien à faire (définir BACKUP_FORCE=1 pour refaire).");
      const keep = Math.max(1, parseInt(String(process.env.FILES_BACKUP_RETENTION || "7"), 10) || 7);
      pruneDocumentSnapshots(DOCUMENTS_BACKUP_ROOT, keep);
      return;
    }
    console.log(`[files-backup] BACKUP_FORCE=1 — suppression snapshot existant : ${snapshotDir}`);
    fs.rmSync(snapshotDir, { recursive: true, force: true });
  }

  fs.mkdirSync(DOCUMENTS_BACKUP_ROOT, { recursive: true });

  const roots = getDocumentRootsRelative();
  console.log("[files-backup] Racines à sauvegarder :", roots.join(", "));

  let totalCopied = 0;
  let totalSkipped = 0;
  let totalBytes = 0;

  for (const rel of roots) {
    const srcAbs = path.join(BACKEND_ROOT, ...rel.split("/"));
    const dstAbs = path.join(snapshotDir, ...rel.split("/"));
    if (!fs.existsSync(srcAbs)) {
      console.log(`[files-backup] (absent, ignoré) ${rel}`);
      continue;
    }
    const st = { copied: 0, skipped: 0, bytesCopied: 0 };
    console.log(`[files-backup] Copie incrémentale : ${rel} → ${path.relative(BACKEND_ROOT, dstAbs)}`);
    await copyTreeIncremental(srcAbs, dstAbs, st);
    totalCopied += st.copied;
    totalSkipped += st.skipped;
    totalBytes += st.bytesCopied;
    console.log(
      `   → copiés ${st.copied}, inchangés (skip) ${st.skipped}, octets copiés ${st.bytesCopied}`
    );
  }

  const snapSize = await totalSizeBytes(snapshotDir);
  const sec = ((Date.now() - t0) / 1000).toFixed(2);
  console.log(`[files-backup] OK — snapshot : ${snapshotDir}`);
  console.log(`[files-backup] Fichiers copiés (nouveaux/changés) : ${totalCopied}, skip : ${totalSkipped}`);
  console.log(`[files-backup] Taille totale snapshot : ${snapSize} octets`);
  console.log(`[files-backup] Durée : ${sec} s`);

  const hints = getCloudSyncHints(BACKEND_ROOT);
  console.log("[files-backup] Sync cloud (exemples) :");
  console.log("  ", hints.rsyncExample);
  console.log("  ", hints.rcloneExample);

  const keep = Math.max(1, parseInt(String(process.env.FILES_BACKUP_RETENTION || "7"), 10) || 7);
  pruneDocumentSnapshots(DOCUMENTS_BACKUP_ROOT, keep);
}

main().catch((e) => {
  console.error("[files-backup] Échec :", e?.message || e);
  process.exit(1);
});
