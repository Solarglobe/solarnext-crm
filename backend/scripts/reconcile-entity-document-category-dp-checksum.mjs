/**
 * Réaligne le hash brut de 1775810000000 après retouche uniquement commentaires / forme du down,
 * lorsque checksum_normalized est inchangé (même fond up/down).
 *
 * Usage : cd backend && MIGRATION_RECONCILE=1 node scripts/reconcile-entity-document-category-dp-checksum.mjs
 */

import "../config/register-local-env.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { pool } = await import("../config/db.js");

const MIGRATION_NAME = "1775810000000_entity_document_category_dp";
const MIGRATION_FILE = path.join(__dirname, "../migrations", `${MIGRATION_NAME}.js`);

function normalizeMigrationContent(fileContent) {
  let s = String(fileContent).replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  s = s.replace(/\/\*[\s\S]*?\*\//g, "");
  const out = [];
  for (const line of s.split("\n")) {
    const t = line.trim();
    if (t === "" || /^\/\//.test(t)) continue;
    out.push(line.replace(/\s+$/g, ""));
  }
  return out.join("\n").trim();
}

function hashMigration(fileContent) {
  return crypto.createHash("sha256").update(fileContent).digest("hex");
}

const content = fs.readFileSync(MIGRATION_FILE, "utf8");
const checksum = hashMigration(content);
const checksumNormalized = hashMigration(normalizeMigrationContent(content));

const row = await pool.query(
  `SELECT checksum, checksum_normalized FROM migration_checksums WHERE migration_name = $1`,
  [MIGRATION_NAME]
);
if (row.rows.length === 0) {
  console.error("Ligne migration_checksums absente");
  process.exit(1);
}
const cur = row.rows[0];
if (cur.checksum_normalized !== checksumNormalized) {
  console.error("checksum_normalized diverge — ne pas réconcilier automatiquement.");
  process.exit(1);
}
if (cur.checksum === checksum) {
  console.log("Déjà aligné.");
  await pool.end();
  process.exit(0);
}
if (String(process.env.MIGRATION_RECONCILE || "").trim() !== "1") {
  console.log("Dry-run : hash brut fichier =", checksum, "— MIGRATION_RECONCILE=1 pour appliquer.");
  await pool.end();
  process.exit(0);
}
await pool.query(`UPDATE migration_checksums SET checksum = $1 WHERE migration_name = $2`, [
  checksum,
  MIGRATION_NAME,
]);
console.log("checksum brut mis à jour pour", MIGRATION_NAME);
await pool.end();
