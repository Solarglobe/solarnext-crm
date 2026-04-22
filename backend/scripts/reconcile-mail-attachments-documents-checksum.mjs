/**
 * Réaligne migration_checksums pour 1775900007000_mail_attachments_documents
 * lorsque le fichier source a été réécrit (ex. CRLF → LF) mais que le schéma
 * appliqué correspond toujours au code actuel (contrôle explicite avant UPDATE).
 *
 * Usage : cd backend && node scripts/reconcile-mail-attachments-documents-checksum.mjs
 *         MIGRATION_RECONCILE=1 node scripts/reconcile-mail-attachments-documents-checksum.mjs
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

const { pool } = await import("../config/db.js");

const MIGRATION_NAME = "1775900007000_mail_attachments_documents";
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

function wantsCommit() {
  return String(process.env.MIGRATION_RECONCILE || "").trim() === "1";
}

async function auditSchema() {
  const issues = [];

  const cols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mail_attachments'
       AND column_name = ANY($1::text[])`,
    [["document_id", "content_sha256"]]
  );
  const have = new Set(cols.rows.map((r) => r.column_name));
  for (const c of ["document_id", "content_sha256"]) {
    if (!have.has(c)) issues.push(`mail_attachments.${c} absent`);
  }

  const idx = await pool.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'mail_attachments'
       AND indexname = 'uq_mail_attachments_message_sha'`
  );
  if (idx.rows.length === 0) issues.push("index uq_mail_attachments_message_sha absent");

  const def = await pool.query(
    `SELECT pg_get_constraintdef(oid) AS def
     FROM pg_constraint
     WHERE conname = 'entity_documents_document_type_check'`
  );
  const d = def.rows[0]?.def || "";
  if (!d.includes("mail_attachment")) {
    issues.push("CHECK entity_documents_document_type_check ne contient pas mail_attachment");
  }

  return { ok: issues.length === 0, issues };
}

const content = fs.readFileSync(MIGRATION_FILE, "utf8");
const checksum = hashMigration(content);
const checksumNormalized = hashMigration(normalizeMigrationContent(content));

const audit = await auditSchema();
console.log("[reconcile 5907000] audit schéma:", audit.ok ? "OK" : "KO");
if (!audit.ok) console.log(audit.issues.join("\n"));

const row = await pool.query(
  `SELECT checksum, checksum_normalized FROM migration_checksums WHERE migration_name = $1`,
  [MIGRATION_NAME]
);
if (row.rows.length === 0) {
  console.error("Aucune ligne migration_checksums pour", MIGRATION_NAME);
  process.exit(1);
}

const cur = row.rows[0];
console.log("[reconcile 5907000] fichier brut:", checksum);
console.log("[reconcile 5907000] fichier normalisé:", checksumNormalized);
console.log("[reconcile 5907000] base brut:", cur.checksum);
console.log("[reconcile 5907000] base normalisé:", cur.checksum_normalized);

if (cur.checksum === checksum && cur.checksum_normalized === checksumNormalized) {
  console.log("Déjà aligné — rien à faire.");
  await pool.end();
  process.exit(0);
}

if (!audit.ok) {
  console.error("Schéma non conforme — pas d’UPDATE (corriger la base ou le fichier).");
  await pool.end();
  process.exit(1);
}

if (!wantsCommit()) {
  console.log(
    "Dry-run : définir MIGRATION_RECONCILE=1 pour appliquer l’UPDATE migration_checksums."
  );
  await pool.end();
  process.exit(0);
}

await pool.query(
  `UPDATE migration_checksums
   SET checksum = $1, checksum_normalized = $2
   WHERE migration_name = $3`,
  [checksum, checksumNormalized, MIGRATION_NAME]
);
console.log("migration_checksums mis à jour pour", MIGRATION_NAME);
await pool.end();
