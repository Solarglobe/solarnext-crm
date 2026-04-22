/**
 * Réaligne migration_checksums sur le fichier reconstitué 1776100000000_entity_documents_legal_cgv.js.
 *
 * Contexte : le fichier source avait été retiré du dépôt alors que la ligne pgmigrations existait déjà ;
 * le contenu a été reconstitué pour l’historique. Les empreintes en base référencent l’ancien fichier
 * inconnu — on les met à jour pour refléter le source versionné actuel, sans affaiblir verifyChecksums
 * (le fond up/down du fichier devient la nouvelle référence).
 *
 * Prérequis : la migration 1776100000000_entity_documents_legal_cgv figure dans pgmigrations.
 *
 * Usage (audit seul) :
 *   cd backend && node scripts/reconcile-177610-entity-documents-legal-cgv-checksum.mjs
 *
 * Écriture :
 *   MIGRATION_RECONCILE=1 node scripts/reconcile-177610-entity-documents-legal-cgv-checksum.mjs
 *   node scripts/reconcile-177610-entity-documents-legal-cgv-checksum.mjs --commit-checksum
 */

import crypto from "crypto";
import dotenv from "dotenv";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

const MIGRATION_NAME = "1776100000000_entity_documents_legal_cgv";
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const MIGRATION_FILE = path.join(MIGRATIONS_DIR, `${MIGRATION_NAME}.js`);

/** Aligné sur migrationManager.service.js */
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

function hashMigration(content) {
  return crypto.createHash("sha256").update(content).digest("hex");
}

function wantsCommitChecksum() {
  if (process.argv.includes("--commit-checksum")) return true;
  const raw = process.env.MIGRATION_RECONCILE;
  if (raw === undefined || raw === null) return false;
  return String(raw).trim() === "1";
}

async function main() {
  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error("[reconcile-177610] Fichier migration introuvable:", MIGRATION_FILE);
    process.exit(1);
  }

  const applied = await pool.query(`SELECT run_on FROM pgmigrations WHERE name = $1`, [MIGRATION_NAME]);
  if (applied.rows.length === 0) {
    console.error("[reconcile-177610] Migration absente de pgmigrations — réconciliation refusée.");
    process.exit(1);
  }

  const def = await pool.query(`
    SELECT pg_get_constraintdef(oid) AS def
    FROM pg_constraint
    WHERE conname = 'entity_documents_document_type_check'
  `);
  const d = String(def.rows[0]?.def || "");
  if (d.includes("'organization_legal_cgv'") && !d.includes("'legal_cgv'")) {
    console.log(
      "[reconcile-177610] Note : la contrainte reflète déjà l’état post-177620 (organization_legal_*). " +
        "Si 177620 est appliquée, on réaligne seulement les empreintes du fichier 177610 versionné."
    );
  }

  const content = fs.readFileSync(MIGRATION_FILE, "utf8");
  const checksum = hashMigration(content);
  const checksumNormalized = hashMigration(normalizeMigrationContent(content));

  console.log("[reconcile-177610] pgmigrations OK — exécutée le", applied.rows[0].run_on);
  console.log("[reconcile-177610] Empreintes fichier :", { checksum, checksumNormalized });

  if (!wantsCommitChecksum()) {
    console.log("[reconcile-177610] Audit seul — aucune écriture. Pour aligner migration_checksums : MIGRATION_RECONCILE=1 ou --commit-checksum");
    await pool.end();
    return;
  }

  await pool.query(
    `INSERT INTO migration_checksums (migration_name, checksum, checksum_normalized)
     VALUES ($1, $2, $3)
     ON CONFLICT (migration_name) DO UPDATE SET checksum = $2, checksum_normalized = $3`,
    [MIGRATION_NAME, checksum, checksumNormalized]
  );
  console.log("[reconcile-177610] migration_checksums mis à jour pour", MIGRATION_NAME);
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
