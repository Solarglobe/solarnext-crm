/**
 * CP-ENERGY-001 — Normalisation JSON Enedis Data Connect (courbe de charge)
 *
 * Lit les variantes de réponses /metering_data/consumption_load_curve et
 * convertit vers le format interne SolarNext.
 *
 * @typedef {Object} SolarNextEnergyPoint
 * @property {string} timestamp - ISO avec timezone (ex. 2024-03-01T00:00:00+01:00)
 * @property {number} consumption_kwh
 *
 * @typedef {Object} SolarNextEnergyJSON
 * @property {string} pdl - Point de livraison (usage_point_id)
 * @property {"30m"} interval
 * @property {"kWh"} unit
 * @property {SolarNextEnergyPoint[]} data
 */

/**
 * Extrait un tableau d'interval_reading à partir de meter_reading (objet ou tableau).
 * @param {unknown} meterReading
 * @returns {Array<{ date?: string, value?: string | number | null }>}
 */
function getIntervalReadings(meterReading) {
  if (meterReading == null) return [];
  const list = Array.isArray(meterReading) ? meterReading : [meterReading];
  const out = [];
  for (const item of list) {
    if (item == null || typeof item !== "object") continue;
    const ir = item.interval_reading;
    if (Array.isArray(ir)) out.push(...ir);
  }
  return out;
}

/**
 * Parse une valeur Enedis (string ou number) en nombre Wh ; null/undefined → null.
 * @param {string | number | null | undefined} v
 * @returns {number | null}
 */
function parseWhValue(v) {
  if (v == null) return null;
  if (typeof v === "number") return Number.isNaN(v) ? null : v;
  const n = Number(String(v).trim());
  return Number.isNaN(n) ? null : n;
}

/**
 * Normalise la réponse Enedis consumption_load_curve vers le format SolarNext.
 * Gère meter_reading objet ou tableau, value null, Wh→kWh, tri chronologique.
 * Ne lève jamais : retourne un objet valide (data vide si erreur).
 *
 * @param {unknown} response - Réponse JSON brute Enedis
 * @returns {SolarNextEnergyJSON}
 */
export function normalizeEnedisLoadCurve(response) {
  const empty = {
    pdl: "",
    interval: "30m",
    unit: "kWh",
    data: [],
  };

  if (response == null || typeof response !== "object") {
    return empty;
  }

  const obj = /** @type {Record<string, unknown>} */ (response);
  const pdl = typeof obj.usage_point_id === "string" ? obj.usage_point_id : "";

  const meterReading = obj.meter_reading;
  const readings = getIntervalReadings(meterReading);

  const data = [];
  for (const r of readings) {
    if (r == null || typeof r !== "object") continue;
    const date = r.date;
    const timestamp = typeof date === "string" && date.trim() ? date.trim() : null;
    if (!timestamp) continue;

    const raw = parseWhValue(r.value);
    if (raw == null) continue;

    const consumption_kwh = raw > 10000 ? raw / 1000 : raw;
    data.push({ timestamp, consumption_kwh });
  }

  data.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));

  const out = {
    pdl,
    interval: "30m",
    unit: "kWh",
    data,
  };
  if (process.env.NODE_ENV !== "production") {
    out.unit_hint = "WH_ENEDIS";
  }
  return out;
}
