/**
 * Réconciliation contrôlée des checksums pour 1775920000000_mail_outbox_queue lorsque le fichier
 * reflète le DDL réellement appliqué (sans colonne reply_to) mais diffère byte-à-byte de l’historique
 * en migration_checksums (fichier non versionné / dérive impossible à restaurer).
 *
 * Audit seul :
 *   cd backend && node scripts/reconcile-mail-outbox-queue-checksum.js
 *
 * Après SCHEMA_MATCH — aligner checksum + checksum_normalized sur le fichier actuel :
 *   MIGRATION_RECONCILE=1 node scripts/reconcile-mail-outbox-queue-checksum.js
 *   node scripts/reconcile-mail-outbox-queue-checksum.js --commit-checksum
 */

import dotenv from "dotenv";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });
dotenv.config({ path: path.resolve(__dirname, "../.env"), override: false });

const MIGRATION_NAME = "1775920000000_mail_outbox_queue";
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const MIGRATION_FILE = path.join(MIGRATIONS_DIR, `${MIGRATION_NAME}.js`);

/** Colonnes attendues pour public.mail_outbox (aligné sur la migration sans reply_to). */
const MAIL_OUTBOX_EXPECTED = [
  { name: "id", udt: "uuid", nullable: false },
  { name: "organization_id", udt: "uuid", nullable: false },
  { name: "mail_account_id", udt: "uuid", nullable: false },
  { name: "created_by", udt: "uuid", nullable: false },
  { name: "mail_message_id", udt: "uuid", nullable: false },
  { name: "mail_thread_id", udt: "uuid", nullable: true },
  { name: "to_json", udt: "jsonb", nullable: false },
  { name: "cc_json", udt: "jsonb", nullable: false },
  { name: "bcc_json", udt: "jsonb", nullable: false },
  { name: "subject", udt: "text", nullable: true },
  { name: "body_html", udt: "text", nullable: true },
  { name: "body_text", udt: "text", nullable: true },
  { name: "from_name", udt: "text", nullable: true },
  { name: "attachments_manifest", udt: "jsonb", nullable: true },
  { name: "in_reply_to", udt: "text", nullable: true },
  { name: "references_json", udt: "jsonb", nullable: true },
  { name: "tracking_enabled", udt: "bool", nullable: false },
  { name: "status", udt: "mail_outbox_status", nullable: false },
  { name: "attempt_count", udt: "int4", nullable: false },
  { name: "max_attempts", udt: "int4", nullable: false },
  { name: "last_attempt_at", udt: "timestamptz", nullable: true },
  { name: "next_attempt_at", udt: "timestamptz", nullable: false },
  { name: "sent_at", udt: "timestamptz", nullable: true },
  { name: "last_error", udt: "text", nullable: true },
  { name: "provider_message_id", udt: "text", nullable: true },
  { name: "created_at", udt: "timestamptz", nullable: false },
  { name: "updated_at", udt: "timestamptz", nullable: false },
];

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

function normUdt(udt) {
  return String(udt || "").toLowerCase();
}

/**
 * @param {import("pg").Pool} pool
 * @returns {Promise<{ ok: boolean, issues: string[] }>}
 */
async function auditMailOutboxQueueSchema(pool) {
  const issues = [];

  const tbl = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'mail_outbox'
     ) AS ok`
  );
  if (!tbl.rows[0]?.ok) {
    issues.push("Table public.mail_outbox absente");
    return { ok: false, issues };
  }

  const cols = await pool.query(
    `SELECT column_name, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'mail_outbox'`
  );
  const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));

  for (const exp of MAIL_OUTBOX_EXPECTED) {
    const r = byName[exp.name];
    if (!r) {
      issues.push(`Colonne mail_outbox.${exp.name} absente`);
      continue;
    }
    const wantNull = exp.nullable ? "YES" : "NO";
    if (r.is_nullable !== wantNull) {
      issues.push(`mail_outbox.${exp.name}: nullabilité attendue ${wantNull}, trouvé ${r.is_nullable}`);
    }
    if (normUdt(r.udt_name) !== normUdt(exp.udt)) {
      issues.push(`mail_outbox.${exp.name}: type udt attendu ${exp.udt}, trouvé ${r.udt_name}`);
    }
  }

  const extra = cols.rows.filter((row) => !MAIL_OUTBOX_EXPECTED.some((e) => e.name === row.column_name));
  for (const row of extra) {
    if (row.column_name === "reply_to" && normUdt(row.udt_name) === "text") continue;
    issues.push(`Colonne inattendue sur mail_outbox: ${row.column_name}`);
  }

  const uq = await pool.query(
    `SELECT 1 FROM pg_constraint c
     JOIN pg_class rel ON rel.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND rel.relname = 'mail_outbox'
       AND c.conname = 'uq_mail_outbox_mail_message_id' AND c.contype = 'u'`
  );
  if (uq.rows.length === 0) {
    issues.push("Contrainte UNIQUE uq_mail_outbox_mail_message_id absente");
  }

  const idxRows = await pool.query(
    `SELECT indexname FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'mail_outbox' ORDER BY indexname`
  );
  const names = new Set(idxRows.rows.map((r) => r.indexname));
  for (const need of [
    "idx_mail_outbox_organization_id",
    "idx_mail_outbox_mail_account_id",
    "idx_mail_outbox_status",
    "idx_mail_outbox_next_attempt",
    "uq_mail_outbox_mail_message_id",
    "mail_outbox_pkey",
  ]) {
    if (!names.has(need)) issues.push(`Index / contrainte attendu introuvable: ${need}`);
  }

  const enumOut = await pool.query(
    `SELECT enumlabel FROM pg_enum e
     JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'mail_outbox_status'
     ORDER BY enumsortorder`
  );
  const wantEnum = ["queued", "sending", "sent", "retrying", "failed", "cancelled"];
  const got = enumOut.rows.map((r) => r.enumlabel);
  if (JSON.stringify(got) !== JSON.stringify(wantEnum)) {
    issues.push(`Enum mail_outbox_status: attendu ${JSON.stringify(wantEnum)}, trouvé ${JSON.stringify(got)}`);
  }

  const msgEnum = await pool.query(
    `SELECT enumlabel FROM pg_enum e
     JOIN pg_type t ON e.enumtypid = t.oid
     WHERE t.typname = 'mail_message_status' AND e.enumlabel IN ('QUEUED','SENDING')`
  );
  if (msgEnum.rows.length < 2) {
    issues.push("Valeurs QUEUED et/ou SENDING manquantes sur mail_message_status");
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[reconcile-mail-outbox-queue] DATABASE_URL manquant (.env.dev ou backend/.env).");
    process.exit(1);
  }

  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error("[reconcile-mail-outbox-queue] Fichier migration introuvable:", MIGRATION_FILE);
    process.exit(1);
  }

  const fileContent = fs.readFileSync(MIGRATION_FILE, "utf8");
  if (/^\s*reply_to\s*:\s*\{/m.test(fileContent)) {
    console.error(
      "[reconcile-mail-outbox-queue] Le fichier 1775920000000_mail_outbox_queue.js ne doit pas définir la colonne reply_to (utiliser 1775921000000_mail_outbox_queue_fix)."
    );
    process.exit(1);
  }

  const newChecksum = hashMigration(fileContent);
  const newNorm = hashMigration(normalizeMigrationContent(fileContent));

  console.log("[reconcile-mail-outbox-queue] Migration:", MIGRATION_NAME);
  console.log("[reconcile-mail-outbox-queue] SHA-256 brut fichier actuel:", newChecksum);
  console.log("[reconcile-mail-outbox-queue] SHA-256 normalisé fichier actuel:", newNorm);

  const { pool } = await import("../config/db.js");

  const applied = await pool.query(`SELECT 1 FROM pgmigrations WHERE name = $1`, [MIGRATION_NAME]);
  if (applied.rows.length === 0) {
    console.error("[reconcile-mail-outbox-queue] Migration absente de pgmigrations — réconciliation refusée.");
    await pool.end();
    process.exit(1);
  }

  const checksumRow = await pool.query(
    `SELECT checksum, checksum_normalized FROM migration_checksums WHERE migration_name = $1`,
    [MIGRATION_NAME]
  );
  if (checksumRow.rows.length === 0) {
    console.error("[reconcile-mail-outbox-queue] Aucune ligne migration_checksums — démarrer le backend une fois.");
    await pool.end();
    process.exit(1);
  }

  const oldChecksum = checksumRow.rows[0].checksum;
  const oldNorm = checksumRow.rows[0].checksum_normalized;
  console.log("[reconcile-mail-outbox-queue] Checksum stocké (brut):", oldChecksum);
  console.log("[reconcile-mail-outbox-queue] Checksum stocké (normalisé):", oldNorm);

  if (oldChecksum === newChecksum && oldNorm === newNorm) {
    console.log("[reconcile-mail-outbox-queue] Déjà aligné — aucune action.");
    await pool.end();
    process.exit(0);
  }

  console.log("\n[reconcile-mail-outbox-queue] --- Audit schéma (DB vs migration sans reply_to) ---\n");
  const audit = await auditMailOutboxQueueSchema(pool);

  if (!audit.ok) {
    console.error("VERDICT: SCHEMA_MISMATCH\n");
    for (const line of audit.issues) console.error("  -", line);
    console.error("\n[reconcile-mail-outbox-queue] Aucune écriture en base.");
    await pool.end();
    process.exit(1);
  }

  console.log("VERDICT: SCHEMA_MATCH — public.mail_outbox correspond à la migration 1775920000000 (sans reply_to).\n");

  const reconcile = wantsCommitChecksum();
  console.log("[reconcile-mail-outbox-queue] Écriture demandée (MIGRATION_RECONCILE=1 ou --commit-checksum):", reconcile);

  if (!reconcile) {
    console.log(
      "Pour aligner migration_checksums sur le fichier actuel (après validation manuelle) :\n" +
        "  MIGRATION_RECONCILE=1 node scripts/reconcile-mail-outbox-queue-checksum.js\n" +
        "  node scripts/reconcile-mail-outbox-queue-checksum.js --commit-checksum"
    );
    await pool.end();
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query(
      `SELECT checksum, checksum_normalized FROM migration_checksums WHERE migration_name = $1 FOR UPDATE`,
      [MIGRATION_NAME]
    );
    if (lock.rows.length === 0) throw new Error("Ligne migration_checksums disparue");

    const upd = await client.query(
      `UPDATE migration_checksums SET checksum = $1, checksum_normalized = $2 WHERE migration_name = $3`,
      [newChecksum, newNorm, MIGRATION_NAME]
    );
    if (upd.rowCount !== 1) throw new Error(`UPDATE rowCount=${upd.rowCount}`);

    await client.query("COMMIT");
    console.log("[reconcile-mail-outbox-queue] TRANSACTION COMMIT — checksums mis à jour.");
    console.log("[reconcile-mail-outbox-queue] Nouveau brut:", newChecksum);
    console.log("[reconcile-mail-outbox-queue] Nouveau normalisé:", newNorm);
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      /* ignore */
    }
    console.error("[reconcile-mail-outbox-queue] ROLLBACK —", e.message || e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }

  if (process.exitCode === 1) process.exit(1);
  console.log("[reconcile-mail-outbox-queue] Puis : node scripts/run-migrations-safe.js (applique 1775921000000 si besoin)");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
