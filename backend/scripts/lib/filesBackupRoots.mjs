/**
 * CP-074 — Racines de fichiers métier (chemins relatifs à backend/).
 *
 * Détection issue du code : localStorage (storage/), calpinage JSON, uploads Multer.
 * Optionnel : cache DSM/IGN (volumineux, re-téléchargeable) via FILES_BACKUP_INCLUDE_DSM=1
 *
 * Sync cloud : la cible à pousser est backups/documents/ (snapshots datés).
 * Exemples (à adapter chemins machine) :
 *   rsync -av --delete ./backups/documents/ user@serveur:/backup/solarnext-documents/
 *   rclone sync ./backups/documents/ infomaniak:bucket/solarnext-documents/
 */

import path from "path";

/** @returns {string[]} chemins relatifs POSIX (slash) depuis la racine backend */
export function getDocumentRootsRelative() {
  const roots = [
    "storage",
    "calpinage/storage/data",
    "data/uploads",
  ];
  if (String(process.env.FILES_BACKUP_INCLUDE_DSM || "").trim() === "1") {
    roots.push("data/dsm/ign");
  }
  const extra = String(process.env.FILES_BACKUP_EXTRA_PATHS || "").trim();
  if (extra) {
    for (const p of extra.split(/[,;]/)) {
      const t = p.trim().replace(/\\/g, "/").replace(/^\/+/, "");
      if (t && !roots.includes(t)) roots.push(t);
    }
  }
  return roots;
}

/**
 * Export pour outillage externe (rsync, rclone, cron).
 * @param {string} backendRoot
 */
export function getCloudSyncHints(backendRoot) {
  const docRoot = path.join(backendRoot, "backups", "documents");
  return {
    localDocumentsBackupDir: docRoot,
    rsyncExample: `rsync -av --delete "${docRoot}/" USER@HOST:/chemin/backup/solarnext-documents/`,
    rcloneExample: `rclone sync "${docRoot}/" remote:solarnext-documents/`,
    note:
      "Chaque sous-dossier YYYY-MM-DD est un snapshot autonome ; sync du parent pour versionner côté cloud.",
  };
}
