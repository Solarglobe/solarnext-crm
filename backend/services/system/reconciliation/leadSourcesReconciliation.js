/** Explicit one-off proposal. Not imported by startup or the migration runner. */
import fs from "node:fs";
import { isDeepStrictEqual } from "node:util";
import { hashMigration, normalizeMigrationContent } from "../migrationIntegrity.js";

export const TARGET = "1776600000000_lead_sources_acquisition_canonical";
export const OLD = Object.freeze({ checksum: "ddb257c4c0810f4c7b61bb05827d4dbacd104bfc96db7c53431a9a3932736959", checksum_normalized: "be9e86615c6334ed907795a77f8e6ea6081df755b3df9990a87dba57ed32468e" });
const expectedNormalized = "ebeb92491bb5658564a28affdc537f959e2c8b67ef8d50e620bacadaaca1705a";
const read = name => JSON.parse(fs.readFileSync(new URL(name, import.meta.url), "utf8"));
const expectedSchema = read("./leadSourcesExpectedSchema.json");
export const SCHEMA_SQL = Object.freeze(read("./leadSourcesSchemaQueries.json"));
const history = read("../../../tests/fixtures/migrations/production-history-2026-09-15.json");
export const CANONICAL_SOURCES = Object.freeze([
  ["porte_a_porte", "Porte à porte"], ["site_internet", "Site internet"],
  ["meta_ads", "Publicité Meta (Facebook / Instagram)"], ["google_ads", "Google Ads"],
  ["seo", "SEO (référencement naturel)"], ["flyer_boitage", "Flyer / Boîtage"],
  ["salon_evenement", "Salon / événement"], ["recommandation", "Recommandation (bouche à oreille)"],
  ["client_existant", "Client existant"], ["partenaire_apporteur", "Partenaire / apporteur d'affaires"],
  ["appel_entrant", "Appel entrant"], ["email_entrant", "Email entrant"],
  ["marketplace", "Marketplace / plateforme leads"], ["autre", "Autre"],
].map(([slug, name], index) => ({ slug, name, sort_order: index + 1 })));
export const SQL = Object.freeze({
  identity: "SELECT current_database() AS database, inet_server_addr()::text AS address, inet_server_port() AS port, current_setting('server_version_num')::int AS version",
  lock: "SELECT migration_name, checksum, checksum_normalized FROM public.migration_checksums WHERE migration_name=$1 FOR UPDATE NOWAIT",
  applied: "SELECT COALESCE(json_agg(to_jsonb(m) ORDER BY id),'[]') AS rows FROM public.pgmigrations m",
  checksums: "SELECT COALESCE(json_agg(to_jsonb(m) ORDER BY migration_name),'[]') AS rows FROM public.migration_checksums m",
  // Row data stays in the database. Only violation counts leave this query.
  data: `WITH expected AS (SELECT * FROM jsonb_to_recordset($1::jsonb) AS x(slug text,name text,sort_order integer)),
    expected_rows AS (SELECT o.id AS organization_id,e.* FROM public.organizations o CROSS JOIN expected e)
    SELECT
    (SELECT count(*)::int FROM expected_rows e LEFT JOIN public.lead_sources s ON s.organization_id=e.organization_id AND s.slug=e.slug WHERE s.id IS NULL OR s.name IS DISTINCT FROM e.name OR s.sort_order IS DISTINCT FROM e.sort_order) AS missing_or_changed,
    (SELECT count(*)::int FROM public.lead_sources s LEFT JOIN expected_rows e ON s.organization_id=e.organization_id AND s.slug=e.slug WHERE e.slug IS NULL OR s.id IS NULL OR s.created_at IS NULL) AS unexpected,
    (SELECT count(*)::int FROM (SELECT organization_id,slug FROM public.lead_sources GROUP BY organization_id,slug HAVING count(*)<>1) d) AS duplicates,
    (SELECT count(*)::int FROM public.leads l LEFT JOIN public.lead_sources s ON s.id=l.source_id WHERE s.id IS NULL OR l.organization_id IS DISTINCT FROM s.organization_id) AS bad_references,
    (SELECT count(*)::int FROM public.lead_sources) AS sources`,
  // User rules, RLS and metadata triggers could hide records or expand the UPDATE.
  safety: `SELECT c.relname,c.relkind,c.relrowsecurity,c.relforcerowsecurity,
    (SELECT count(*)::int FROM pg_rewrite r WHERE r.ev_class=c.oid) AS rules,
    CASE WHEN c.relname IN ('pgmigrations','migration_checksums') THEN (SELECT count(*)::int FROM pg_trigger t WHERE t.tgrelid=c.oid AND NOT t.tgisinternal) ELSE 0 END AS metadata_triggers
    FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relname IN ('lead_sources','leads','organizations','pgmigrations','migration_checksums') ORDER BY c.relname`,
  update: `UPDATE public.migration_checksums SET checksum=$2, checksum_normalized=$3
    WHERE migration_name=$1 AND checksum=$4 AND checksum_normalized=$5
    RETURNING migration_name, checksum, checksum_normalized`,
});
export const fail = code => Object.assign(new Error(code), { code });
const requireEqual = (a, b, code) => { if (!isDeepStrictEqual(a, b)) throw fail(code); };
export function currentReference() {
  const content = fs.readFileSync(new URL(`../../../migrations/${TARGET}.js`, import.meta.url), "utf8");
  const normalized = hashMigration(normalizeMigrationContent(content));
  requireEqual(normalized, expectedNormalized, "RECONCILIATION_SOURCE_CHANGED");
  return { checksum: hashMigration(content), checksum_normalized: normalized };
}
async function metadata(client) {
  return { applied: (await client.query(SQL.applied)).rows[0].rows, checksums: (await client.query(SQL.checksums)).rows[0].rows };
}
function withReference(rows, reference) {
  return rows.map(row => row.migration_name === TARGET ? { ...row, ...reference } : row);
}
export async function checkPreconditions(client, reference = OLD) {
  const meta = await metadata(client);
  requireEqual(meta.applied, history.applied, "RECONCILIATION_APPLIED_HISTORY_CHANGED");
  requireEqual(meta.checksums, withReference(history.checksums, reference), "RECONCILIATION_CHECKSUM_HISTORY_CHANGED");
  for (const [key, query] of Object.entries(SCHEMA_SQL)) {
    requireEqual((await client.query(query)).rows, expectedSchema[key], "RECONCILIATION_SCHEMA_" + key.toUpperCase());
  }
  const safety = (await client.query(SQL.safety)).rows;
  if (safety.length !== 5 || safety.some(row => row.relkind !== "r" || row.relrowsecurity || row.relforcerowsecurity || row.rules || row.metadata_triggers)) throw fail("RECONCILIATION_UNSAFE_RELATION");
  const data = (await client.query(SQL.data, [JSON.stringify(CANONICAL_SOURCES)])).rows[0];
  if (!data.sources || data.missing_or_changed || data.unexpected || data.duplicates || data.bad_references) throw fail("RECONCILIATION_DATA_DIFFERENT");
  return { meta, sources: data.sources };
}

/** The only explicit row lock is the exact checksum row; SELECTs take normal
 * AccessShare locks. Operators must stop writers before APPLY. The serializable
 * snapshot is not a substitute for maintenance mode with non-serializable writers.
 * Receipt must fsync PREPARED before returning. Never records business row values.
 */
export async function reconcileLeadSources({ client, mode = "dry-run", confirmDatabase, writersStopped = false, receipt, priorReceipt, signal }) {
  if (!["dry-run", "apply", "verify"].includes(mode)) throw fail("RECONCILIATION_MODE_INVALID");
  if (!confirmDatabase) throw fail("RECONCILIATION_DATABASE_CONFIRMATION_REQUIRED");
  if (mode === "apply" && (!writersStopped || !receipt)) throw fail("RECONCILIATION_APPLY_CONFIRMATIONS_REQUIRED");
  if (mode === "verify" && !priorReceipt) throw fail("RECONCILIATION_RECEIPT_REQUIRED");
  const active = () => { if (signal?.aborted) throw fail("RECONCILIATION_INTERRUPTED"); };
  const next = currentReference(); let committed = false;
  await client.query(`BEGIN ISOLATION LEVEL SERIALIZABLE ${mode === "apply" ? "READ WRITE" : "READ ONLY"}`);
  try {
    await client.query("SET LOCAL search_path TO pg_catalog, public");
    await client.query("SET LOCAL statement_timeout='15s'");
    await client.query("SET LOCAL lock_timeout='1s'");
    const identity = (await client.query(SQL.identity)).rows[0];
    if (identity.database !== confirmDatabase || identity.version !== 140024) throw fail("RECONCILIATION_TARGET_DIFFERENT");
    active();
    if (mode === "apply") {
      const locked = (await client.query(SQL.lock, [TARGET])).rows;
      requireEqual(locked, [{ migration_name: TARGET, ...OLD }], "RECONCILIATION_OLD_REFERENCE_DIFFERENT");
    }
    if (mode === "verify") {
      if (priorReceipt.version !== 1 || priorReceipt.state !== "PREPARED") throw fail("RECONCILIATION_RECEIPT_FORMAT_INVALID");
      requireEqual(priorReceipt.target, identity, "RECONCILIATION_RECEIPT_TARGET_DIFFERENT");
      requireEqual(priorReceipt.migration, TARGET, "RECONCILIATION_RECEIPT_MIGRATION_DIFFERENT");
      requireEqual(priorReceipt.previous, history.checksums.find(row => row.migration_name === TARGET), "RECONCILIATION_RECEIPT_PREVIOUS_DIFFERENT");
      requireEqual(priorReceipt.next, next, "RECONCILIATION_RECEIPT_NEXT_DIFFERENT");
    }
    // Inspect even in verify mode; a receipt is never an exemption to preconditions.
    const check = await checkPreconditions(client, mode === "verify" ? next : OLD);
    active();
    if (mode === "apply") {
      await receipt({ version: 1, state: "PREPARED", at: new Date().toISOString(), migration: TARGET,
        target: identity, previous: check.meta.checksums.find(row => row.migration_name === TARGET), next });
      active();
      const changed = await client.query(SQL.update, [TARGET, next.checksum, next.checksum_normalized, OLD.checksum, OLD.checksum_normalized]);
      requireEqual(changed.rows, [{ migration_name: TARGET, ...next }], "RECONCILIATION_UPDATE_NOT_EXACT");
      await checkPreconditions(client, next);
      active();
      await client.query("COMMIT"); committed = true;
    } else { await client.query("ROLLBACK"); }
    return { mode, status: mode === "apply" ? "APPLIED_VERIFY_RECEIPT_REQUIRED" : "COMPATIBLE", migration: TARGET, changed: committed ? 1 : 0, sources_checked: check.sources };
  } catch (error) {
    if (!committed) { try { await client.query("ROLLBACK"); } catch { /* Caller must reconnect and inspect the saved receipt after an unknown commit. */ } }
    // Database errors may contain row data. Never surface their messages or details.
    throw fail(error?.code?.startsWith("RECONCILIATION_") ? error.code : "RECONCILIATION_TRANSACTION_REFUSED");
  }
}
