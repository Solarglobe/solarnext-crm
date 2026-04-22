/**
 * PDF P5 — Profil puissance « journée type » (24 h) à partir des agrégats moteur.
 * - Production : priorité série 8760 h (kW) si fournie ; sinon reconstruction fallback
 *   à partir des kWh mensuels + géométrie solaire (mois de pic → jour de l’année → déclinaison),
 *   énergie journalière = production annuelle ÷ 365.
 * - Consommation : priorité 8760 h ; sinon profil estimatif cohérent avec l’annuel (sans série horaire).
 * Fallback PV : fenêtre de jour = demi-largeur solaire `hw` (inchangée) ; forme = cloche « cosinus
 * surélevé » (Hann) normalisée — pic plus plat que l’ancien triangle, bords lisses, nuit à zéro.
 */

const MONTHS_COUNT = 12;
/** Milieu de mois (jour de l’année, 1–365) — pour lier le pic mensuel à une saison. */
const MONTH_MID_DAY_OF_YEAR = [17, 47, 75, 105, 135, 166, 196, 227, 258, 288, 319, 349];

function num(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return null;
  return Number(v);
}

function numOrZero(v) {
  const n = num(v);
  return n != null ? n : 0;
}

function normalize12(arr) {
  const a = Array.isArray(arr) ? arr.slice(0, MONTHS_COUNT) : [];
  const out = [];
  for (let i = 0; i < MONTHS_COUNT; i++) {
    out.push(numOrZero(a[i]));
  }
  return out;
}

function argmaxIndex(values) {
  let best = 0;
  for (let i = 1; i < values.length; i++) {
    if (values[i] > values[best]) best = i;
  }
  return best;
}

/** Déclinaison solaire (rad), Cooper — liée au jour de l’année uniquement. */
function declinationRadCooper(dayOfYear) {
  const n = Math.max(1, Math.min(366, Math.round(dayOfYear)));
  return ((23.45 * Math.PI) / 180) * Math.sin(((2 * Math.PI) / 365) * (284 + n));
}

/**
 * Demi-largeur « midi → coucher » (h) à partir de la latitude et de la déclinaison.
 * ω0 = angle horaire au coucher (rad) ; durée jour = 24*ω0/π → demi-journée solaire = 12*ω0/π.
 */
function solarHalfDayHours(latDeg, decRad) {
  const lat = Number(latDeg);
  const phiDeg = Number.isFinite(lat) && lat >= -90 && lat <= 90 ? lat : 46;
  const phi = (phiDeg * Math.PI) / 180;
  const arg = -Math.tan(phi) * Math.tan(decRad);
  const cosW = Math.max(-1, Math.min(1, arg));
  const w0 = Math.acos(cosW);
  const half = (w0 * 12) / Math.PI;
  if (!Number.isFinite(half) || half <= 0) return 6;
  return Math.min(12.5, Math.max(2.5, half));
}

/**
 * Poids horaires (somme = 1) pour le fallback PV : cloche solaire « cosinus surélevé » (fenêtre de
 * Hann) sur [12−hw, 12+hw], nul sinon. Même largeur de jour que l’ancien triangle (`hw`), mais
 * sommet aplati (dérivée nulle au zénith et au coucher) — plus crédible qu’un pic triangulaire.
 */
function raisedCosineDaylightWeights24(halfWidthHours) {
  const hw = Math.max(2.5, Math.min(12, halfWidthHours));
  const w = Array.from({ length: 24 }, () => 0);
  for (let h = 0; h < 24; h++) {
    const dist = Math.abs(h - 12);
    if (dist <= hw) {
      const u = dist / hw;
      w[h] = 0.5 * (1 + Math.cos(Math.PI * u));
    }
  }
  const s = w.reduce((a, b) => a + b, 0);
  if (s <= 0) return Array.from({ length: 24 }, () => 1 / 24);
  return w.map((x) => x / s);
}

/** kWh moyens par jour → kW moyen sur chaque heure (1 h) pour respecter Σ P = E_jour. */
function scaleWeightsToDailyKw(weights, annualKwh) {
  const a = num(annualKwh);
  const E = a != null && Number.isFinite(a) && a > 0 ? a / 365 : 0;
  if (E <= 0) return Array(24).fill(0);
  const s = weights.reduce((x, y) => x + y, 0);
  if (s <= 0) return Array(24).fill(0);
  return weights.map((x) => (E * x) / s);
}

function averageHourly8760To24(hourlyKw) {
  if (!Array.isArray(hourlyKw) || hourlyKw.length < 8760) return null;
  const len = hourlyKw.length;
  return Array.from({ length: 24 }, (_, h) => {
    let sum = 0;
    let n = 0;
    for (let i = h; i < len; i += 24) {
      const v = Number(hourlyKw[i]);
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  });
}

/**
 * Consommation fallback : profil estimatif quand aucune série 8760 h n’est disponible.
 * Arc diurne lisse (sin² sur la plage active), nocturne plus basse, renforts matin / soir modérés ;
 * l’amplitude des renforts dépend légèrement de la dispersion mensuelle (données réelles).
 * Somme des 24 kWh horaires = annualConsoKwh / 365 (aucune énergie inventée).
 */
function estimatedConsumptionDailyKwFromMonthly(annualConsoKwh, monthlyConso12) {
  const a = num(annualConsoKwh);
  const E = a != null && Number.isFinite(a) && a > 0 ? a / 365 : 0;
  if (E <= 0) return Array(24).fill(0);

  const m = normalize12(monthlyConso12);
  const sum = m.reduce((x, y) => x + y, 0);
  const mean = sum / MONTHS_COUNT;
  const spread = mean > 1e-6 ? (Math.max(...m) - Math.min(...m)) / mean : 0;
  const spreadFactor = Math.min(0.22, Math.max(0.06, spread * 0.45));

  const weights = Array.from({ length: 24 }, (_, h) => {
    const u = Math.min(1, Math.max(0, (h - 5.5) / 15.5));
    const dayArc = Math.sin(Math.PI * u) ** 2;
    const morning = Math.exp(-0.5 * ((h - 8) / 2.35) ** 2);
    const evening = Math.exp(-0.5 * ((h - 19) / 2.35) ** 2);
    return 0.16 + 0.58 * dayArc + spreadFactor * (0.92 * morning + 0.78 * evening);
  });

  const s = weights.reduce((x, y) => x + y, 0);
  return s > 0 ? weights.map((x) => (E * x) / s) : Array(24).fill(E / 24);
}

function productionFromMonthlyAndSite(monthlyProd12, annualProdKwh, latitudeDeg) {
  const m = normalize12(monthlyProd12);
  const peakIdx = argmaxIndex(m);
  const doy = MONTH_MID_DAY_OF_YEAR[peakIdx] ?? 172;
  const dec = declinationRadCooper(doy);
  const hw = solarHalfDayHours(latitudeDeg, dec);
  const weights = raisedCosineDaylightWeights24(hw);
  return scaleWeightsToDailyKw(weights, annualProdKwh);
}

/**
 * Reconstruction PV 24 h à partir des kWh mensuels + site (export explicite pour tests / doc).
 * @param {number[]} monthlyKwh12
 * @param {number} annualProdKwh
 * @param {number|null|undefined} latitudeDeg
 * @returns {number[]}
 */
export function generateDailyProfileFromMonthly(monthlyKwh12, annualProdKwh, latitudeDeg) {
  return productionFromMonthlyAndSite(monthlyKwh12, annualProdKwh, latitudeDeg);
}

/**
 * @param {object} params
 * @returns {{ production_kw: number[], consommation_kw: number[], profile_notes: { production: string, consumption: string } }}
 */
export function buildP5DailyProfiles(params) {
  const {
    annualProductionKwh,
    monthlyProductionKwh12,
    annualConsumptionKwh,
    monthlyConsumptionKwh12,
    latitudeDeg,
    pvHourlyKw8760,
    consoHourlyKw8760,
  } = params;

  let production_kw;
  let prodNote;
  const avgPv = averageHourly8760To24(pvHourlyKw8760);
  if (avgPv) {
    production_kw = avgPv;
    prodNote =
      "Puissance horaire : moyenne sur 24 tranches d’une série 8760 h issue du moteur (même échelle que la simulation).";
  } else {
    production_kw = productionFromMonthlyAndSite(
      monthlyProductionKwh12,
      annualProductionKwh,
      latitudeDeg
    );
    prodNote =
      "Production : profil journalier reconstruit à partir du bilan annuel/mensuel et de la largeur de journée solaire (énergie du jour = production annuelle ÷ 365).";
  }

  let consommation_kw;
  let consoNote;
  const avgC = averageHourly8760To24(consoHourlyKw8760);
  if (avgC) {
    consommation_kw = avgC;
    consoNote =
      "Consommation horaire : moyenne sur 24 tranches d’une série 8760 h issue du moteur.";
  } else {
    consommation_kw = estimatedConsumptionDailyKwFromMonthly(
      annualConsumptionKwh,
      monthlyConsumptionKwh12
    );
    consoNote =
      "Consommation : profil journalier estimatif (pas de mesure horaire) ; cohérent avec la consommation annuelle.";
  }

  return {
    production_kw: production_kw.map((x) => (Number.isFinite(x) ? x : 0)),
    consommation_kw: consommation_kw.map((x) => (Number.isFinite(x) ? x : 0)),
    profile_notes: { production: prodNote, consumption: consoNote },
  };
}
