import pg from "pg";
import { sanitizeCalpinageGeometryForPersistence } from "../services/calpinage/calpinageCommercialIntegrity.js";

const { Pool } = pg;
const databaseUrl = String(process.env.DATABASE_URL || "").trim();
const allow = process.env.CALPINAGE_PROD_READONLY_AUDIT === "1";

if (!databaseUrl) {
  throw new Error("DATABASE_URL requis pour l'audit read-only");
}
if (!allow) {
  throw new Error("CALPINAGE_PROD_READONLY_AUDIT=1 requis pour confirmer l'audit lecture seule");
}
if (new URL(databaseUrl).hostname.toLowerCase().includes("railway")) {
  throw new Error("Audit read-only refusé: DATABASE_URL Railway obsolète, backend attendu chez Infomaniak");
}

const READ_ONLY_SQL = /^(?:\s*(?:\/\*[\s\S]*?\*\/\s*)*)?(SELECT|SHOW|SET|BEGIN|START|ROLLBACK|COMMIT)\b/i;
const FORBIDDEN_SQL = /\b(INSERT|UPDATE|DELETE|UPSERT|MERGE|ALTER|DROP|TRUNCATE|CREATE|GRANT|REVOKE|CALL|DO|COPY|VACUUM|ANALYZE|LOCK)\b/i;

function assertReadOnlySql(sql) {
  const text = String(sql || "");
  if (!READ_ONLY_SQL.test(text) || FORBIDDEN_SQL.test(text)) {
    throw new Error(`Requete interdite en audit read-only: ${text.slice(0, 80)}`);
  }
}

function providerFromUrl(url) {
  const host = new URL(url).hostname.toLowerCase();
  if (host.includes("supabase")) return "Supabase PostgreSQL";
  if (host.includes("neon")) return "Neon PostgreSQL";
  if (host.includes("render")) return "Render PostgreSQL";
  if (host.includes("amazonaws") || host.includes("rds")) return "AWS/RDS-compatible PostgreSQL";
  return "PostgreSQL distant";
}

const expectedColumns = {
  calpinage_data: ["organization_id", "study_version_id", "geometry_json", "total_panels"],
  calpinage_snapshots: [
    "id",
    "study_id",
    "study_version_id",
    "organization_id",
    "version_number",
    "snapshot_json",
    "created_by",
    "created_at",
  ],
  studies: ["id", "organization_id"],
  study_versions: ["id", "study_id", "organization_id"],
};

const pool = new Pool({
  connectionString: databaseUrl,
  max: 1,
  idleTimeoutMillis: 5_000,
  connectionTimeoutMillis: 5_000,
  statement_timeout: 10_000,
  query_timeout: 10_000,
  application_name: "solarnext-calpinage-readonly-audit",
});

const client = await pool.connect();
const safeClient = {
  query(sql, params) {
    assertReadOnlySql(sql);
    return client.query(sql, params);
  },
};

const report = {
  provider: providerFromUrl(databaseUrl),
  transaction: {},
  schema: {},
  migrations: {},
  snapshots: {},
};

try {
  await safeClient.query("BEGIN READ ONLY");
  await safeClient.query("SET TRANSACTION READ ONLY");
  const readOnlyResult = await safeClient.query("SHOW transaction_read_only");
  const transactionReadOnly = readOnlyResult.rows[0]?.transaction_read_only;
  if (transactionReadOnly !== "on") {
    throw new Error("Audit read-only refusé: transaction_read_only != on");
  }
  report.transaction.transaction_read_only = transactionReadOnly;

  const tableNames = Object.keys(expectedColumns);
  const tables = await safeClient.query(
    `SELECT table_name
     FROM information_schema.tables
     WHERE table_schema = 'public' AND table_name = ANY($1::text[])
     ORDER BY table_name`,
    [tableNames],
  );
  const presentTables = new Set(tables.rows.map((row) => row.table_name));

  for (const [table, columns] of Object.entries(expectedColumns)) {
    const colRes = await safeClient.query(
      `SELECT column_name
       FROM information_schema.columns
       WHERE table_schema = 'public' AND table_name = $1 AND column_name = ANY($2::text[])
       ORDER BY column_name`,
      [table, columns],
    );
    const presentColumns = new Set(colRes.rows.map((row) => row.column_name));
    report.schema[table] = {
      tablePresent: presentTables.has(table),
      missingColumns: columns.filter((column) => !presentColumns.has(column)),
    };
  }

  const indexRes = await safeClient.query(
    `SELECT tablename, indexname
     FROM pg_indexes
     WHERE schemaname = 'public'
       AND tablename = ANY($1::text[])
     ORDER BY tablename, indexname`,
    ["calpinage_data", "calpinage_snapshots"],
  );
  report.schema.indexes = indexRes.rows.reduce((acc, row) => {
    acc[row.tablename] ??= [];
    acc[row.tablename].push(row.indexname);
    return acc;
  }, {});

  const migrationTable = await safeClient.query(
    `SELECT to_regclass('public.pg_migrations') AS pg_migrations,
            to_regclass('public.migrations') AS migrations`,
  );
  report.migrations.tables = migrationTable.rows[0];
  if (migrationTable.rows[0]?.pg_migrations) {
    const migrationCount = await safeClient.query("SELECT COUNT(*)::int AS count FROM pg_migrations");
    report.migrations.pgMigrationsCount = migrationCount.rows[0]?.count ?? null;
  } else {
    report.migrations.pgMigrationsCount = null;
  }

  if (presentTables.has("calpinage_snapshots")) {
    const snapshotCount = await safeClient.query("SELECT COUNT(*)::int AS count FROM calpinage_snapshots");
    report.snapshots.totalCount = snapshotCount.rows[0]?.count ?? 0;

    const sample = await safeClient.query(
      `SELECT snapshot_json
       FROM calpinage_snapshots
       WHERE snapshot_json IS NOT NULL
       ORDER BY created_at DESC
       LIMIT 10`,
    );
    let compatible = 0;
    let incompatible = 0;
    for (const row of sample.rows) {
      try {
        const payload = row.snapshot_json?.payload ?? row.snapshot_json;
        sanitizeCalpinageGeometryForPersistence(payload);
        compatible += 1;
      } catch {
        incompatible += 1;
      }
    }
    report.snapshots.sampleSize = sample.rows.length;
    report.snapshots.compatibleInMemory = compatible;
    report.snapshots.incompatibleInMemory = incompatible;
  } else {
    report.snapshots.totalCount = null;
    }

  await safeClient.query("ROLLBACK");
  console.log(JSON.stringify(report, null, 2));
} catch (error) {
  try {
    await safeClient.query("ROLLBACK");
  } catch {
    // ignore rollback errors after connection failure
  }
  throw error;
} finally {
  client.release();
  await pool.end();
}
