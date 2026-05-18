/**
 * stringSizing.js — Moteur de validation string sizing (IEC 62109 / UTE C 15-712-1).
 *
 * Module PUR : aucune dépendance DB, aucun import HTTP.
 * Toutes les entrées sont des scalaires — testable directement avec node:test.
 *
 * Référence : UTE C 15-712-1 §5.3 — Calcul des tensions en conditions extrêmes.
 */

// ─── Constantes ────────────────────────────────────────────────────────────────

/** Température STC de référence (°C). */
const T_STC = 25;

/** Marge thermique IEC : Voc max string ≤ Vmax onduleur × 0.95. */
const VOC_SAFETY_MARGIN = 0.95;

/** Déséquilibre MPPT toléré (15 %) avant alerte. */
const MPPT_IMBALANCE_WARNING_PCT = 15;

// ─── Types JSDoc ───────────────────────────────────────────────────────────────

/**
 * @typedef {Object} PanelSpec
 * @property {number} vocV        — Tension en circuit ouvert à STC (V)
 * @property {number} vmppV       — Tension au point de puissance max à STC (V)
 * @property {number} iscA        — Courant de court-circuit à STC (A)
 * @property {number} tempCoeffVocPctPerDeg — Coefficient de température Voc (%/°C, négatif, ex: −0.29)
 */

/**
 * @typedef {Object} InverterSpec
 * @property {number} vocMax      — Tension max entrée onduleur (V)
 * @property {number} vmppMin     — Vmpp min plage MPPT (V)
 * @property {number} vmppMax     — Vmpp max plage MPPT (V)
 * @property {number} imaxMppt    — Courant max par entrée MPPT (A)
 * @property {number} mpptCount   — Nombre de MPPT
 * @property {number} inputsPerMppt — Entrées (strings) max par MPPT
 */

/**
 * @typedef {'ok'|'warning'|'error'} CheckStatus
 */

/**
 * @typedef {Object} Check
 * @property {string}      criterion — Nom du critère
 * @property {number|null} measured  — Valeur calculée
 * @property {number|null} limit     — Limite normative
 * @property {CheckStatus} status
 * @property {string}      message   — Message lisible bureau d'études
 * @property {string}      [unit]    — Unité de la valeur mesurée
 */

// ─── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Formate un nombre pour affichage dans un message.
 * @param {number|null|undefined} v
 * @param {number} decimals
 */
function fmt(v, decimals = 2) {
  return v != null && Number.isFinite(v) ? v.toFixed(decimals) : "N/A";
}

/**
 * Construit un Check de type 'neutral' pour signaler une donnée manquante.
 * @param {string} criterion
 * @param {string} missingField
 * @returns {Check}
 */
function missingCheck(criterion, missingField) {
  return {
    criterion,
    measured: null,
    limit: null,
    status: "neutral",
    message: `Donnée manquante : ${missingField}`,
  };
}

// ─── Voc corrigé température ───────────────────────────────────────────────────

/**
 * Calcule la tension Voc corrigée à température minimale (IEC 62109).
 *
 * Voc_T = Voc_STC × (1 + tempCoeffVoc/100 × (tMin − 25))
 *
 * tempCoeffVoc est en %/°C, typiquement −0.29 pour du monocristallin Si.
 * À basse température, la tension MONTE (coefficient négatif × (tMin − 25) < 0
 * donne un facteur > 1).
 *
 * @param {number} vocSTC        — Voc à STC (V)
 * @param {number} tempCoeffPct  — Coefficient Voc (%/°C)
 * @param {number} tMinC         — Température site minimale (°C)
 * @returns {number} Voc corrigé (V)
 */
export function computeVocAtTmin(vocSTC, tempCoeffPct, tMinC) {
  return vocSTC * (1 + (tempCoeffPct / 100) * (tMinC - T_STC));
}

// ─── String Sizing ─────────────────────────────────────────────────────────────

/**
 * Valide le string sizing selon IEC 62109 / UTE C 15-712-1.
 *
 * @param {object} params
 * @param {PanelSpec}    params.panel    — Caractéristiques électriques panneau
 * @param {InverterSpec} params.inverter — Caractéristiques électriques onduleur
 * @param {number}       params.nSeries  — Nombre de panneaux en série par string
 * @param {number}       [params.tMinC=-10] — Température minimale site (°C)
 *
 * @returns {{
 *   vocMaxString: number,
 *   vmppString: number,
 *   iscString: number,
 *   checks: Check[]
 * }}
 */
export function computeStringSizing({ panel, inverter, nSeries, tMinC = -10 }) {
  const checks = [];

  // ── Voc max string (température minimale) ─────────────────────────────────

  if (
    typeof panel?.vocV !== "number" ||
    typeof panel?.tempCoeffVocPctPerDeg !== "number" ||
    typeof inverter?.vocMax !== "number"
  ) {
    checks.push(missingCheck("Voc max string", "panel.vocV / tempCoeffVocPctPerDeg / inverter.vocMax"));
  } else {
    const vocAtTmin = computeVocAtTmin(panel.vocV, panel.tempCoeffVocPctPerDeg, tMinC);
    const vocMaxString = vocAtTmin * nSeries;
    const limit = inverter.vocMax * VOC_SAFETY_MARGIN;
    const status =
      vocMaxString > inverter.vocMax
        ? "error"
        : vocMaxString > limit
        ? "warning"
        : "ok";
    checks.push({
      criterion: "Voc max string",
      measured: Math.round(vocMaxString * 10) / 10,
      limit: Math.round(limit * 10) / 10,
      status,
      unit: "V",
      message:
        status === "ok"
          ? `Voc max = ${fmt(vocMaxString)} V ≤ ${fmt(limit)} V (marge 5 %) ✓`
          : status === "warning"
          ? `Voc max = ${fmt(vocMaxString)} V dépasse la marge 5 % (${fmt(limit)} V) — risque protection onduleur`
          : `Voc max = ${fmt(vocMaxString)} V SUPÉRIEUR à Voc onduleur ${fmt(inverter.vocMax)} V — string non conforme`,
    });
  }

  // ── Vmpp string dans plage MPPT ───────────────────────────────────────────

  if (
    typeof panel?.vmppV !== "number" ||
    typeof inverter?.vmppMin !== "number" ||
    typeof inverter?.vmppMax !== "number"
  ) {
    checks.push(missingCheck("Vmpp string / plage MPPT", "panel.vmppV / inverter.vmppMin / inverter.vmppMax"));
  } else {
    const vmppString = panel.vmppV * nSeries;
    const inRange = vmppString >= inverter.vmppMin && vmppString <= inverter.vmppMax;
    const nearBoundary =
      vmppString < inverter.vmppMin * 1.05 ||
      vmppString > inverter.vmppMax * 0.95;
    const status = inRange ? (nearBoundary ? "warning" : "ok") : "error";
    checks.push({
      criterion: "Vmpp string / plage MPPT",
      measured: Math.round(vmppString * 10) / 10,
      limit: null,
      status,
      unit: "V",
      message:
        status === "ok"
          ? `Vmpp = ${fmt(vmppString)} V dans la plage [${inverter.vmppMin}–${inverter.vmppMax}] V ✓`
          : status === "warning"
          ? `Vmpp = ${fmt(vmppString)} V proche d'une limite MPPT [${inverter.vmppMin}–${inverter.vmppMax}] V — vérifier en conditions réelles`
          : `Vmpp = ${fmt(vmppString)} V HORS plage MPPT [${inverter.vmppMin}–${inverter.vmppMax}] V — revoir le nombre de panneaux en série`,
    });
  }

  // ── Isc max ≤ Imax entrée MPPT ───────────────────────────────────────────

  if (
    typeof panel?.iscA !== "number" ||
    typeof inverter?.imaxMppt !== "number"
  ) {
    checks.push(missingCheck("Isc max ≤ Imax MPPT", "panel.iscA / inverter.imaxMppt"));
  } else {
    // Isc string = Isc panneau (panneaux en série, même courant)
    const iscString = panel.iscA;
    const status =
      iscString > inverter.imaxMppt
        ? "error"
        : iscString > inverter.imaxMppt * 0.95
        ? "warning"
        : "ok";
    checks.push({
      criterion: "Isc max ≤ Imax MPPT",
      measured: Math.round(iscString * 10) / 10,
      limit: inverter.imaxMppt,
      status,
      unit: "A",
      message:
        status === "ok"
          ? `Isc = ${fmt(iscString)} A ≤ Imax MPPT ${fmt(inverter.imaxMppt)} A ✓`
          : status === "warning"
          ? `Isc = ${fmt(iscString)} A très proche de Imax MPPT ${fmt(inverter.imaxMppt)} A — vérifier la fiche technique`
          : `Isc = ${fmt(iscString)} A SUPÉRIEUR à Imax MPPT ${fmt(inverter.imaxMppt)} A — risque dommage onduleur`,
    });
  }

  // ── Calcul des valeurs de sortie ──────────────────────────────────────────

  const vocAtTmin =
    panel?.vocV != null && panel?.tempCoeffVocPctPerDeg != null
      ? computeVocAtTmin(panel.vocV, panel.tempCoeffVocPctPerDeg, tMinC)
      : null;

  return {
    vocMaxString: vocAtTmin != null ? Math.round(vocAtTmin * nSeries * 10) / 10 : null,
    vmppString:
      panel?.vmppV != null ? Math.round(panel.vmppV * nSeries * 10) / 10 : null,
    iscString: panel?.iscA != null ? Math.round(panel.iscA * 10) / 10 : null,
    checks,
  };
}

// ─── MPPT Check ────────────────────────────────────────────────────────────────

/**
 * Vérifie l'équilibrage des strings par MPPT.
 *
 * @param {object} params
 * @param {number} params.nStrings        — Nombre total de strings
 * @param {number} params.mpptCount       — Nombre de MPPT de l'onduleur
 * @param {number} params.inputsPerMppt   — Entrées max par MPPT
 * @returns {Check[]}
 */
export function computeMpptCheck({ nStrings, mpptCount, inputsPerMppt }) {
  const checks = [];

  if (!Number.isFinite(nStrings) || !Number.isFinite(mpptCount) || mpptCount < 1) {
    checks.push(missingCheck("Strings par MPPT", "nStrings / mpptCount"));
    return checks;
  }

  // Équilibrage : répartition idéale
  const stringsPerMpptIdeal = nStrings / mpptCount;
  const stringsPerMpptMin = Math.floor(stringsPerMpptIdeal);
  const stringsPerMpptMax = Math.ceil(stringsPerMpptIdeal);
  const imbalancePct =
    stringsPerMpptIdeal > 0
      ? ((stringsPerMpptMax - stringsPerMpptMin) / stringsPerMpptIdeal) * 100
      : 0;

  const balanceStatus =
    imbalancePct === 0
      ? "ok"
      : imbalancePct <= MPPT_IMBALANCE_WARNING_PCT
      ? "warning"
      : "error";

  checks.push({
    criterion: "Équilibrage MPPT",
    measured: Math.round(imbalancePct * 10) / 10,
    limit: MPPT_IMBALANCE_WARNING_PCT,
    status: balanceStatus,
    unit: "%",
    message:
      balanceStatus === "ok"
        ? `${nStrings} strings répartis équitablement sur ${mpptCount} MPPT (${stringsPerMpptMin} par MPPT) ✓`
        : balanceStatus === "warning"
        ? `Déséquilibre ${fmt(imbalancePct, 0)} % — ${stringsPerMpptMin}–${stringsPerMpptMax} strings par MPPT (idéal : équilibré)`
        : `Déséquilibre ${fmt(imbalancePct, 0)} % > ${MPPT_IMBALANCE_WARNING_PCT} % — revoir la répartition des strings`,
  });

  // Capacité max entrées
  if (Number.isFinite(inputsPerMppt) && inputsPerMppt > 0) {
    const maxStrings = mpptCount * inputsPerMppt;
    const capacityStatus = nStrings > maxStrings ? "error" : "ok";
    checks.push({
      criterion: "Capacité entrées MPPT",
      measured: nStrings,
      limit: maxStrings,
      status: capacityStatus,
      unit: "strings",
      message:
        capacityStatus === "ok"
          ? `${nStrings} strings ≤ ${maxStrings} entrées max (${mpptCount} MPPT × ${inputsPerMppt}) ✓`
          : `${nStrings} strings DÉPASSE ${maxStrings} entrées max — réduire le nombre de strings ou changer d'onduleur`,
    });
  }

  return checks;
}
