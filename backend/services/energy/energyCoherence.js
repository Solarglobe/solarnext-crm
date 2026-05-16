/**
 * energyCoherence.js — Module pur de validation des invariants énergétiques.
 *
 * Règles vérifiées :
 *  1. Cohérence mensuelle ↔ annuelle : sum(monthly) = annual ± 0.1 %
 *  2. Cohérence 8760h ↔ mensuelle   : sum(hourly[mois]) = monthly[mois] ± 0.01 %
 *     (tolérance absolue min : 0.5 kWh pour absorber l'arrondi des entiers mensuels)
 *  3. Pas d'énergie négative          : hourly[i] ≥ 0 à tout moment
 *  4. Cohérence physique              : max(hourly) ≤ kWc (dépassement impossible)
 *
 * Ce module est ENTIÈREMENT PUR :
 *  — pas de HTTP, pas de DB, pas d'effet de bord
 *  — jamais de throw : toujours un résultat structuré
 *  — déterministe : même entrée → même sortie
 *
 * Usage :
 *   import { validateEnergyCoherence } from "./energyCoherence.js";
 *   const report = validateEnergyCoherence({ hourly8760, monthlyKwh, annualKwh, kWc });
 *   if (!report.ok) console.warn(report);
 */

// ---------------------------------------------------------------------------
// Constantes internes (duplicat local pour garder le module sans dépendance)
// ---------------------------------------------------------------------------
/** Nombre de jours par mois — année non-bissextile (standard moteur). */
const DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

/** Nombre total d'heures = 8760. */
const HOURS_PER_YEAR = DAYS_IN_MONTH.reduce((s, d) => s + d * 24, 0); // 8760

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Somme d'un tableau numérique. Traite null/undefined comme 0. */
function sumArray(arr) {
  let s = 0;
  for (let i = 0; i < arr.length; i++) s += arr[i] || 0;
  return s;
}

/** Différence relative en % : |a - b| / b × 100. Renvoie Infinity si b = 0 et a ≠ 0. */
function relDiffPct(a, b) {
  if (b === 0) return a === 0 ? 0 : Infinity;
  return (Math.abs(a - b) / Math.abs(b)) * 100;
}

// ---------------------------------------------------------------------------
// Règle 1 — Cohérence mensuelle ↔ annuelle
// ---------------------------------------------------------------------------

/**
 * Vérifie que la somme des valeurs mensuelles correspond à l'annuel déclaré.
 *
 * @param {number[]} monthlyKwh   12 valeurs mensuelles [kWh]
 * @param {number}   annualKwh    Valeur annuelle déclarée [kWh]
 * @param {number}   [tolerancePct=0.1]  Tolérance en % (défaut 0.1 %)
 * @returns {{ ok: boolean, monthlySum: number, annualKwh: number, diffPct: number }}
 */
export function checkMonthlyAnnualCoherence(monthlyKwh, annualKwh, tolerancePct = 0.1) {
  if (!Array.isArray(monthlyKwh) || monthlyKwh.length !== 12) {
    return {
      ok: false,
      error: "monthlyKwh doit être un tableau de 12 valeurs",
      monthlySum: null,
      annualKwh,
      diffPct: null,
    };
  }

  const monthlySum = sumArray(monthlyKwh);
  const annualRef  = Number(annualKwh) || 0;
  const diffPct    = relDiffPct(monthlySum, annualRef);

  return {
    ok:         diffPct <= tolerancePct,
    monthlySum: Math.round(monthlySum * 1000) / 1000,
    annualKwh:  annualRef,
    diffPct:    Math.round(diffPct * 1e6) / 1e6,   // 6 décimales
    tolerancePct,
  };
}

// ---------------------------------------------------------------------------
// Règle 2 — Cohérence 8760h ↔ mensuelle
// ---------------------------------------------------------------------------

/**
 * Vérifie que la somme des heures de chaque mois coïncide avec le mensuel déclaré.
 *
 * Tolérance : max(tolerancePct % du mensuel, toleranceAbsKwh).
 * Le minimum absolu (défaut 0.5 kWh) absorbe l'arrondi entier appliqué par
 * monthlyAggregator sans fausser le résultat pour les mois de production nulle.
 *
 * @param {number[]} hourly8760         Tableau 8760h [kWh]
 * @param {number[]} monthlyKwh         12 valeurs mensuelles déclarées [kWh]
 * @param {object}   [opts]
 * @param {number}   [opts.tolerancePct=0.01]       Tolérance relative (%)
 * @param {number}   [opts.toleranceAbsKwh=0.5]     Tolérance absolue min [kWh]
 * @returns {{ ok: boolean, violations: Array, monthResults: Array }}
 */
export function checkHourlyMonthlyCoherence(hourly8760, monthlyKwh, opts = {}) {
  const tolerancePct    = opts.tolerancePct    ?? 0.01;
  const toleranceAbsKwh = opts.toleranceAbsKwh ?? 0.5;

  if (!Array.isArray(hourly8760) || hourly8760.length !== HOURS_PER_YEAR) {
    return {
      ok:         false,
      error:      `hourly8760 doit être un tableau de ${HOURS_PER_YEAR} valeurs`,
      violations: [],
      monthResults: [],
    };
  }
  if (!Array.isArray(monthlyKwh) || monthlyKwh.length !== 12) {
    return {
      ok:         false,
      error:      "monthlyKwh doit être un tableau de 12 valeurs",
      violations: [],
      monthResults: [],
    };
  }

  const violations  = [];
  const monthResults = [];

  let cursor = 0;
  for (let m = 0; m < 12; m++) {
    const hoursInMonth = DAYS_IN_MONTH[m] * 24;
    let hourlySum = 0;
    for (let h = 0; h < hoursInMonth; h++) {
      hourlySum += hourly8760[cursor + h] || 0;
    }
    cursor += hoursInMonth;

    const declared  = Number(monthlyKwh[m]) || 0;
    const diffAbs   = Math.abs(hourlySum - declared);
    const threshold = Math.max(toleranceAbsKwh, (Math.abs(declared) * tolerancePct) / 100);
    const diffPct   = relDiffPct(hourlySum, declared);
    const pass      = diffAbs <= threshold;

    const result = {
      month:        m + 1,                                            // 1-indexé
      hourlySum:    Math.round(hourlySum  * 1000) / 1000,
      declared:     Math.round(declared   * 1000) / 1000,
      diffAbs:      Math.round(diffAbs    * 1000) / 1000,
      diffPct:      Math.round(diffPct    * 1e6)  / 1e6,
      threshold:    Math.round(threshold  * 1000) / 1000,
      pass,
    };

    monthResults.push(result);
    if (!pass) violations.push(result);
  }

  return {
    ok:          violations.length === 0,
    violations,
    monthResults,
    tolerancePct,
    toleranceAbsKwh,
  };
}

// ---------------------------------------------------------------------------
// Règle 3 — Pas d'énergie négative
// ---------------------------------------------------------------------------

/**
 * Vérifie qu'aucune valeur horaire de production n'est négative.
 *
 * @param {number[]} hourly8760
 * @returns {{ ok: boolean, violationCount: number, firstViolation: object|null }}
 */
export function checkNoNegativeProduction(hourly8760) {
  if (!Array.isArray(hourly8760) || hourly8760.length !== HOURS_PER_YEAR) {
    return {
      ok:              false,
      error:           `hourly8760 doit être un tableau de ${HOURS_PER_YEAR} valeurs`,
      violationCount:  0,
      firstViolation:  null,
    };
  }

  let violationCount = 0;
  let firstViolation = null;

  for (let i = 0; i < HOURS_PER_YEAR; i++) {
    const v = hourly8760[i];
    if (typeof v === "number" && v < 0) {
      violationCount++;
      if (firstViolation === null) {
        firstViolation = { index: i, value: v };
      }
    }
  }

  return {
    ok:             violationCount === 0,
    violationCount,
    firstViolation,
  };
}

// ---------------------------------------------------------------------------
// Règle 4 — Cohérence physique : pic horaire ≤ kWc
// ---------------------------------------------------------------------------

/**
 * Vérifie que la production horaire maximale ne dépasse pas la puissance crête.
 *
 * La production horaire est en kWh/h. La puissance crête est en kWc.
 * Sur une heure, la production max théorique est kWc (rendement = 100 %).
 * En pratique les pertes AC la réduisent à ~92 %, donc toute valeur > kWc
 * signale un bug de scaling.
 *
 * @param {number[]} hourly8760
 * @param {number}   kWc            Puissance crête AC de l'installation [kWc]
 * @returns {{ ok: boolean, maxHourlyKwh: number, kWc: number, exceedanceCount: number }}
 */
export function checkPhysicalPeakLimit(hourly8760, kWc) {
  if (!Array.isArray(hourly8760) || hourly8760.length !== HOURS_PER_YEAR) {
    return {
      ok:              false,
      error:           `hourly8760 doit être un tableau de ${HOURS_PER_YEAR} valeurs`,
      maxHourlyKwh:    null,
      kWc,
      exceedanceCount: 0,
    };
  }

  const kWcNum = Number(kWc) || 0;
  if (kWcNum <= 0) {
    return {
      ok:              false,
      error:           "kWc doit être un nombre positif",
      maxHourlyKwh:    null,
      kWc:             kWcNum,
      exceedanceCount: 0,
    };
  }

  let maxHourlyKwh   = 0;
  let exceedanceCount = 0;

  for (let i = 0; i < HOURS_PER_YEAR; i++) {
    const v = hourly8760[i] || 0;
    if (v > maxHourlyKwh) maxHourlyKwh = v;
    if (v > kWcNum + 1e-9) exceedanceCount++;
  }

  return {
    ok:              exceedanceCount === 0,
    maxHourlyKwh:    Math.round(maxHourlyKwh * 1e6) / 1e6,
    kWc:             kWcNum,
    exceedanceCount,
  };
}

// ---------------------------------------------------------------------------
// Orchestrateur — validateEnergyCoherence
// ---------------------------------------------------------------------------

/**
 * Valide les 4 invariants énergétiques sur un scénario complet.
 *
 * @param {object} params
 * @param {number[]}  params.hourly8760   Profil PV horaire 8760h [kWh]
 * @param {number[]}  params.monthlyKwh   12 valeurs mensuelles PV [kWh]
 * @param {number}    params.annualKwh    Production annuelle déclarée [kWh]
 * @param {number}    [params.kWc]        Puissance crête installation [kWc] (optionnel)
 * @param {object}    [params.opts]       Options de tolérance (voir sous-fonctions)
 * @returns {{
 *   ok:      boolean,
 *   checks:  { noNegative, monthlyAnnual, hourlyMonthly, physicalPeak },
 *   errors:  string[],
 *   summary: string
 * }}
 */
export function validateEnergyCoherence({ hourly8760, monthlyKwh, annualKwh, kWc, opts = {} }) {
  const noNegative     = checkNoNegativeProduction(hourly8760);
  const monthlyAnnual  = checkMonthlyAnnualCoherence(monthlyKwh, annualKwh, opts.toleranceMonthlyAnnualPct);
  const hourlyMonthly  = checkHourlyMonthlyCoherence(hourly8760, monthlyKwh, {
    tolerancePct:    opts.toleranceHourlyMonthlyPct,
    toleranceAbsKwh: opts.toleranceHourlyMonthlyAbsKwh,
  });

  const physicalPeak = (kWc != null && kWc > 0)
    ? checkPhysicalPeakLimit(hourly8760, kWc)
    : { ok: true, skipped: true };

  const errors = [];
  if (!noNegative.ok) {
    errors.push(`Production négative : ${noNegative.violationCount} violation(s), 1ère index=${noNegative.firstViolation?.index} val=${noNegative.firstViolation?.value}`);
  }
  if (!monthlyAnnual.ok) {
    errors.push(`Incohérence mensuel/annuel : Σmensuel=${monthlyAnnual.monthlySum} kWh ≠ annuel=${monthlyAnnual.annualKwh} kWh (${monthlyAnnual.diffPct?.toFixed(4)} %)`);
  }
  if (!hourlyMonthly.ok) {
    const v = hourlyMonthly.violations;
    errors.push(`Incohérence 8760h/mensuel : ${v.length} mois hors tolérance (ex. mois ${v[0]?.month} : Σhoraire=${v[0]?.hourlySum} ≠ déclaré=${v[0]?.declared})`);
  }
  if (physicalPeak && !physicalPeak.ok && !physicalPeak.skipped) {
    errors.push(`Dépassement physique : max_horaire=${physicalPeak.maxHourlyKwh} kWh/h > kWc=${physicalPeak.kWc} sur ${physicalPeak.exceedanceCount} heure(s)`);
  }

  const allOk = noNegative.ok && monthlyAnnual.ok && hourlyMonthly.ok && (physicalPeak?.ok ?? true);

  return {
    ok:  allOk,
    checks: { noNegative, monthlyAnnual, hourlyMonthly, physicalPeak },
    errors,
    summary: allOk ? "✅ Cohérence énergétique validée" : `❌ ${errors.length} invariant(s) violé(s)`,
  };
}
