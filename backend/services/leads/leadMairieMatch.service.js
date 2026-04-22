/**
 * CP-MAIRIES-004 — Auto-affectation mairie ↔ lead (V1 : CP exact + ville si ambiguïté).
 */
import { cityComparisonKey } from "../mairies/mairies.validation.js";

/**
 * @param {import("pg").Pool} pool
 * @param {string} organizationId
 * @param {string | null | undefined} postalCodeRaw
 * @param {string | null | undefined} cityRaw
 * @returns {Promise<string | null>}
 */
export async function findAutoMatchMairieId(pool, organizationId, postalCodeRaw, cityRaw) {
  const pc = String(postalCodeRaw ?? "").trim();
  if (!pc) return null;
  const r = await pool.query(
    `SELECT id, city FROM mairies WHERE organization_id = $1 AND TRIM(postal_code) = $2`,
    [organizationId, pc]
  );
  const rows = r.rows;
  if (rows.length === 0) return null;
  if (rows.length === 1) return rows[0].id;
  const siteKey = cityComparisonKey(cityRaw);
  if (!siteKey) return null;
  const matched = rows.filter((row) => cityComparisonKey(row.city) === siteKey);
  if (matched.length === 1) return matched[0].id;
  return null;
}

/**
 * Si le lead n’a pas encore de mairie mais une adresse chantier, tente un match unique.
 * @param {import("pg").Pool} pool
 * @param {string} organizationId
 * @param {string} leadId
 */
export async function applyMairieAutoMatchIfEligible(pool, organizationId, leadId) {
  const lr = await pool.query(
    `SELECT mairie_id, site_address_id FROM leads WHERE id = $1 AND organization_id = $2`,
    [leadId, organizationId]
  );
  const row = lr.rows[0];
  if (!row || row.mairie_id != null) return;
  if (!row.site_address_id) return;
  const ar = await pool.query(
    `SELECT postal_code, city FROM addresses WHERE id = $1 AND organization_id = $2`,
    [row.site_address_id, organizationId]
  );
  const addr = ar.rows[0];
  if (!addr) return;
  const mid = await findAutoMatchMairieId(pool, organizationId, addr.postal_code, addr.city);
  if (!mid) return;
  await pool.query(
    `UPDATE leads SET mairie_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2 AND organization_id = $3 AND mairie_id IS NULL`,
    [mid, leadId, organizationId]
  );
}

/**
 * @param {import("pg").Pool} pool
 * @param {string} organizationId
 * @param {string | null | undefined} mairieId
 */
export async function assertMairieInOrg(pool, organizationId, mairieId) {
  if (mairieId == null || mairieId === "") return true;
  const r = await pool.query(
    `SELECT 1 FROM mairies WHERE id = $1 AND organization_id = $2`,
    [mairieId, organizationId]
  );
  return r.rows.length > 0;
}
