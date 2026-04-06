// backend/services/solarModelService.js
// ============================================================
// Service de modélisation PV horaire à partir du PV mensuel
// V3 — variabilité journalière déterministe (lognormale)
// ============================================================
// Améliorations v3 vs v2 :
//   ✔ Chaque jour a son propre facteur énergétique (distribution lognormale)
//   ✔ Chaque jour a sa propre forme horaire (bruit de forme individualisé)
//   ✔ 100 % déterministe : même entrée → même résultat (PRNG seeded)
//   ✔ Conservation stricte du total mensuel (normalisation sur le mois)
//   ✔ Aucun Math.random() — reproductibilité garantie
// ============================================================

const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// ============================================================
// PRNG — mulberry32 (rapide, qualité suffisante pour simulation PV)
// Retourne une closure → chaque appel produit le prochain nombre ∈ [0, 1)
// ============================================================
function mulberry32(seed) {
  let s = seed >>> 0;
  return function () {
    s = (s + 0x6d2b79f5) | 0;
    let t = Math.imul(s ^ (s >>> 15), 1 | s);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ============================================================
// Hash FNV-1a compact → entier 32 bits non signé
// Utilisé pour dériver la graine de manière déterministe depuis
// les coordonnées GPS + mois.
// ============================================================
function fnv1aSeed(...nums) {
  let h = 2166136261; // FNV offset basis
  for (const n of nums) {
    // Encode en 3 octets (précision × 1000, borne à ±10M)
    const v =
      Math.round(
        (typeof n === "number" && Number.isFinite(n) ? n : 0) * 1000
      ) | 0;
    h = Math.imul(h ^ (v & 0xff), 16777619);
    h = Math.imul(h ^ ((v >> 8) & 0xff), 16777619);
    h = Math.imul(h ^ ((v >> 16) & 0xff), 16777619);
  }
  return h >>> 0;
}

// ============================================================
// Facteurs journaliers lognormaux — DÉTERMINISTES, NORMALISÉS
// ============================================================
// σ_log = 0.40 → CV ≈ 42 % (réaliste France, modéré)
// Les facteurs sont normalisés pour que leur moyenne = 1,
// ce qui garantit : Σ(dayEnergy) = monthEnergy (conservation exacte)
//
// Rappel mathématique :
//   raw[d] = exp( N(0, σ) )   →   E[raw] = exp(σ²/2)
//   facteur[d] = raw[d] / mean(raw)   →   E[facteur] = 1
//   dayEnergy[d] = (monthEnergy / N) × facteur[d]
//   Σ dayEnergy = (monthEnergy / N) × Σfacteur = monthEnergy × N/N = monthEnergy ✓
// ============================================================
const DAILY_SIGMA = 0.40;

function buildDailyFactors(daysInMonth, monthIndex, lat, lon) {
  const seed = fnv1aSeed(
    lat != null && Number.isFinite(lat) ? lat : 48.8,
    lon != null && Number.isFinite(lon) ? lon : 2.35,
    monthIndex,
    9371 // sel fixe
  );
  const rng = mulberry32(seed);

  const raw = new Array(daysInMonth);
  for (let d = 0; d < daysInMonth; d++) {
    // Transform de Box-Muller : 2 uniformes → 1 normale standard
    const u1 = Math.max(1e-12, rng());
    const u2 = rng();
    const z = Math.sqrt(-2 * Math.log(u1)) * Math.cos(2 * Math.PI * u2);
    raw[d] = Math.exp(z * DAILY_SIGMA);
  }

  // Normalisation empirique : mean → 1 (préserve la somme mensuelle)
  const mean = raw.reduce((a, b) => a + b, 0) / daysInMonth;
  return raw.map(v => (mean > 0 ? v / mean : 1));
}

// ============================================================
// Forme horaire journalière — DÉTERMINISTE par (mois, jour)
// Chaque jour a sa propre variante de la courbe en cloche,
// simulant les effets de diffusion atmosphérique.
// ============================================================
const SUN_TIMES = [
  { rise: 8,   set: 17   }, // Jan
  { rise: 7.5, set: 18   }, // Fév
  { rise: 7,   set: 19   }, // Mar
  { rise: 6.5, set: 20   }, // Avr
  { rise: 6,   set: 21   }, // Mai
  { rise: 6,   set: 22   }, // Juin
  { rise: 6.5, set: 21.5 }, // Juil
  { rise: 7,   set: 20.5 }, // Août
  { rise: 7.5, set: 19   }, // Sep
  { rise: 8,   set: 18   }, // Oct
  { rise: 8.5, set: 17   }, // Nov
  { rise: 9,   set: 17   }, // Déc
];

function buildDailyShape(monthIndex, dayIndex) {
  // Graine unique par (mois, jour de l'année) — bruit de forme reproductible
  const seed = fnv1aSeed(monthIndex, dayIndex, 4217);
  const rng = mulberry32(seed);

  const weights = new Array(24).fill(0);
  const { rise, set } = SUN_TIMES[monthIndex];
  const start = Math.floor(rise);
  const end = Math.ceil(set);
  const duration = end - start;

  if (duration <= 0) return weights;

  for (let h = start; h <= end; h++) {
    const x = (h - start) / duration;

    // Courbe asymétrique : montée lente (matin), descente rapide (soir)
    const morning = Math.pow(x, 1.8);
    const evening = Math.pow(1 - x, 3.2);
    let w = morning * evening;

    // Bruit de forme déterministe ±8 % — modélise la diffusion atmosphérique heure par heure
    const noise = 1 + (rng() - 0.5) * 0.16;
    w *= noise;

    weights[h] = w > 0 ? w : 0;
  }

  // Normalisation : la somme des poids horaires = 1
  // → dayEnergy × shape[h] préserve exactement l'énergie journalière
  const sum = weights.reduce((a, b) => a + b, 0);
  if (sum > 0) {
    for (let h = 0; h < 24; h++) weights[h] /= sum;
  }

  return weights;
}

// ============================================================
// Distribution d'une énergie mensuelle sur toutes les heures du mois
// Chaque jour reçoit son énergie propre (dailyFactor) et sa forme propre.
// ============================================================
function distributeMonthToHourly(monthEnergyKwh, daysInMonth, monthIndex, dailyFactors) {
  const hourly = new Array(daysInMonth * 24).fill(0);

  if (!monthEnergyKwh || monthEnergyKwh <= 0) return hourly;

  const dailyAvgEnergy = monthEnergyKwh / daysInMonth;

  for (let day = 0; day < daysInMonth; day++) {
    // Énergie de ce jour = moyenne × facteur lognormal journalier
    const dayEnergy = dailyAvgEnergy * dailyFactors[day];
    // Forme horaire spécifique à ce jour
    const shape = buildDailyShape(monthIndex, day);

    for (let h = 0; h < 24; h++) {
      hourly[day * 24 + h] = dayEnergy * shape[h];
    }
  }

  return hourly;
}

// ============================================================
// buildHourlyPV — API publique
// Signature inchangée : buildHourlyPV(arg1, ctx?)
// ============================================================
/**
 * Construit un profil horaire (8760 valeurs) à partir d'une
 * production mensuelle AC de 12 mois.
 *
 * @param {number[] | { monthly_kwh: number[] } | { monthly_ac_kwh: number[] }} arg1
 *   Tableau de 12 mois (kWh AC) ou objet contenant un tel tableau.
 * @param {object} [arg2]
 *   Contexte optionnel. Si arg2.site.lat / arg2.site.lon sont fournis, la graine
 *   de variabilité dépend du site → même site = même profil journalier.
 *   Si absent, la graine utilise les coordonnées par défaut (Paris).
 * @returns {number[]} Tableau de 8760 valeurs en kWh/h.
 *
 * Propriété garantie : pour tout mois m,
 *   Σ( hourly[h] pour h dans le mois m ) = monthlyArray[m]
 */
export function buildHourlyPV(arg1, arg2 = {}) {
  let monthlyArray = null;

  if (Array.isArray(arg1)) {
    monthlyArray = arg1;
  } else if (arg1 && Array.isArray(arg1.monthly_kwh)) {
    monthlyArray = arg1.monthly_kwh;
  } else if (arg1 && Array.isArray(arg1.monthly_ac_kwh)) {
    monthlyArray = arg1.monthly_ac_kwh;
  }

  if (!monthlyArray || monthlyArray.length !== 12) {
    throw new Error(
      "buildHourlyPV: données mensuelles invalides (tableau de 12 mois en kWh AC requis)."
    );
  }

  // Coordonnées du site pour la graine (reproductibilité par installation)
  const lat = arg2?.site?.lat;
  const lon = arg2?.site?.lon;

  const hourlyYear = [];

  for (let m = 0; m < 12; m++) {
    const monthEnergy = Number(monthlyArray[m]) || 0;
    const days = DAYS_IN_MONTH[m];

    // Facteurs journaliers lognormaux — déterministes, normalisés (somme = days)
    const dailyFactors = buildDailyFactors(days, m, lat, lon);

    const monthHourly = distributeMonthToHourly(monthEnergy, days, m, dailyFactors);

    for (let i = 0; i < monthHourly.length; i++) {
      hourlyYear.push(monthHourly[i]);
    }
  }

  // Sécurisation à 8760 h exactement
  if (hourlyYear.length !== 8760) {
    if (hourlyYear.length > 8760) return hourlyYear.slice(0, 8760);
    return hourlyYear.concat(new Array(8760 - hourlyYear.length).fill(0));
  }

  return hourlyYear;
}
