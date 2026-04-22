/**
 * Réaligne migration_checksums sur le fichier actuel
 * backend/migrations/1776600000000_lead_sources_acquisition_canonical.js
 * (même logique normalize + hash que migrationManager.service.js).
 *
 * Audit seul :
 *   node scripts/reconcile-177660-lead-sources-migration-checksum.mjs
 *
 * Écriture en base :
 *   MIGRATION_RECONCILE_177660=1 node scripts/reconcile-177660-lead-sources-migration-checksum.mjs
 *   npm run reconcile:migration:177660-lead-sources:commit
 */

import "../config/load-env.js";
import crypto from "crypto";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const MIGRATION_NAME = "1776600000000_lead_sources_acquisition_canonical";
const FILE = path.join(__dirname, "../migrations", `${MIGRATION_NAME}.js`);

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

async function main() {
  if (!fs.existsSync(FILE)) {
    console.error("Fichier migration introuvable:", FILE);
    process.exit(1);
  }

  const content = fs.readFileSync(FILE, "utf8");
  const checksum = hashMigration(content);
  const normalizedBody = normalizeMigrationContent(content);
  const checksumNormalized = hashMigration(normalizedBody);

  const r = await pool.query(
    "SELECT checksum, checksum_normalized FROM migration_checksums WHERE migration_name = $1",
    [MIGRATION_NAME]
  );
  console.log("Fichier:", FILE);
  console.log("checksum (brut) actuel fichier:", checksum);
  console.log("checksum_normalized actuel fichier:", checksumNormalized);
  if (r.rows.length === 0) {
    console.log("Aucune ligne migration_checksums pour cette migration — rien à réconcilier.");
    await pool.end();
    return;
  }
  console.log("checksum (brut) en base:", r.rows[0].checksum);
  console.log("checksum_normalized en base:", r.rows[0].checksum_normalized);

  const okRaw = r.rows[0].checksum === checksum;
  const okNorm = r.rows[0].checksum_normalized === checksumNormalized;
  if (okRaw && okNorm) {
    console.log("OK — déjà aligné.");
    await pool.end();
    return;
  }

  const wantsCommit =
    process.argv.includes("--commit") ||
    String(process.env.MIGRATION_RECONCILE_177660 || "").trim() === "1";
  if (!wantsCommit) {
    console.warn(
      "Dérive détectée. Pour mettre à jour migration_checksums avec le fichier actuel, lancer :\n" +
        "  npm run reconcile:migration:177660-lead-sources:commit\n" +
        "  ou : MIGRATION_RECONCILE_177660=1 node scripts/reconcile-177660-lead-sources-migration-checksum.mjs"
    );
    await pool.end();
    process.exit(1);
  }

  await pool.query(
    `UPDATE migration_checksums
     SET checksum = $2, checksum_normalized = $3
     WHERE migration_name = $1`,
    [MIGRATION_NAME, checksum, checksumNormalized]
  );
  console.log("migration_checksums mis à jour pour", MIGRATION_NAME);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
