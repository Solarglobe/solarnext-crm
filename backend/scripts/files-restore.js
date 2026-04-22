#!/usr/bin/env node
/**
 * CP-074 — Restauration d’un snapshot backups/documents/YYYY-MM-DD/ vers les dossiers source du backend.
 *
 * Destructif : écrase les fichiers existants. Exiger --yes ou CONFIRM_FILES_RESTORE=YES
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { getDocumentRootsRelative } from "./lib/filesBackupRoots.mjs";
import { copyTreeOverwrite } from "./lib/filesBackupIncremental.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND_ROOT = path.resolve(__dirname, "..");
const DOCUMENTS_BACKUP_ROOT = path.join(BACKEND_ROOT, "backups", "documents");

function parseArgs(argv) {
  const args = argv.slice(2);
  let yes = false;
  const rest = [];
  for (const a of args) {
    if (a === "--yes" || a === "-y") yes = true;
    else rest.push(a);
  }
  const target = rest.find((x) => !x.startsWith("-")) || null;
  return { target, yes };
}

function resolveSnapshotPath(arg) {
  if (!arg) return null;
  if (path.isAbsolute(arg) && fs.existsSync(arg)) return path.normalize(arg);
  if (/^\d{4}-\d{2}-\d{2}$/.test(arg)) {
    const p = path.join(DOCUMENTS_BACKUP_ROOT, arg);
    if (fs.existsSync(p)) return p;
  }
  const rel = path.join(BACKEND_ROOT, arg);
  if (fs.existsSync(rel)) return rel;
  return null;
}

async function main() {
  const { target, yes } = parseArgs(process.argv);
  const envYes = String(process.env.CONFIRM_FILES_RESTORE || "").trim() === "YES";

  if (!target) {
    console.error(
      "Usage : node scripts/files-restore.js --yes <YYYY-MM-DD | chemin absolu snapshot>\n" +
        "Exemple : node scripts/files-restore.js --yes 2026-04-16"
    );
    process.exit(1);
  }

  if (!yes && !envYes) {
    console.error(
      "[files-restore] Opération destructive : les fichiers du snapshot remplacent ceux du backend.\n" +
        "  Confirmer : CONFIRM_FILES_RESTORE=YES node scripts/files-restore.js \"" +
        target +
        "\"\n" +
        "  ou : node scripts/files-restore.js --yes \"" +
        target +
        "\""
    );
    process.exit(1);
  }

  const snapshotDir = resolveSnapshotPath(target);
  if (!snapshotDir || !fs.existsSync(snapshotDir)) {
    console.error("[files-restore] Snapshot introuvable :", target);
    process.exit(1);
  }

  const roots = getDocumentRootsRelative();
  console.log("[files-restore] Snapshot :", snapshotDir);
  console.log("[files-restore] Cibles :", roots.join(", "));

  for (const rel of roots) {
    const srcAbs = path.join(snapshotDir, ...rel.split("/"));
    const dstAbs = path.join(BACKEND_ROOT, ...rel.split("/"));
    if (!fs.existsSync(srcAbs)) {
      console.log(`[files-restore] (absent du snapshot, ignoré) ${rel}`);
      continue;
    }
    console.log(`[files-restore] Restauration : ${rel}`);
    const st = { copied: 0, bytesCopied: 0 };
    await copyTreeOverwrite(srcAbs, dstAbs, st);
    console.log(`   → fichiers écrits ${st.copied}, octets ${st.bytesCopied}`);
  }

  console.log("[files-restore] Terminé (exit 0).");
}

main().catch((e) => {
  console.error("[files-restore] Échec :", e?.message || e);
  process.exit(1);
});
