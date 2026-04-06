/**
 * CP-ENERGY-002 — Modèle énergétique universel SolarNext
 *
 * SolarNextEnergyProfile : structure unique pour toute la consommation client
 * (Enedis, SwitchGrid, Energrid, manuel, import facture).
 *
 * Sources alimentant buildEnergyProfile (format reçu = { timestamp, consumption_kwh } brut) :
 * - Enedis API : enedisNormalizer (value en Wh → déjà /1000 avant appel)
 * - CSV import lead : POST /api/energy/profile → switchgridNormalizer (colonne valeur = W ou Wh selon fichier)
 * - SwitchGrid CSV : parseLoadCurveCsv → valeur brute → buildEnergyProfile (détection W/Wh/kWh ici)
 * - consumptionService : utilisé pour calcul moteur (fichier CSV), pas pour buildEnergyProfile
 *
 * @typedef {Object} SolarNextEnergyPoint
 * @property {string} timestamp - ISO avec timezone
 * @property {number} consumption_kwh
 *
 * @typedef {Object} SolarNextEnergySummary
 * @property {number} annual_kwh - somme des data (kWh)
 * @property {number} daily_average_kwh - annual_kwh / 365
 * @property {number} max_interval_kwh - max(data)
 * @property {string} [warning] - "UNREALISTIC_CONSUMPTION" si annual_kwh > 200000
 * @property {"W_30m"|"W_15m"|"WH"|"KWH"} [unit_detected] - (DEV only) unité détectée
 *
 * @typedef {Object} SolarNextEnergyProfile
 * @property {string} pdl - Point de livraison
 * @property {string} source - enedis | switchgrid | energrid | manual | invoice
 * @property {string} interval - 30m | 1h | day | month
 * @property {"kWh"} unit
 * @property {string} timezone - Europe/Paris
 * @property {SolarNextEnergyPoint[]} data
 * @property {SolarNextEnergySummary} summary
 */

const VALID_SOURCES = new Set(["enedis", "switchgrid", "energrid", "manual", "invoice"]);
const VALID_INTERVALS = new Set(["15m", "30m", "1h", "day", "month"]);
const DEFAULT_TIMEZONE = "Europe/Paris";

const IS_DEV = process.env.NODE_ENV !== "production";

/** Seuil conso annuelle au-delà duquel on log un warning (kWh). */
const UNREALISTIC_CONSUMPTION_KWH = 200000;

/**
 * Filtre et normalise les points : timestamp string non vide, consumption_kwh nombre >= 0.
 * @param {Array<{ timestamp?: string, consumption_kwh?: number }>} data
 * @returns {SolarNextEnergyPoint[]}
 */
function normalizeDataPoints(data) {
  if (!Array.isArray(data)) return [];
  const out = [];
  for (const p of data) {
    if (p == null || typeof p !== "object") continue;
    const ts = p.timestamp;
    const tsStr = typeof ts === "string" ? ts.trim() : "";
    if (!tsStr) continue;
    let kwh = p.consumption_kwh;
    if (typeof kwh !== "number" || Number.isNaN(kwh)) continue;
    if (kwh < 0) continue;
    out.push({ timestamp: tsStr, consumption_kwh: kwh });
  }
  return out.sort((a, b) => (a.timestamp < b.timestamp ? -1 : a.timestamp > b.timestamp ? 1 : 0));
}

/**
 * Calcule le résumé à partir des points (annual, daily average, max).
 * @param {SolarNextEnergyPoint[]} data
 * @returns {SolarNextEnergySummary}
 */
function computeSummary(data) {
  if (!data.length) {
    return { annual_kwh: 0, daily_average_kwh: 0, max_interval_kwh: 0 };
  }
  let sum = 0;
  let max = 0;
  for (const p of data) {
    sum += p.consumption_kwh;
    if (p.consumption_kwh > max) max = p.consumption_kwh;
  }
  return {
    annual_kwh: Math.round(sum * 1000) / 1000,
    daily_average_kwh: Math.round((sum / 365) * 1000) / 1000,
    max_interval_kwh: Math.round(max * 1000) / 1000,
  };
}

/** Seuil au-delà duquel on considère que les valeurs sont en Wh (conso annuelle réaliste < 100 000 kWh). */
const WH_DETECTION_THRESHOLD_KWH = 100000;

/**
 * Calcule median et p95 d'un tableau de nombres (copie triée, sans modifier l'entrée).
 * @param {number[]} arr
 * @returns {{ median: number, p95: number, max: number, sum: number, count: number }}
 */
function computeStats(arr) {
  if (!arr.length) return { median: 0, p95: 0, max: 0, sum: 0, count: 0 };
  const sorted = [...arr].sort((a, b) => a - b);
  const count = sorted.length;
  const sum = sorted.reduce((s, v) => s + v, 0);
  const median = count % 2 === 0
    ? (sorted[count / 2 - 1] + sorted[count / 2]) / 2
    : sorted[Math.floor(count / 2)];
  const p95Idx = Math.min(count - 1, Math.ceil(count * 0.95) - 1);
  const p95 = sorted[Math.max(0, p95Idx)];
  const max = sorted[count - 1];
  return { median, p95, max, sum, count };
}

/**
 * Détection d'unité et conversion vers kWh (multi-critères).
 * @param {SolarNextEnergyPoint[]} data
 * @param {string} interval - "15m" | "30m" | "1h" | "day" | "month"
 * @returns {{ dataInKwh: SolarNextEnergyPoint[], unitDetected: "W_30m" | "W_15m" | "WH" | "KWH" }}
 */
function normalizeToKwh(data, interval) {
  if (!Array.isArray(data) || data.length === 0) {
    return { dataInKwh: data, unitDetected: "KWH" };
  }
  const values = data.map((p) => p.consumption_kwh || 0);
  const { median, max, sum: rawSum } = computeStats(values);

  let dataInKwh;
  let unitDetected = "KWH";

  if (interval === "30m") {
    if (median >= 100 && max >= 2000) {
      dataInKwh = data.map((p) => ({
        ...p,
        consumption_kwh: ((p.consumption_kwh || 0) * 0.5) / 1000,
      }));
      unitDetected = "W_30m";
    } else if (max >= 5000 && median >= 500) {
      dataInKwh = data.map((p) => ({
        ...p,
        consumption_kwh: ((p.consumption_kwh || 0) * 0.5) / 1000,
      }));
      unitDetected = "W_30m";
    } else if (rawSum > WH_DETECTION_THRESHOLD_KWH) {
      dataInKwh = data.map((p) => ({
        ...p,
        consumption_kwh: (p.consumption_kwh || 0) / 1000,
      }));
      unitDetected = "WH";
    } else {
      dataInKwh = data;
    }
  } else if (interval === "1h") {
    if (rawSum > WH_DETECTION_THRESHOLD_KWH) {
      dataInKwh = data.map((p) => ({
        ...p,
        consumption_kwh: (p.consumption_kwh || 0) / 1000,
      }));
      unitDetected = "WH";
    } else {
      dataInKwh = data;
    }
  } else if (interval === "15m") {
    if (median >= 100 && max >= 2000) {
      dataInKwh = data.map((p) => ({
        ...p,
        consumption_kwh: ((p.consumption_kwh || 0) * 0.25) / 1000,
      }));
      unitDetected = "W_15m";
    } else if (rawSum > WH_DETECTION_THRESHOLD_KWH) {
      dataInKwh = data.map((p) => ({
        ...p,
        consumption_kwh: (p.consumption_kwh || 0) / 1000,
      }));
      unitDetected = "WH";
    } else {
      dataInKwh = data;
    }
  } else {
    if (rawSum > WH_DETECTION_THRESHOLD_KWH) {
      dataInKwh = data.map((p) => ({
        ...p,
        consumption_kwh: (p.consumption_kwh || 0) / 1000,
      }));
      unitDetected = "WH";
    } else {
      dataInKwh = data;
    }
  }

  return { dataInKwh, unitDetected };
}

/**
 * Construit un profil énergétique SolarNext à partir de données brutes.
 * Vérifie les données, ignore les points invalides et négatifs, calcule le summary.
 *
 * @param {Object} input
 * @param {string} [input.pdl] - Point de livraison (défaut "")
 * @param {string} [input.source] - enedis | switchgrid | energrid | manual | invoice (défaut "manual")
 * @param {string} [input.interval] - 30m | 1h | day | month (défaut "30m")
 * @param {Array<{ timestamp?: string, consumption_kwh?: number }>} [input.data] - points bruts
 * @returns {SolarNextEnergyProfile}
 */
export function buildEnergyProfile({ pdl = "", source = "manual", interval = "30m", data = [] } = {}) {
  const safeSource = VALID_SOURCES.has(String(source).toLowerCase()) ? String(source).toLowerCase() : "manual";
  const safeInterval = VALID_INTERVALS.has(String(interval)) ? String(interval) : "30m";
  const safePdl = typeof pdl === "string" ? pdl : "";

  const normalizedData = normalizeDataPoints(data);
  const { dataInKwh, unitDetected } = normalizeToKwh(normalizedData, safeInterval);
  const summary = computeSummary(dataInKwh);

  if (summary.annual_kwh > UNREALISTIC_CONSUMPTION_KWH) {
    summary.warning = "UNREALISTIC_CONSUMPTION";
    if (IS_DEV) {
      console.warn(
        "[energyProfileBuilder] annual_kwh > 200000:",
        summary.annual_kwh.toFixed(0),
        "kWh — summary.warning = UNREALISTIC_CONSUMPTION"
      );
    }
  }

  if (IS_DEV && summary) {
    summary.unit_detected = unitDetected;
  }

  return {
    pdl: safePdl,
    source: safeSource,
    interval: safeInterval,
    unit: "kWh",
    timezone: DEFAULT_TIMEZONE,
    data: dataInKwh,
    summary,
  };
}
