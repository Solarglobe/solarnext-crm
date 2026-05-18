/**
 * electricalValidation.js — Orchestrateur de validation électrique PV.
 *
 * Lit geometry_json (ou le payload SmartPitch enrichi), appelle les trois
 * moteurs purs (stringSizing, dcAcRatio, mpptCheck) et retourne un JSON
 * de validation unifié.
 *
 * AUCUNE dépendance DB, AUCUN import HTTP.
 * Les données électriques panneau et onduleur doivent être présentes dans
 * le payload ; sinon les checks correspondants passent en statut 'neutral'.
 *
 * Sources de données attendues dans geometry_json / payload enrichi :
 *   panel.voc_v, panel.isc_a, panel.vmp_v, panel.temp_coeff_pct_per_deg
 *   panel.power_wc, panel.width_mm, panel.height_mm
 *   pvParams.nSeries          — strings en série (optionnel)
 *   pvParams.nStrings         — nombre total de strings (optionnel)
 *   pvParams.tMinC            — température minimale site °C (défaut −10)
 *   pv_inverter.nominal_power_kw
 *   pv_inverter.mppt_count, pv_inverter.inputs_per_mppt
 *   pv_inverter.mppt_min_v, pv_inverter.mppt_max_v
 *   pv_inverter.max_input_current_a
 *   pv_inverter.voc_max       — issu de inverterDatabase.json (lookup statique)
 *
 * Format de sortie :
 * {
 *   status: 'ok'|'warning'|'error'|'neutral',  — statut global
 *   checks: Check[],                             — tous les critères à plat
 *   stringSizing: { vocMaxString, vmppString, iscString, checks },
 *   dcAcRatio:    { ratioDcAc, peakDcKw, acNominalKw, clippingEstimatePct, status, message },
 *   mpptCheck:    { checks },
 *   meta: { panelCount, nSeries, tMinC, inverterModel }
 * }
 */

import { createRequire } from "module";
import { computeStringSizing, computeMpptCheck } from "./stringSizing.js";
import { computeDcAcRatio } from "./dcAcRatio.js";

const require = createRequire(import.meta.url);
/** @type {Array<import('./inverterDatabase.json')>} */
const INVERTER_DB = require("./inverterDatabase.json");

// ─── Lookup onduleur dans la base statique ────────────────────────────────────

/**
 * Cherche un onduleur dans inverterDatabase.json par model_ref ou name.
 * Retourne null si introuvable.
 * @param {string|null|undefined} modelRef
 * @param {string|null|undefined} brand
 * @returns {object|null}
 */
function lookupInverterDb(modelRef, brand) {
  if (!modelRef && !brand) return null;
  // Correspondance exacte model_ref
  if (modelRef) {
    const exact = INVERTER_DB.find(
      (inv) => inv.modelRef.toLowerCase() === String(modelRef).toLowerCase()
    );
    if (exact) return exact;
    // Correspondance partielle (le model_ref peut être abrégé)
    const partial = INVERTER_DB.find(
      (inv) =>
        inv.modelRef.toLowerCase().includes(String(modelRef).toLowerCase()) ||
        String(modelRef).toLowerCase().includes(inv.modelRef.toLowerCase())
    );
    if (partial) return partial;
  }
  // Correspondance brand uniquement en dernier recours
  if (brand) {
    return INVERTER_DB.find(
      (inv) => inv.brand.toLowerCase() === String(brand).toLowerCase()
    ) ?? null;
  }
  return null;
}

// ─── Extraction données depuis geometry_json ──────────────────────────────────

/**
 * Extrait les specs panneau depuis geometry_json / payload enrichi.
 * @param {object} gj
 * @returns {import('./stringSizing.js').PanelSpec | null}
 */
function extractPanelSpec(gj) {
  // Le payload enrichi peut avoir panel_input (SmartPitch) ou panel (geometry_json brut)
  const rawPanel = gj?.panel_input ?? gj?.panel ?? gj?.panelSpec ?? null;
  if (!rawPanel) return null;

  const vocV    = Number(rawPanel.voc_v   ?? rawPanel.vocV   ?? null);
  const vmppV   = Number(rawPanel.vmp_v   ?? rawPanel.vmppV  ?? null);
  const iscA    = Number(rawPanel.isc_a   ?? rawPanel.iscA   ?? null);
  const tCoeff  = Number(rawPanel.temp_coeff_pct_per_deg ?? rawPanel.tempCoeffVocPctPerDeg ?? null);
  const powerWc = Number(rawPanel.power_wc ?? rawPanel.powerWc ?? null);

  return {
    vocV:                 Number.isFinite(vocV)   ? vocV   : null,
    vmppV:                Number.isFinite(vmppV)  ? vmppV  : null,
    iscA:                 Number.isFinite(iscA)   ? iscA   : null,
    tempCoeffVocPctPerDeg: Number.isFinite(tCoeff) ? tCoeff : null,
    powerWc:              Number.isFinite(powerWc) ? powerWc : null,
  };
}

/**
 * Extrait les specs onduleur depuis le payload enrichi + lookup DB statique.
 * @param {object} gj
 * @returns {import('./stringSizing.js').InverterSpec | null}
 */
function extractInverterSpec(gj) {
  // pv_inverter = champ enrichi par resolvePvInverterEngineFields()
  const rawInv = gj?.pv_inverter ?? gj?.inverter ?? null;
  if (!rawInv) return null;

  const modelRef = rawInv.model_ref ?? rawInv.modelRef ?? rawInv.name ?? null;
  const brand    = rawInv.brand ?? null;

  // Merge données DB dynamique + DB statique (pour voc_max)
  const dbEntry  = lookupInverterDb(modelRef, brand);

  const vocMax      = Number(rawInv.voc_max    ?? dbEntry?.vocMax    ?? null);
  const vmppMin     = Number(rawInv.mppt_min_v ?? rawInv.vmppMin    ?? dbEntry?.vmppMin ?? null);
  const vmppMax     = Number(rawInv.mppt_max_v ?? rawInv.vmppMax    ?? dbEntry?.vmppMax ?? null);
  const imaxMppt    = Number(rawInv.max_input_current_a ?? rawInv.imaxMppt ?? dbEntry?.imaxMppt ?? null);
  const mpptCount   = Number(rawInv.mppt_count ?? rawInv.mpptCount  ?? dbEntry?.mpptCount ?? null);
  const inputsPer   = Number(rawInv.inputs_per_mppt ?? rawInv.inputsPerMppt ?? dbEntry?.inputsPerMppt ?? null);
  const nominalKw   = Number(rawInv.nominal_power_kw ?? rawInv.nominalKw ?? rawInv.inverter_nominal_kw_total ?? null);

  return {
    vocMax:         Number.isFinite(vocMax)    ? vocMax    : null,
    vmppMin:        Number.isFinite(vmppMin)   ? vmppMin   : null,
    vmppMax:        Number.isFinite(vmppMax)   ? vmppMax   : null,
    imaxMppt:       Number.isFinite(imaxMppt)  ? imaxMppt  : null,
    mpptCount:      Number.isFinite(mpptCount) ? mpptCount : null,
    inputsPerMppt:  Number.isFinite(inputsPer) ? inputsPer : null,
    nominalKw:      Number.isFinite(nominalKw) ? nominalKw : null,
    modelRef,
    brand,
    _fromStaticDb:  dbEntry != null,
  };
}

// ─── Statut global ────────────────────────────────────────────────────────────

/**
 * Retourne le statut agrégé le plus sévère d'une liste de checks.
 * @param {Array<{status: string}>} allChecks
 * @returns {'ok'|'warning'|'error'|'neutral'}
 */
function aggregateStatus(allChecks) {
  const statuses = allChecks.map((c) => c.status);
  if (statuses.includes("error"))   return "error";
  if (statuses.includes("warning")) return "warning";
  if (statuses.every((s) => s === "neutral")) return "neutral";
  return "ok";
}

// ─── Point d'entrée principal ─────────────────────────────────────────────────

/**
 * Calcule la validation électrique complète à partir d'un geometry_json
 * ou d'un payload SmartPitch déjà enrichi (panel_input / pv_inverter).
 *
 * @param {object} gj — geometry_json ou payload enrichi
 * @returns {object} — JSON de validation (voir JSDoc module)
 */
export function computeElectricalValidation(gj) {
  if (!gj || typeof gj !== "object") {
    return {
      status: "neutral",
      checks: [],
      stringSizing: null,
      dcAcRatio: null,
      mpptCheck: null,
      meta: {},
    };
  }

  const panelSpec    = extractPanelSpec(gj);
  const inverterSpec = extractInverterSpec(gj);

  // Paramètres string depuis pvParams
  const pvParams  = gj?.pvParams ?? {};
  const nSeries   = Number(pvParams.nSeries ?? pvParams.panelsPerString ?? null);
  const nStrings  = Number(pvParams.nStrings ?? null);
  const tMinC     = Number(pvParams.tMinC ?? -10);

  // Comptage panneaux depuis frozenBlocks
  const frozenBlocks = gj?.frozenBlocks ?? [];
  const panelCount   = frozenBlocks.reduce(
    (s, b) => s + (b.panels?.length ?? 0), 0
  );

  // ── String Sizing ──────────────────────────────────────────────────────────

  let stringSizingResult = { vocMaxString: null, vmppString: null, iscString: null, checks: [] };

  if (!Number.isFinite(nSeries) || nSeries < 1) {
    stringSizingResult.checks = [
      {
        criterion: "String sizing",
        measured: null,
        limit: null,
        status: "neutral",
        message: "nSeries non configuré (pvParams.nSeries manquant) — calcul string sizing non disponible",
      },
    ];
  } else {
    stringSizingResult = computeStringSizing({
      panel: panelSpec,
      inverter: inverterSpec,
      nSeries,
      tMinC,
    });
  }

  // ── DC/AC Ratio ────────────────────────────────────────────────────────────

  let dcAcResult = null;
  const panelWp   = panelSpec?.powerWc ?? null;
  const invKw     = inverterSpec?.nominalKw ?? null;

  if (panelWp != null && panelCount > 0 && invKw != null && invKw > 0) {
    dcAcResult = computeDcAcRatio({ panelWp, panelCount, inverterKw: invKw });
  } else {
    dcAcResult = {
      ratioDcAc: null,
      peakDcKw: panelWp != null ? Math.round((panelWp * panelCount) / 1000 * 100) / 100 : null,
      acNominalKw: invKw,
      clippingEstimatePct: null,
      status: "neutral",
      message: "DC/AC ratio non calculable — données panneau ou onduleur manquantes",
    };
  }

  // ── MPPT Check ─────────────────────────────────────────────────────────────

  let mpptResult = { checks: [] };
  if (
    Number.isFinite(nStrings) && nStrings > 0 &&
    Number.isFinite(inverterSpec?.mpptCount) &&
    Number.isFinite(inverterSpec?.inputsPerMppt)
  ) {
    mpptResult.checks = computeMpptCheck({
      nStrings,
      mpptCount: inverterSpec.mpptCount,
      inputsPerMppt: inverterSpec.inputsPerMppt,
    });
  } else {
    mpptResult.checks = [
      {
        criterion: "MPPT check",
        measured: null,
        limit: null,
        status: "neutral",
        message: "nStrings ou specs MPPT manquants — check MPPT non disponible",
      },
    ];
  }

  // ── Agrégation ─────────────────────────────────────────────────────────────

  const allChecks = [
    ...stringSizingResult.checks,
    ...(dcAcResult
      ? [
          {
            criterion: "Ratio DC/AC",
            measured: dcAcResult.ratioDcAc,
            limit: RATIO_MAX_ERROR,
            status: dcAcResult.status,
            message: dcAcResult.message,
            unit: "",
          },
        ]
      : []),
    ...mpptResult.checks,
  ];

  const status = aggregateStatus(allChecks);

  return {
    status,
    checks: allChecks,
    stringSizing: stringSizingResult,
    dcAcRatio: dcAcResult,
    mpptCheck: mpptResult,
    meta: {
      panelCount,
      nSeries: Number.isFinite(nSeries) ? nSeries : null,
      nStrings: Number.isFinite(nStrings) ? nStrings : null,
      tMinC,
      inverterModel: inverterSpec?.modelRef ?? null,
      inverterFromStaticDb: inverterSpec?._fromStaticDb ?? false,
    },
  };
}

// Constante réexportée pour les tests
export const RATIO_MAX_ERROR = 1.40;
