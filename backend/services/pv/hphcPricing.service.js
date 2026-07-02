/**
 * LOT3-HPHC-VALO — Valorisation HP/HC des économies par « prix effectifs » (p_eff).
 *
 * Principe (cf. CARTOGRAPHIE_LOT3_VALORISATION_HPHC_2026-07-02.md) : le moteur valorise
 * historiquement tous les kWh au prix unique econ.price_eur_kwh. Pour un contrat HP/HC,
 * chaque flux d'énergie a pourtant sa propre valeur horaire. On calcule donc, par scénario,
 * des prix effectifs pondérés par les séries 8760 :
 *
 *   p_eff(flux) = Σ(flux_h × prix_h) / Σ(flux_h)   avec prix_h = priceHp ou priceHc (masque)
 *
 * Ces p_eff remplacent le prix plat dans financeService — UNIQUEMENT quand sc.pricing existe
 * (contrat HPHC + prix HP/HC saisis fiche compteur). Sinon : comportement historique inchangé.
 *
 * Les p_eff restent exacts sur 25 ans : HP et HC croissent du même elec_growth_pct, donc la
 * pondération horaire est invariante dans le temps (pas besoin de refondre buildCashflows).
 */

import { resolveHpHcHourlyMask } from "./hphcMask.service.js";
import { resolveP2ContractType } from "../virtualBatteryP2Finance.service.js";

const H8760 = 8760;

function round5(n) {
  return Math.round(n * 100000) / 100000;
}

function numOrNull(v) {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Contexte de valorisation HP/HC — null si non applicable (contrat BASE, prix absents).
 * À appeler une fois par calcul, après construction de ctx.form/ctx.virtual_battery_input.
 *
 * @param {object} ctx contexte moteur (form.params.elec_price_hp/hc_eur_kwh injectés par le Lot 2)
 * @returns {{ hourlyIsHp: boolean[], priceHp: number, priceHc: number } | null}
 */
export function resolveHpHcPricingContext(ctx) {
  const params = ctx?.form?.params ?? {};
  const priceHp = numOrNull(params.elec_price_hp_eur_kwh);
  const priceHc = numOrNull(params.elec_price_hc_eur_kwh);
  if (priceHp == null || priceHc == null) return null;

  const contractType = resolveP2ContractType(ctx?.virtual_battery_input ?? {}, ctx);
  if (contractType !== "HPHC") return null;

  const hourlyIsHp = resolveHpHcHourlyMask(ctx?.virtual_battery_input ?? {}, ctx);
  if (!Array.isArray(hourlyIsHp) || hourlyIsHp.length !== H8760) return null;

  return { hourlyIsHp, priceHp, priceHc };
}

/**
 * Prix effectif d'un flux horaire : Σ(w_h × prix_h) / Σ(w_h).
 * @param {number[]|null|undefined} weightsHourly série 8760 (kWh par heure du flux)
 * @param {{ hourlyIsHp: boolean[], priceHp: number, priceHc: number }} pricingCtx
 * @returns {number|null} null si série absente/invalide ou flux nul (l'appelant garde le prix plat)
 */
export function effectivePriceForHourlyWeights(weightsHourly, pricingCtx) {
  if (!pricingCtx || !Array.isArray(weightsHourly) || weightsHourly.length !== H8760) return null;
  const { hourlyIsHp, priceHp, priceHc } = pricingCtx;
  let sumW = 0;
  let sumWp = 0;
  for (let h = 0; h < H8760; h++) {
    const w = Number(weightsHourly[h]) || 0;
    if (w <= 0) continue;
    sumW += w;
    sumWp += w * (hourlyIsHp[h] === true || hourlyIsHp[h] === 1 ? priceHp : priceHc);
  }
  if (sumW <= 0) return null;
  return round5(sumWp / sumW);
}

/** min(pv, conso) heure par heure — autoconso directe (identique passThroughNoBattery). */
function directAutoHourly(pvHourly, consoHourly) {
  const out = new Array(H8760);
  for (let h = 0; h < H8760; h++) {
    out[h] = Math.min(Number(pvHourly[h]) || 0, Number(consoHourly[h]) || 0);
  }
  return out;
}

/** max(0, conso − servi) heure par heure — import réseau résiduel. */
function importHourlyFromServed(consoHourly, ...servedSeries) {
  const out = new Array(H8760);
  for (let h = 0; h < H8760; h++) {
    let served = 0;
    for (const s of servedSeries) served += Number(s?.[h]) || 0;
    out[h] = Math.max(0, (Number(consoHourly[h]) || 0) - served);
  }
  return out;
}

function sum(arr) {
  let s = 0;
  for (let h = 0; h < arr.length; h++) s += Number(arr[h]) || 0;
  return s;
}

/**
 * Construit sc.pricing pour un scénario à partir de ses séries 8760.
 * @param {{
 *   pricingCtx: { hourlyIsHp: boolean[], priceHp: number, priceHc: number },
 *   consoHourly: number[],
 *   autoHourly?: number[]|null,       kWh évités par autoconso (direct + décharge physique)
 *   importHourly?: number[]|null,     import réseau résiduel du scénario
 *   vbDischargeHourly?: number[]|null décharge / crédit virtuel utilisé
 * }} args
 * @returns {object|null} bloc sc.pricing (mode HPHC) ou null
 */
export function buildScenarioPricing({ pricingCtx, consoHourly, autoHourly, importHourly, vbDischargeHourly }) {
  if (!pricingCtx || !Array.isArray(consoHourly) || consoHourly.length !== H8760) return null;
  const p_eff_conso = effectivePriceForHourlyWeights(consoHourly, pricingCtx);
  if (p_eff_conso == null) return null;
  return {
    mode: "HPHC",
    price_hp_eur_kwh: pricingCtx.priceHp,
    price_hc_eur_kwh: pricingCtx.priceHc,
    p_eff_conso,
    p_eff_auto: effectivePriceForHourlyWeights(autoHourly, pricingCtx),
    p_eff_import: effectivePriceForHourlyWeights(importHourly, pricingCtx),
    p_eff_vb: effectivePriceForHourlyWeights(vbDischargeHourly, pricingCtx),
  };
}

/**
 * Post-passe : attache sc.pricing aux 4 scénarios avant financeService.computeFinance.
 * Reconstruit les séries manquantes depuis pv/conso (BASE) et les résultats 8760 conservés
 * (battPhysicalResult, sc._virtualBattery8760). Ne touche à rien si pricingCtx est null.
 *
 * @param {object} scenarios { BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL, BATTERY_HYBRID }
 * @param {object} ctx moteur (ctx.pv.hourly, ctx.conso.hourly)
 * @param {object|null} battPhysicalResult résultat simulateBattery8760 (physique)
 * @param {{ hourlyIsHp: boolean[], priceHp: number, priceHc: number }} pricingCtx
 */
export function attachHpHcPricingToScenarios(scenarios, ctx, battPhysicalResult, pricingCtx) {
  if (!pricingCtx || !scenarios || typeof scenarios !== "object") return;
  const pvHourly = ctx?.pv?.hourly;
  const consoHourly = ctx?.conso?.hourly;
  if (!Array.isArray(pvHourly) || pvHourly.length !== H8760) return;
  if (!Array.isArray(consoHourly) || consoHourly.length !== H8760) return;

  const baseAuto = directAutoHourly(pvHourly, consoHourly);
  const baseImport = importHourlyFromServed(consoHourly, baseAuto);

  // BASE
  if (scenarios.BASE && scenarios.BASE._skipped !== true) {
    scenarios.BASE.pricing = buildScenarioPricing({
      pricingCtx,
      consoHourly,
      autoHourly: baseAuto,
      importHourly: baseImport,
      vbDischargeHourly: null,
    });
  }

  // BATTERY_PHYSICAL — autoconso = direct + décharge batterie ; import = conso − direct − décharge
  const P = scenarios.BATTERY_PHYSICAL;
  if (P && P._skipped !== true && battPhysicalResult && Array.isArray(battPhysicalResult.batt_discharge_hourly)) {
    const direct = Array.isArray(battPhysicalResult.direct_self_consumption_hourly)
      ? battPhysicalResult.direct_self_consumption_hourly
      : baseAuto;
    const discharge = battPhysicalResult.batt_discharge_hourly;
    const physAuto = new Array(H8760);
    for (let h = 0; h < H8760; h++) {
      physAuto[h] = (Number(direct[h]) || 0) + (Number(discharge[h]) || 0);
    }
    P.pricing = buildScenarioPricing({
      pricingCtx,
      consoHourly,
      autoHourly: physAuto,
      importHourly: importHourlyFromServed(consoHourly, direct, discharge),
      vbDischargeHourly: null,
    });
  }

  // BATTERY_VIRTUAL — import résiduel + crédit utilisé depuis la simulation 8760 VB
  const V = scenarios.BATTERY_VIRTUAL;
  const v8 = V?._virtualBattery8760;
  if (V && V._skipped !== true && v8) {
    V.pricing = buildScenarioPricing({
      pricingCtx,
      consoHourly,
      autoHourly: baseAuto,
      importHourly: v8.virtual_battery_hourly_grid_import_kwh ?? null,
      vbDischargeHourly: v8.virtual_battery_hourly_discharge_kwh ?? v8.hourly_discharge ?? null,
    });
  }

  // BATTERY_HYBRID — autoconso = direct + décharge physique ; import/crédit depuis la VB post-physique
  const Hs = scenarios.BATTERY_HYBRID;
  const h8 = Hs?._virtualBattery8760;
  if (Hs && Hs._skipped !== true && h8) {
    let hybAuto = baseAuto;
    if (battPhysicalResult && Array.isArray(battPhysicalResult.batt_discharge_hourly)) {
      const direct = Array.isArray(battPhysicalResult.direct_self_consumption_hourly)
        ? battPhysicalResult.direct_self_consumption_hourly
        : baseAuto;
      hybAuto = new Array(H8760);
      for (let h = 0; h < H8760; h++) {
        hybAuto[h] =
          (Number(direct[h]) || 0) + (Number(battPhysicalResult.batt_discharge_hourly[h]) || 0);
      }
    }
    Hs.pricing = buildScenarioPricing({
      pricingCtx,
      consoHourly,
      autoHourly: hybAuto,
      importHourly: h8.virtual_battery_hourly_grid_import_kwh ?? null,
      vbDischargeHourly: h8.virtual_battery_hourly_discharge_kwh ?? h8.hourly_discharge ?? null,
    });
  }

  // Cohérence residual_bill (P5) : recalcule la facture résiduelle des scénarios non-VB
  // au prix effectif d'import (les scénarios VB portent residual_bill_eur = null par design).
  for (const key of ["BASE", "BATTERY_PHYSICAL"]) {
    const sc = scenarios[key];
    const pEffImport = sc?.pricing?.p_eff_import;
    if (sc && pEffImport != null && sc.residual_bill_eur != null) {
      const imp = Number(sc.import_kwh ?? sc.energy?.import);
      if (Number.isFinite(imp)) {
        sc.residual_bill_eur = Math.round(imp * pEffImport * 100) / 100;
      }
    }
  }
}

export const _internals = { directAutoHourly, importHourlyFromServed, sum };
