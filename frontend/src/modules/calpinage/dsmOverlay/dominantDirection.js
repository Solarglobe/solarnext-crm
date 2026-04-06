/**
 * CP-DSM-018 — Direction dominante basée sur perte énergétique annuelle réelle
 * Utilise trajectoire solaire + horizonMask pour accumuler perte par secteur d'azimut.
 *
 * DSM OVERLAY ONLY — not the official shading source of truth.
 * Indication UI / lecture du masque ; le shading enregistré reste celui du pipeline officiel (docs/shading-governance.md).
 */

import { normalizeHorizonData } from "./horizonRadar.js";

// Soleil : copie ESM locale (`./solarPosition.js`), pas import du .cjs partagé (évite effets globaux bundle).
import { computeSunPosition } from "./solarPosition.js";

const CARDINAL_SECTORS = [
  { min: 337.5, max: 360, label: "Nord", centerAz: 348.75 },
  { min: 0, max: 22.5, label: "Nord", centerAz: 11.25 },
  { min: 22.5, max: 67.5, label: "Nord-Est", centerAz: 45 },
  { min: 67.5, max: 112.5, label: "Est", centerAz: 90 },
  { min: 112.5, max: 157.5, label: "Sud-Est", centerAz: 135 },
  { min: 157.5, max: 202.5, label: "Sud", centerAz: 180 },
  { min: 202.5, max: 247.5, label: "Sud-Ouest", centerAz: 225 },
  { min: 247.5, max: 292.5, label: "Ouest", centerAz: 270 },
  { min: 292.5, max: 337.5, label: "Nord-Ouest", centerAz: 315 },
];

const MONTH_LABELS = [
  "Janvier", "Février", "Mars", "Avril", "Mai", "Juin",
  "Juillet", "Août", "Septembre", "Octobre", "Novembre", "Décembre",
];

const PERIOD_SLICES = [
  { min: 5, max: 10, label: "Matin" },
  { min: 10, max: 14, label: "Midi" },
  { min: 14, max: 19, label: "Après-midi" },
  { min: 19, max: 22, label: "Soir" },
  { min: 22, max: 24, label: "Nuit" },
  { min: 0, max: 5, label: "Nuit" },
]; // Nuit: 22-24 et 0-5 (même label, cumul automatique)

/**
 * Interpole l'élévation d'horizon pour un azimut (compat horizonMaskCore).
 * @param {Array<{az:number, elev:number}>} mask
 * @param {number} azDeg
 * @returns {number}
 */
function interpolateHorizonElevation(mask, azDeg) {
  if (!mask || !Array.isArray(mask) || mask.length === 0) return 0;
  const az = ((azDeg % 360) + 360) % 360;
  const step = mask.length >= 2 ? mask[1].az - mask[0].az : 360 / mask.length;
  if (mask.length === 1) return mask[0].elev;
  const idx = az / step;
  const i0 = Math.floor(idx) % mask.length;
  const i1 = (i0 + 1) % mask.length;
  const az0 = mask[i0].az;
  let az1 = mask[i1].az;
  if (i1 === 0) az1 = 360;
  const t = (az - az0) / (az1 - az0);
  return mask[i0].elev + t * (mask[i1].elev - mask[i0].elev);
}

/**
 * Retourne le secteur cardinal pour un azimut
 */
function azToSector(az) {
  const a = ((az % 360) + 360) % 360;
  for (const s of CARDINAL_SECTORS) {
    if (a >= s.min && a < s.max) return s;
  }
  return CARDINAL_SECTORS[1]; // Nord
}

/**
 * Génère les échantillons annuels (résolution horaire ou bi-horaire)
 */
function generateAnnualSamples(opts, latDeg, lonDeg) {
  const year = opts?.year ?? 2026;
  const stepMinutes = opts?.stepMinutes ?? 60;
  const minSunElevationDeg = Math.max(0, opts?.minSunElevationDeg ?? 3);

  const samples = [];
  const startMs = new Date(year, 0, 1, 0, 0, 0).getTime();
  const endMs = new Date(year, 11, 31, 23, 59, 0).getTime();
  const stepMs = stepMinutes * 60 * 1000;

  for (let t = startMs; t <= endMs; t += stepMs) {
    const date = new Date(t);
    const sunPos = computeSunPosition ? computeSunPosition(date, latDeg, lonDeg) : null;
    if (!sunPos || sunPos.elevationDeg < minSunElevationDeg) continue;
    samples.push({
      date,
      azimuthDeg: sunPos.azimuthDeg,
      elevationDeg: sunPos.elevationDeg,
    });
  }
  return samples;
}

const SEASON_UI_BUCKETS = [
  { key: "hiver", label: "Hiver", months: [11, 0, 1] },
  { key: "printemps", label: "Printemps", months: [2, 3, 4] },
  { key: "ete", label: "Été", months: [5, 6, 7] },
  { key: "automne", label: "Automne", months: [8, 9, 10] },
];

/**
 * Accumulation énergie / ombre sur le masque (UI + direction dominante).
 * @returns {null | {
 *   mask: Array,
 *   sectorLoss: Map<string, number>,
 *   periodLoss: Map<string, number>,
 *   availableEnergyByMonth: number[],
 *   lostEnergyByMonth: number[],
 *   totalLoss: number,
 * }}
 */
function accumulateHorizonShadowEnergy(horizonMask, latDeg, lonDeg, opts = {}) {
  const mask = normalizeHorizonData(horizonMask);
  if (mask.length === 0) return null;

  const hasGps =
    typeof latDeg === "number" &&
    typeof lonDeg === "number" &&
    !isNaN(latDeg) &&
    !isNaN(lonDeg) &&
    latDeg >= -90 &&
    latDeg <= 90 &&
    lonDeg >= -180 &&
    lonDeg <= 180;

  if (!hasGps || !computeSunPosition) return null;

  const config = {
    year: opts.year ?? 2026,
    stepMinutes: opts.stepMinutes ?? 60,
    minSunElevationDeg: opts.minSunElevationDeg ?? 3,
  };
  const samples = generateAnnualSamples(config, latDeg, lonDeg);

  const sectorLoss = new Map();
  const availableEnergyByMonth = new Array(12).fill(0);
  const lostEnergyByMonth = new Array(12).fill(0);
  const periodLoss = new Map();
  let totalLoss = 0;

  for (const s of CARDINAL_SECTORS) {
    sectorLoss.set(s.label, 0);
  }
  for (const p of PERIOD_SLICES) {
    periodLoss.set(p.label, 0);
  }

  for (const sample of samples) {
    const { date, azimuthDeg: azDeg, elevationDeg: elDeg } = sample;
    const proxyIrradiance = Math.max(0, Math.sin((elDeg * Math.PI) / 180));
    if (proxyIrradiance <= 0) continue;

    const month = date ? date.getMonth() : 0;
    availableEnergyByMonth[month] += proxyIrradiance;

    const horizonElev = interpolateHorizonElevation(mask, azDeg);
    const isShadow = elDeg < horizonElev;

    if (isShadow) {
      lostEnergyByMonth[month] += proxyIrradiance;
      const sector = azToSector(azDeg);
      sectorLoss.set(sector.label, (sectorLoss.get(sector.label) ?? 0) + proxyIrradiance);
      totalLoss += proxyIrradiance;

      const hour = date ? date.getHours() + date.getMinutes() / 60 : 12;
      for (const p of PERIOD_SLICES) {
        if (hour >= p.min && hour < p.max) {
          periodLoss.set(p.label, (periodLoss.get(p.label) ?? 0) + proxyIrradiance);
          break;
        }
      }
    }
  }

  return { mask, sectorLoss, periodLoss, availableEnergyByMonth, lostEnergyByMonth, totalLoss };
}

/**
 * Profil journée / saisons pour l’UI « Quand l’ombre agit le plus » (overlay DSM uniquement).
 * @returns {{
 *   hasSignal: boolean,
 *   dayParts: Array<{ key: string, label: string, value: number }>,
 *   seasons: Array<{ key: string, label: string, value: number }>,
 *   dominantDayKey: string|null,
 *   dominantSeasonKey: string|null,
 * }}
 */
export function getHorizonTemporalUiProfile(horizonMask, latDeg, lonDeg, opts = {}) {
  const acc = accumulateHorizonShadowEnergy(horizonMask, latDeg, lonDeg, opts);
  if (!acc || acc.totalLoss <= 0) {
    return {
      hasSignal: false,
      dayParts: [
        { key: "matin", label: "Matin", value: 0 },
        { key: "midi", label: "Midi", value: 0 },
        { key: "apresmidi", label: "Après-midi", value: 0 },
      ],
      seasons: SEASON_UI_BUCKETS.map((b) => ({ key: b.key, label: b.label, value: 0 })),
      dominantDayKey: null,
      dominantSeasonKey: null,
    };
  }

  const { periodLoss, availableEnergyByMonth, lostEnergyByMonth } = acc;

  const matin = periodLoss.get("Matin") ?? 0;
  const midi = periodLoss.get("Midi") ?? 0;
  const apresmidi =
    (periodLoss.get("Après-midi") ?? 0) + (periodLoss.get("Soir") ?? 0) + (periodLoss.get("Nuit") ?? 0);

  const dayParts = [
    { key: "matin", label: "Matin", value: matin },
    { key: "midi", label: "Midi", value: midi },
    { key: "apresmidi", label: "Après-midi", value: apresmidi },
  ];
  let dominantDayKey = "matin";
  let maxDay = -1;
  for (const d of dayParts) {
    if (d.value > maxDay) {
      maxDay = d.value;
      dominantDayKey = d.key;
    }
  }

  const ratioByMonth = availableEnergyByMonth.map((av, m) => (av > 0 ? lostEnergyByMonth[m] / av : 0));

  function seasonAvgRatio(months) {
    const vals = months.filter((m) => availableEnergyByMonth[m] > 0).map((m) => ratioByMonth[m]);
    if (vals.length === 0) return 0;
    return vals.reduce((a, r) => a + r, 0) / vals.length;
  }

  const seasons = SEASON_UI_BUCKETS.map((b) => ({
    key: b.key,
    label: b.label,
    value: seasonAvgRatio(b.months),
  }));

  let dominantSeasonKey = "hiver";
  let maxS = -1;
  for (const s of seasons) {
    if (s.value > maxS) {
      maxS = s.value;
      dominantSeasonKey = s.key;
    }
  }

  return {
    hasSignal: true,
    dayParts,
    seasons,
    dominantDayKey,
    dominantSeasonKey,
  };
}

/**
 * Calcule la direction dominante basée sur la perte énergétique annuelle.
 * @param {object} horizonMask - { mask: [{az, elev}] } ou { horizon: [...] }
 * @param {number} latDeg - Latitude
 * @param {number} lonDeg - Longitude
 * @param {object} [opts] - { year, stepMinutes, minSunElevationDeg }
 * @returns {{ dominantDirection, energyLossSharePct, dominantSeason, dominantPeriod, az, elev, ... } | null}
 */
export function getDominantDirection(horizonMask, latDeg, lonDeg, opts = {}) {
  const mask = normalizeHorizonData(horizonMask);
  if (mask.length === 0) return null;

  const acc = accumulateHorizonShadowEnergy(horizonMask, latDeg, lonDeg, opts);
  if (!acc) {
    return getDominantDirectionFallback(mask);
  }

  const { sectorLoss, periodLoss, availableEnergyByMonth, lostEnergyByMonth, totalLoss } = acc;

  if (totalLoss <= 0) {
    return getDominantDirectionFallback(mask);
  }

  let maxSectorLabel = "Nord";
  let maxSectorLoss = 0;
  for (const [label, loss] of sectorLoss) {
    if (loss > maxSectorLoss) {
      maxSectorLoss = loss;
      maxSectorLabel = label;
    }
  }

  const energyLossSharePct = totalLoss > 0 ? (maxSectorLoss / totalLoss) * 100 : 0;

  const ratioByMonth = availableEnergyByMonth.map((av, m) => (av > 0 ? lostEnergyByMonth[m] / av : 0));
  let maxRatioMonthIdx = 0;
  for (let m = 1; m < 12; m++) {
    if (ratioByMonth[m] > ratioByMonth[maxRatioMonthIdx]) maxRatioMonthIdx = m;
  }
  const dominantSeason = MONTH_LABELS[maxRatioMonthIdx];
  const dominantSeasonLossPct = Math.round(Math.max(0, ratioByMonth[maxRatioMonthIdx]) * 1000) / 10;

  const winterMonths = [11, 0, 1];
  const summerMonths = [5, 6, 7];
  const winterRatios = winterMonths.filter((m) => availableEnergyByMonth[m] > 0).map((m) => ratioByMonth[m]);
  const summerRatios = summerMonths.filter((m) => availableEnergyByMonth[m] > 0).map((m) => ratioByMonth[m]);
  const winterLossPct =
    winterRatios.length > 0
      ? Math.round((winterRatios.reduce((a, r) => a + r, 0) / winterRatios.length) * 1000) / 10
      : 0;
  const summerLossPct =
    summerRatios.length > 0
      ? Math.round((summerRatios.reduce((a, r) => a + r, 0) / summerRatios.length) * 1000) / 10
      : 0;

  let maxPeriodLabel = "Midi";
  let maxPeriodLoss = 0;
  for (const [label, loss] of periodLoss) {
    if (loss > maxPeriodLoss) {
      maxPeriodLoss = loss;
      maxPeriodLabel = label;
    }
  }
  const dominantPeriod = maxPeriodLabel;

  const sector = CARDINAL_SECTORS.find((s) => s.label === maxSectorLabel) ?? CARDINAL_SECTORS[2];
  const az = sector.centerAz;
  const elevInSector = mask
    .filter((p) => {
      const a = ((p.az % 360) + 360) % 360;
      return a >= sector.min && a < sector.max;
    })
    .reduce((max, p) => Math.max(max, p.elev ?? 0), 0);

  return {
    dominantDirection: maxSectorLabel,
    energyLossSharePct: Math.round(energyLossSharePct * 10) / 10,
    dominantSeasonLossPct,
    winterLossPct,
    summerLossPct,
    dominantSeason,
    dominantPeriod,
    az,
    elev: elevInSector,
    cardinalDirection: maxSectorLabel,
    season: dominantSeason,
    period: dominantPeriod,
  };
}

/**
 * Fallback: direction basée sur point d'élévation maximale (ancienne logique)
 */
function getDominantDirectionFallback(mask) {
  if (mask.length === 0) return null;
  let maxPoint = mask[0];
  for (let i = 1; i < mask.length; i++) {
    if ((mask[i].elev ?? 0) > (maxPoint.elev ?? 0)) maxPoint = mask[i];
  }
  const az = maxPoint.az ?? 0;
  const elev = maxPoint.elev ?? 0;
  const sector = azToSector(az);
  const season = elev > 12 ? "Hiver" : elev > 6 ? "Automne / Hiver" : "Impact faible";
  const period = az >= 45 && az < 135 ? "Matin" : az >= 135 && az < 225 ? "Midi" : az >= 225 && az < 315 ? "Après-midi" : "Mixte";
  return {
    az,
    elev,
    cardinalDirection: sector.label,
    season,
    period,
    dominantDirection: sector.label,
    energyLossSharePct: null,
    dominantSeasonLossPct: null,
    winterLossPct: null,
    summerLossPct: null,
    dominantSeason: season,
    dominantPeriod: period,
  };
}

function azToCardinal(az) {
  return azToSector(az).label;
}

function elevToSeason(elev) {
  if (typeof elev !== "number" || isNaN(elev)) return "Impact faible";
  if (elev > 12) return "Hiver";
  if (elev > 6) return "Automne / Hiver";
  return "Impact faible";
}

function azToPeriod(az) {
  const a = ((az % 360) + 360) % 360;
  if (a >= 45 && a < 135) return "Matin";
  if (a >= 135 && a < 225) return "Midi";
  if (a >= 225 && a < 315) return "Après-midi";
  return "Mixte";
}

export { azToCardinal, azToSector, elevToSeason, azToPeriod };
