/**
 * Normaliseur SwitchGrid — courbe de charge (loadCurve.csv + r65.csv + PDL JSON).
 * Format de sortie prêt pour buildEnergyProfile (mapper start → timestamp, kwh → consumption_kwh).
 *
 * @typedef {Object} SwitchGridNormalizedPoint
 * @property {string} start - ISO 8601
 * @property {string} end - ISO 8601 (start + 30 min)
 * @property {number} kwh
 *
 * @typedef {Object} SwitchGridNormalizedResult
 * @property {string} pdl
 * @property {"30m"} interval
 * @property {SwitchGridNormalizedPoint[]} data
 */

const INTERVAL_MS = 30 * 60 * 1000;

/**
 * Extrait le PDL depuis le JSON (point.attributes.id ou variantes).
 * @param {unknown} pdlJson
 * @returns {string}
 */
function extractPdl(pdlJson) {
  if (pdlJson == null || typeof pdlJson !== "object") return "";
  const point = /** @type {Record<string, unknown>} */ (pdlJson).point;
  if (point == null || typeof point !== "object") return "";
  const attrs = point.attributes;
  if (attrs != null && typeof attrs === "object" && typeof attrs.id === "string") {
    return String(attrs.id).trim();
  }
  const id = point.id;
  if (typeof id === "string") return id.trim();
  const dg = point.donneesGenerales;
  if (dg != null && typeof dg === "object") {
    const pid = /** @type {Record<string, unknown>} */ (dg).identifiantPDL ?? /** @type {Record<string, unknown>} */ (dg).id;
    if (typeof pid === "string") return pid.trim();
  }
  return "";
}

/**
 * Normalise une valeur décimale (virgule → point).
 * @param {string} raw
 * @returns {string}
 */
function normalizeDecimal(raw) {
  return String(raw).trim().replace(",", ".");
}

/**
 * Parse un timestamp vers une Date (ISO, nombre secondes/ms, ou Date.parse).
 * @param {string} raw
 * @returns {Date | null}
 */
function parseTimestamp(raw) {
  const s = String(raw).trim();
  if (!s) return null;
  const n = Number(normalizeDecimal(s));
  if (!Number.isNaN(n)) {
    const ms = n < 1e12 ? n * 1000 : n;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? null : d;
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * Détecte le séparateur CSV (; ou ,) à partir de la première ligne non vide.
 * @param {string} csv
 * @returns {"," | ";"}
 */
function detectSeparator(csv) {
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  for (const line of lines) {
    if (line.includes(";")) return ";";
    if (line.includes(",")) return ",";
  }
  return ",";
}

/**
 * Parse loadCurve CSV : timestamp + valeur énergie, intervalle 30 min.
 * @param {string} loadCurveCsv
 * @returns {{ start: string, end: string, kwh: number }[]}
 */
function parseLoadCurveCsv(loadCurveCsv) {
  if (typeof loadCurveCsv !== "string") {
    throw new Error("switchgridNormalizer: loadCurveCsv doit être une chaîne");
  }
  const trimmed = loadCurveCsv.trim();
  if (!trimmed) {
    throw new Error("switchgridNormalizer: loadCurveCsv est vide");
  }
  const sep = detectSeparator(trimmed);
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const data = [];
  for (let i = 0; i < lines.length; i++) {
    const parts = lines[i].split(sep).map((p) => p.trim());
    if (parts.length < 2) continue;
    const [tsRaw, valueRaw] = parts;
    const startDate = parseTimestamp(tsRaw);
    if (!startDate) continue;
    const valueStr = normalizeDecimal(valueRaw);
    const kwh = parseFloat(valueStr);
    if (Number.isNaN(kwh) || kwh < 0) continue;
    const endDate = new Date(startDate.getTime() + INTERVAL_MS);
    data.push({
      start: startDate.toISOString(),
      end: endDate.toISOString(),
      kwh,
    });
  }
  if (data.length === 0) {
    throw new Error("switchgridNormalizer: loadCurveCsv ne contient aucune donnée valide (timestamp + valeur)");
  }
  data.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return data;
}

/**
 * Validation silencieuse du R65 : vérifie la présence de périodes contractuelles (phase 1).
 * @param {string} r65Csv
 * @returns {void}
 */
function validateR65(r65Csv) {
  if (typeof r65Csv !== "string") return;
  const trimmed = r65Csv.trim();
  if (!trimmed) return;
  const sep = detectSeparator(trimmed);
  const lines = trimmed.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  const header = lines[0]?.toLowerCase() ?? "";
  const hasPeriod = header.includes("periode") || header.includes("période") || header.includes("date") || header.includes("debut") || header.includes("fin");
  if (lines.length > 1 && hasPeriod) return;
  if (lines.length <= 1) return;
}

/**
 * Normalise la courbe de charge SwitchGrid (PDL JSON + loadCurve CSV + R65 CSV).
 *
 * @param {Object} input
 * @param {unknown} [input.pdlJson] - JSON du point (PDL)
 * @param {string} [input.loadCurveCsv] - CSV timestamp + valeur énergie (30 min)
 * @param {string} [input.r65Csv] - CSV R65 (validation silencieuse des périodes contractuelles)
 * @returns {SwitchGridNormalizedResult}
 * @throws {Error} Si pas de données, CSV vide ou format invalide
 */
export function normalizeSwitchGridLoadCurve({ pdlJson, loadCurveCsv, r65Csv } = {}) {
  const pdl = extractPdl(pdlJson);
  if (loadCurveCsv == null || (typeof loadCurveCsv === "string" && !loadCurveCsv.trim())) {
    throw new Error("switchgridNormalizer: loadCurveCsv manquant ou vide");
  }
  const data = parseLoadCurveCsv(loadCurveCsv);
  validateR65(r65Csv ?? "");
  return {
    pdl,
    interval: "30m",
    data,
  };
}
