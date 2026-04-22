/**
 * CP-080 — TVA par défaut et helpers lecture settings_json.finance / quote
 */

/**
 * @param {unknown} settingsJson
 * @returns {number} taux TVA en pourcentage (ex. 20 pour 20 %)
 */
export function pickDefaultVatFromSettingsJson(settingsJson) {
  const v = settingsJson?.finance?.default_vat_rate;
  const n = Number(v);
  if (Number.isFinite(n) && n >= 0 && n <= 100) return n;
  return 20;
}

/**
 * @param {import("pg").Pool|import("pg").PoolClient} poolOrClient
 * @param {string} organizationId
 */
export async function getOrgDefaultVatRate(poolOrClient, organizationId) {
  const r = await poolOrClient.query(`SELECT settings_json FROM organizations WHERE id = $1`, [organizationId]);
  return pickDefaultVatFromSettingsJson(r.rows[0]?.settings_json);
}

/**
 * @param {unknown} rawItem
 * @param {number} defaultVat
 */
export function resolveLineVatRate(rawItem, defaultVat) {
  if (rawItem == null || typeof rawItem !== "object") return defaultVat;
  if (!Object.prototype.hasOwnProperty.call(rawItem, "tva_rate")) return defaultVat;
  const tr = rawItem.tva_rate;
  if (tr === null || tr === "") return defaultVat;
  const r = Number(tr);
  return Number.isFinite(r) ? r : defaultVat;
}
