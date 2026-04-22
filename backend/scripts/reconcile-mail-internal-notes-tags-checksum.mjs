/**
 * Réaligne migration_checksums pour 1775900013000_mail_internal_notes_tags
 * lorsque le fichier source a divergé (checksum normalisé différent) alors que le schéma
 * appliqué correspond toujours à l’intention de la migration actuelle.
 *
 * Usage : cd backend && node scripts/reconcile-mail-internal-notes-tags-checksum.mjs
 *         MIGRATION_RECONCILE=1 node scripts/reconcile-mail-internal-notes-tags-checksum.mjs
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

const { applyResolvedDatabaseUrl } = await import("../config/database-url.js");
applyResolvedDatabaseUrl();

const { pool } = await import("../config/db.js");

const MIGRATION_NAME = "1775900013000_mail_internal_notes_tags";
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

  for (const tbl of ["mail_thread_tags", "mail_thread_notes", "mail_thread_tag_links"]) {
    const t = await pool.query(
      `SELECT EXISTS (
         SELECT 1 FROM information_schema.tables
         WHERE table_schema = 'public' AND table_name = $1
       ) AS ok`,
      [tbl]
    );
    if (!t.rows[0]?.ok) issues.push(`table ${tbl} absente`);
  }

  const tagCols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mail_thread_tags'
       AND column_name = ANY($1::text[])`,
    [["id", "organization_id", "name", "created_at"]]
  );
  const haveTags = new Set(tagCols.rows.map((r) => r.column_name));
  for (const c of ["id", "organization_id", "name", "created_at"]) {
    if (!haveTags.has(c)) issues.push(`mail_thread_tags.${c} absent`);
  }

  const uq = await pool.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'mail_thread_tags'
       AND indexname = 'uq_mail_thread_tags_org_name_lower'`
  );
  if (uq.rows.length === 0) issues.push("index uq_mail_thread_tags_org_name_lower absent");

  const noteCols = await pool.query(
    `SELECT column_name FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mail_thread_notes'
       AND column_name = ANY($1::text[])`,
    [["thread_id", "content", "updated_at"]]
  );
  const haveNotes = new Set(noteCols.rows.map((r) => r.column_name));
  for (const c of ["thread_id", "content", "updated_at"]) {
    if (!haveNotes.has(c)) issues.push(`mail_thread_notes.${c} absent`);
  }

  const linkPk = await pool.query(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_class rel ON rel.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND rel.relname = 'mail_thread_tag_links' AND c.contype = 'p'`
  );
  if (linkPk.rows.length === 0) issues.push("PK mail_thread_tag_links absente");

  const trig = await pool.query(
    `SELECT tgname FROM pg_trigger t
     JOIN pg_class c ON c.oid = t.tgrelid
     JOIN pg_namespace n ON n.oid = c.relnamespace
     WHERE n.nspname = 'public' AND c.relname = 'mail_thread_notes'
       AND NOT t.tgisinternal AND tgname = 'trg_mail_thread_notes_updated_at'`
  );
  if (trig.rows.length === 0) issues.push("trigger trg_mail_thread_notes_updated_at absent");

  return { ok: issues.length === 0, issues };
}

if (!fs.existsSync(MIGRATION_FILE)) {
  console.error("Fichier migration introuvable:", MIGRATION_FILE);
  process.exit(1);
}

const content = fs.readFileSync(MIGRATION_FILE, "utf8");
const checksum = hashMigration(content);
const checksumNormalized = hashMigration(normalizeMigrationContent(content));

const audit = await auditSchema();
console.log("[reconcile 59013000] audit schéma:", audit.ok ? "OK" : "KO");
if (!audit.ok) console.log(audit.issues.join("\n"));

const row = await pool.query(
  `SELECT checksum, checksum_normalized FROM migration_checksums WHERE migration_name = $1`,
  [MIGRATION_NAME]
);

if (row.rows.length === 0) {
  console.error("Aucune ligne migration_checksums pour", MIGRATION_NAME);
  await pool.end();
  process.exit(1);
}

const cur = row.rows[0];
console.log("[reconcile 59013000] fichier brut:", checksum);
console.log("[reconcile 59013000] fichier normalisé:", checksumNormalized);
console.log("[reconcile 59013000] base brut:", cur.checksum);
console.log("[reconcile 59013000] base normalisé:", cur.checksum_normalized);

if (cur.checksum === checksum && cur.checksum_normalized === checksumNormalized) {
  console.log("Déjà aligné — rien à faire.");
  await pool.end();
  process.exit(0);
}

if (!audit.ok) {
  console.error("Schéma non conforme — ne pas mettre à jour migration_checksums.");
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
