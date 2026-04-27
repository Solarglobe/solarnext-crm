/**
 * Réconciliation contrôlée du checksum d'une migration appliquée dont le fichier source
 * a divergé du hash stocké (migration_checksums).
 *
 * Usage (audit seul, sans écriture) :
 *   cd backend && node scripts/reconcile-migration-checksum.js
 *
 * Réconciliation transactionnelle (après SCHEMA_MATCH) — une des deux formes :
 *   MIGRATION_RECONCILE=1 node scripts/reconcile-migration-checksum.js
 *   node scripts/reconcile-migration-checksum.js --commit-checksum
 * (sous Windows cmd : éviter un espace après « 1 » dans set MIGRATION_RECONCILE=1)
 *
 * Ne met à jour migration_checksums que si le schéma réel correspond à l'intention
 * de backend/migrations/1775000000000_lead_meters_multimeter.js
 */

import "../config/register-local-env.js";
import path from "path";
import fs from "fs";
import crypto from "crypto";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const MIGRATION_NAME = "1775000000000_lead_meters_multimeter";
const MIGRATIONS_DIR = path.resolve(__dirname, "../migrations");
const MIGRATION_FILE = path.join(MIGRATIONS_DIR, `${MIGRATION_NAME}.js`);

/** Colonnes attendues pour public.lead_meters (aligné sur la migration actuelle). */
const LEAD_METERS_EXPECTED = [
  { name: "id", udt: "uuid", nullable: false },
  { name: "organization_id", udt: "uuid", nullable: false },
  { name: "lead_id", udt: "uuid", nullable: false },
  { name: "name", udt: "varchar", nullable: false, maxLen: 120 },
  { name: "is_default", udt: "bool", nullable: false },
  { name: "sort_order", udt: "int4", nullable: false },
  { name: "consumption_pdl", udt: "varchar", nullable: true, maxLen: 50 },
  { name: "meter_power_kva", udt: "int4", nullable: true },
  { name: "grid_type", udt: "varchar", nullable: true, maxLen: 20 },
  { name: "consumption_mode", udt: "varchar", nullable: true, maxLen: 20 },
  { name: "consumption_annual_kwh", udt: "int4", nullable: true },
  { name: "consumption_annual_calculated_kwh", udt: "int4", nullable: true },
  { name: "consumption_profile", udt: "varchar", nullable: true, maxLen: 20 },
  { name: "hp_hc", udt: "bool", nullable: false },
  { name: "supplier_name", udt: "varchar", nullable: true, maxLen: 80 },
  { name: "tariff_type", udt: "varchar", nullable: true, maxLen: 20 },
  { name: "energy_profile", udt: "jsonb", nullable: true },
  { name: "equipement_actuel", udt: "varchar", nullable: true, maxLen: 50 },
  { name: "equipement_actuel_params", udt: "jsonb", nullable: true },
  { name: "equipements_a_venir", udt: "jsonb", nullable: true },
  { name: "created_at", udt: "timestamptz", nullable: false },
  { name: "updated_at", udt: "timestamptz", nullable: false },
];

const CHECK_NAMES = [
  "lead_meters_consumption_mode_check",
  "lead_meters_meter_power_kva_check",
  "lead_meters_consumption_annual_kwh_check",
  "lead_meters_consumption_annual_calculated_check",
];

function hashMigrationFile() {
  const content = fs.readFileSync(MIGRATION_FILE, "utf8");
  return crypto.createHash("sha256").update(content).digest("hex");
}

/** true si l’utilisateur demande explicitement l’écriture en base (env normalisé ou flag CLI). */
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
async function auditLeadMetersMultimeterSchema(pool) {
  const issues = [];

  const tbl = await pool.query(
    `SELECT EXISTS (
       SELECT 1 FROM information_schema.tables
       WHERE table_schema = 'public' AND table_name = 'lead_meters'
     ) AS ok`
  );
  if (!tbl.rows[0]?.ok) {
    issues.push('Table public.lead_meters absente');
    return { ok: false, issues };
  }

  const cols = await pool.query(
    `SELECT column_name, udt_name, is_nullable, character_maximum_length
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'lead_meters'`
  );
  const byName = Object.fromEntries(cols.rows.map((r) => [r.column_name, r]));

  for (const exp of LEAD_METERS_EXPECTED) {
    const r = byName[exp.name];
    if (!r) {
      issues.push(`Colonne lead_meters.${exp.name} absente`);
      continue;
    }
    const wantNull = exp.nullable ? "YES" : "NO";
    if (r.is_nullable !== wantNull) {
      issues.push(
        `lead_meters.${exp.name}: nullabilité attendue ${wantNull}, trouvé ${r.is_nullable}`
      );
    }
    if (normUdt(r.udt_name) !== normUdt(exp.udt)) {
      issues.push(
        `lead_meters.${exp.name}: type udt attendu ${exp.udt}, trouvé ${r.udt_name}`
      );
    }
    if (exp.maxLen != null && r.character_maximum_length !== exp.maxLen) {
      issues.push(
        `lead_meters.${exp.name}: longueur varchar attendue ${exp.maxLen}, trouvé ${r.character_maximum_length}`
      );
    }
  }

  const pk = await pool.query(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_class rel ON rel.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND rel.relname = 'lead_meters' AND c.contype = 'p'`
  );
  if (pk.rows.length === 0) {
    issues.push("PK manquante sur lead_meters");
  }

  const fks = await pool.query(
    `SELECT conname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     JOIN pg_class rel ON rel.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND rel.relname = 'lead_meters' AND c.contype = 'f'`
  );
  const fkDefs = fks.rows.map((r) => r.def.toLowerCase());
  const needOrg = fkDefs.some((d) => d.includes("organization_id") && d.includes("organizations"));
  const needLead = fkDefs.some((d) => d.includes("lead_id") && d.includes("leads"));
  if (!needOrg) issues.push("FK lead_meters.organization_id → organizations introuvable ou inattendue");
  if (!needLead) issues.push("FK lead_meters.lead_id → leads introuvable ou inattendue");

  const checks = await pool.query(
    `SELECT c.conname
     FROM pg_constraint c
     JOIN pg_class rel ON rel.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND rel.relname = 'lead_meters' AND c.contype = 'c'`
  );
  const checkSet = new Set(checks.rows.map((r) => r.conname));
  for (const cn of CHECK_NAMES) {
    if (!checkSet.has(cn)) {
      issues.push(`CHECK ${cn} absente sur lead_meters`);
    }
  }

  const idxRows = await pool.query(
    `SELECT indexname, indexdef FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'lead_meters'`
  );
  const allDefsNorm = idxRows.rows.map((r) => r.indexdef.replace(/\s+/g, " ").toLowerCase());
  const hasPartialDefault = allDefsNorm.some(
    (d) =>
      d.includes("lead_meters_one_default_per_lead") &&
      d.includes("unique") &&
      d.includes("is_default")
  );
  /** Exclure l’index partiel unique sur lead_id (sinon il est confondu avec l’index btree simple sur lead_id). */
  const defs = idxRows.rows
    .filter((r) => r.indexname !== "lead_meters_one_default_per_lead")
    .map((r) => r.indexdef.replace(/\s+/g, " ").toLowerCase());

  const hasOrg = defs.some(
    (d) => d.includes("btree (organization_id)") && !d.includes("(organization_id,")
  );
  const hasLeadOnly = defs.some((d) => d.includes("btree (lead_id)") && !d.includes("(lead_id,"));
  const hasLeadSort = defs.some((d) => d.includes("btree (lead_id, sort_order)"));

  if (!hasOrg) issues.push("Index btree (organization_id) sur lead_meters introuvable");
  if (!hasLeadOnly) issues.push("Index btree (lead_id) seul sur lead_meters introuvable");
  if (!hasLeadSort) issues.push("Index btree (lead_id, sort_order) sur lead_meters introuvable");
  if (!hasPartialDefault) {
    issues.push("Index unique partiel lead_meters_one_default_per_lead (lead_id) WHERE is_default introuvable");
  }

  const lcmCols = await pool.query(
    `SELECT column_name, udt_name, is_nullable
     FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'lead_consumption_monthly' AND column_name = 'meter_id'`
  );
  if (lcmCols.rows.length === 0) {
    issues.push("Colonne lead_consumption_monthly.meter_id absente");
  } else {
    const m = lcmCols.rows[0];
    if (normUdt(m.udt_name) !== "uuid") {
      issues.push(`meter_id: type attendu uuid, trouvé ${m.udt_name}`);
    }
    if (m.is_nullable !== "NO") {
      issues.push("lead_consumption_monthly.meter_id doit être NOT NULL");
    }
  }

  const lcmIdx = await pool.query(
    `SELECT 1 FROM pg_indexes
     WHERE schemaname = 'public' AND tablename = 'lead_consumption_monthly'
       AND indexname = 'idx_lead_consumption_monthly_meter_id'`
  );
  if (lcmIdx.rows.length === 0) {
    issues.push("Index idx_lead_consumption_monthly_meter_id introuvable");
  }

  const lcmFks = await pool.query(
    `SELECT pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     JOIN pg_class rel ON rel.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND rel.relname = 'lead_consumption_monthly' AND c.contype = 'f'`
  );
  const meterFk = lcmFks.rows.some(
    (r) =>
      r.def.toLowerCase().includes("meter_id") && r.def.toLowerCase().includes("lead_meters")
  );
  if (!meterFk) issues.push("FK lead_consumption_monthly.meter_id → lead_meters introuvable");

  const lcmUnique = await pool.query(
    `SELECT c.conname, pg_get_constraintdef(c.oid) AS def
     FROM pg_constraint c
     JOIN pg_class rel ON rel.oid = c.conrelid
     JOIN pg_namespace n ON n.oid = rel.relnamespace
     WHERE n.nspname = 'public' AND rel.relname = 'lead_consumption_monthly' AND c.contype = 'u'`
  );
  const hasMeterYearMonth = lcmUnique.rows.some(
    (r) =>
      r.conname === "lcm_meter_year_month_unique" &&
      r.def.toLowerCase().includes("meter_id") &&
      r.def.toLowerCase().includes("year") &&
      r.def.toLowerCase().includes("month")
  );
  if (!hasMeterYearMonth) {
    issues.push("Contrainte UNIQUE lcm_meter_year_month_unique (meter_id, year, month) introuvable");
  }

  const oldUnique = lcmUnique.rows.some((r) => r.conname === "lcm_lead_year_month_unique");
  if (oldUnique) {
    issues.push(
      "Contrainte obsolète lcm_lead_year_month_unique encore présente (devrait être supprimée par la migration)"
    );
  }

  return { ok: issues.length === 0, issues };
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("[reconcile-migration-checksum] DATABASE_URL manquant (.env.dev ou backend/.env).");
    process.exit(1);
  }

  if (!fs.existsSync(MIGRATION_FILE)) {
    console.error("[reconcile-migration-checksum] Fichier migration introuvable:", MIGRATION_FILE);
    process.exit(1);
  }

  const newChecksum = hashMigrationFile();
  console.log("[reconcile-migration-checksum] Migration:", MIGRATION_NAME);
  console.log("[reconcile-migration-checksum] Fichier:", MIGRATION_FILE);
  console.log("[reconcile-migration-checksum] SHA-256 fichier actuel:", newChecksum);

  const { pool } = await import("../config/db.js");

  const applied = await pool.query(`SELECT 1 FROM pgmigrations WHERE name = $1`, [MIGRATION_NAME]);
  if (applied.rows.length === 0) {
    console.error(
      "[reconcile-migration-checksum] Cette migration n’apparaît pas dans pgmigrations — réconciliation refusée."
    );
    await pool.end();
    process.exit(1);
  }

  const checksumRow = await pool.query(
    `SELECT checksum FROM migration_checksums WHERE migration_name = $1`,
    [MIGRATION_NAME]
  );
  const oldChecksum = checksumRow.rows[0]?.checksum ?? null;
  if (oldChecksum == null) {
    console.error(
      "[reconcile-migration-checksum] Aucune ligne dans migration_checksums pour cette migration — rien à réconcilier (le manager peut en créer une au prochain démarrage si absent)."
    );
    await pool.end();
    process.exit(1);
  }
  console.log("[reconcile-migration-checksum] Checksum stocké en base (avant):", oldChecksum);

  if (oldChecksum === newChecksum) {
    console.log("[reconcile-migration-checksum] Déjà aligné — aucune action nécessaire.");
    await pool.end();
    process.exit(0);
  }

  console.log("\n[reconcile-migration-checksum] --- Audit schéma (DB vs intention migration actuelle) ---\n");
  const audit = await auditLeadMetersMultimeterSchema(pool);

  if (!audit.ok) {
    console.error("VERDICT: SCHEMA_MISMATCH\n");
    for (const line of audit.issues) {
      console.error("  -", line);
    }
    console.error(
      "\n[reconcile-migration-checksum] Aucune écriture dans migration_checksums (base non conforme au fichier actuel)."
    );
    await pool.end();
    process.exit(1);
  }

  console.log("VERDICT: SCHEMA_MATCH — le schéma public correspond aux attentes de la migration actuelle.\n");

  const reconcile = wantsCommitChecksum();
  console.log(
    "[reconcile-migration-checksum] Demande d’écriture (MIGRATION_RECONCILE trim='1' ou --commit-checksum) :",
    reconcile
  );
  if (process.env.MIGRATION_RECONCILE !== undefined) {
    console.log(
      "[reconcile-migration-checksum] MIGRATION_RECONCILE brut (JSON) :",
      JSON.stringify(process.env.MIGRATION_RECONCILE)
    );
  }

  if (!reconcile) {
    console.log(
      "Pour mettre à jour uniquement cette ligne dans migration_checksums, exécuter une des commandes :\n" +
        "  MIGRATION_RECONCILE=1 node scripts/reconcile-migration-checksum.js\n" +
        "  node scripts/reconcile-migration-checksum.js --commit-checksum\n" +
        "  npm run reconcile:migration:lead-meters:commit\n" +
        "(cmd.exe : set MIGRATION_RECONCILE=1 sans espace après 1, puis npm run …)\n" +
        "(PowerShell : $env:MIGRATION_RECONCILE='1'; npm run reconcile:migration:lead-meters)"
    );
    await pool.end();
    process.exit(0);
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const lock = await client.query(
      `SELECT checksum FROM migration_checksums WHERE migration_name = $1 FOR UPDATE`,
      [MIGRATION_NAME]
    );
    if (lock.rows.length === 0) {
      throw new Error("Ligne migration_checksums disparue pendant la transaction");
    }
    const lockedOld = lock.rows[0].checksum;
    if (lockedOld !== oldChecksum) {
      throw new Error(
        `Checksum concurrent : attendu ${oldChecksum}, lu ${lockedOld} — abandon pour éviter course critique`
      );
    }

    const upd = await client.query(
      `UPDATE migration_checksums SET checksum = $1 WHERE migration_name = $2`,
      [newChecksum, MIGRATION_NAME]
    );
    if (upd.rowCount !== 1) {
      throw new Error(`UPDATE migration_checksums: rowCount=${upd.rowCount} (attendu 1)`);
    }

    await client.query("COMMIT");
    console.log("[reconcile-migration-checksum] TRANSACTION COMMIT — checksum mis à jour.");
    console.log("[reconcile-migration-checksum] Ancien checksum:", oldChecksum);
    console.log("[reconcile-migration-checksum] Nouveau checksum:", newChecksum);
    console.log("[reconcile-migration-checksum] rowCount UPDATE :", upd.rowCount);
    console.log("\nÉtapes suivantes : npm run audit:migrations && npm run dev");
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch (rbErr) {
      console.error("[reconcile-migration-checksum] ROLLBACK secondaire :", rbErr.message || rbErr);
    }
    console.error("[reconcile-migration-checksum] ROLLBACK —", e.message || e);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end();
  }

  if (process.exitCode === 1) {
    process.exit(1);
  } else {
    console.log("[reconcile-migration-checksum] CHECKSUM UPDATED SUCCESSFULLY");
    console.log("[reconcile-migration-checksum] Lignes mises à jour : 1");
    process.exit(0);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
