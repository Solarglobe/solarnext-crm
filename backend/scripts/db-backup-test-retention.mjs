#!/usr/bin/env node
/**
 * CP-073 — Test rétention sans connexion DB : fichiers factices + pruneOldBackups.
 *
 *   BACKUP_RETENTION=3 node scripts/db-backup-test-retention.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

import { pruneOldBackups, listBackupFiles } from "./lib/backupRetention.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BACKEND = path.resolve(__dirname, "..");
const ROOT = path.join(BACKEND, "backups", "_retention_test_only");

const retention = Math.max(1, parseInt(String(process.env.BACKUP_RETENTION || "3"), 10) || 3);

fs.mkdirSync(ROOT, { recursive: true });

const old = new Date("2019-06-01T12:00:00Z");
for (let i = 1; i <= 8; i++) {
  const name = `solarnext_backup_2019-06-${String(i).padStart(2, "0")}_12-00.sql.gz`;
  const p = path.join(ROOT, name);
  fs.writeFileSync(p, "fake");
  fs.utimesSync(p, old, old);
}

console.log("[retention-test] Fichiers créés :", listBackupFiles(ROOT).length);
const r = pruneOldBackups(ROOT, retention, (m) => console.log("[retention-test]", m));
const left = listBackupFiles(ROOT);
console.log("[retention-test] Restants :", left.length, "attendu <=", retention);
if (left.length <= retention && r.removed >= 0) {
  console.log("[retention-test] OK");
  process.exit(0);
}
console.error("[retention-test] ÉCHEC");
process.exit(1);
