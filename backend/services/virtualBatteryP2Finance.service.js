/**
 * P2 — Tarification batterie virtuelle auto-adaptative (SolarNext).
 * Priorité : settings_json.pv.virtual_battery (grilles org) ; sinon logique legacy inchangée.
 */

import {
  vbGetSegmentRow,
  vbSelectMySmartTierFromGrid,
  vbBaseDischargeRatePerKwhFromRow,
  vbHphcDischargeRatesFromRow,
  vbHasExploitableProviderGrid,
} from "./pv/virtualBatteryGridResolve.service.js";
import {
  vbLegacyMySmartAnnualContributionHt,
  VB_LEGACY_DEFAULT_AUTOPROD_CONTRIBUTION_EUR_PER_YEAR_HT,
  VB_LEGACY_MYBATTERY_ACTIVATION_FEE_HT,
  VB_LEGACY_MYBATTERY_BASE_DISCHARGE_EUR_PER_KWH_HT,
  VB_LEGACY_MYBATTERY_HPHC_HP_DISCHARGE_EUR_PER_KWH_HT,
  VB_LEGACY_MYBATTERY_HPHC_HC_DISCHARGE_EUR_PER_KWH_HT,
  VB_LEGACY_URBAN_BASE_GRID_FEE_EUR_PER_KWH_HT,
  VB_LEGACY_URBAN_HPHC_HP_DISCHARGE_SUM_HT,
  VB_LEGACY_URBAN_HPHC_HC_DISCHARGE_SUM_HT,
} from "./pv/virtualBatteryLegacyDefaults.js";
import {
  VIRTUAL_BATTERY_P2_VAT_RATE,
  MYSMART_CAPACITY_TIERS_HT,
  URBAN_BASE_KVA_STEPS,
  URBAN_BASE_ENERGY_LOW,
  URBAN_BASE_ENERGY_HIGH,
  VIRTUAL_BATTERY_LEGACY_SUBSCRIPTION_EUR_PER_KWC_MONTH,
} from "./core/engineConstants.js";

export { MYSMART_CAPACITY_TIERS_HT };

const VAT = VIRTUAL_BATTERY_P2_VAT_RATE;

const P = {
  URBAN_SOLAR: "URBAN_SOLAR",
  MYLIGHT_MYBATTERY: "MYLIGHT_MYBATTERY",
  MYLIGHT_MYSMARTBATTERY: "MYLIGHT_MYSMARTBATTERY",
};

function round2(x) {
  return Math.round(Number(x) * 100) / 100;
}

function htToTtc(ht) {
  return round2(ht * (1 + VAT));
}

/**
 * Échelon kVA grille Urban BASE (aligné `frontend/src/data/virtualBatteryTariffs2026.ts` : 3,6,9 → LOW ; 12–36 → HIGH).
 * Pas d’invention hors ces paliers — le compteur est rattaché au palier Enedis le plus proche.
 */
export function meterKvaToNearestUrbanBaseStep(meterKva) {
  const n = Math.max(3, Math.min(36, Math.round(Number(meterKva))));
  return URBAN_BASE_KVA_STEPS.reduce((prev, curr) =>
    Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev
  );
}

/**
 * @returns {number|null} €/kWh HT énergie déstockée BASE ; null si indéterminé (TO_CONFIRM côté notes).
 */
export function urbanBaseEnergyPriceHt(meterKva) {
  const step = meterKvaToNearestUrbanBaseStep(meterKva);
  if (!Number.isFinite(step)) return null;
  const key = String(step);
  if (["3", "6", "9"].includes(key)) return URBAN_BASE_ENERGY_LOW;
  if (["12", "15", "18", "24", "30", "36"].includes(key)) return URBAN_BASE_ENERGY_HIGH;
  return null;
}

/**
 * Contract P2 : priorité champs devis ; sinon hint lead/form (hp_hc) sans nouveau choix métier.
 */
export function resolveP2ContractType(vbInput, ctx) {
  const ex = vbInput?.contract_type ?? vbInput?.contractType;
  if (ex != null && String(ex).trim() !== "") {
    return String(ex).toUpperCase() === "HPHC" ? "HPHC" : "BASE";
  }
  const hp =
    ctx?.form?.params?.hp_hc === true ||
    ctx?.form?.params?.hp_hc === "oui" ||
    ctx?.form?.params?.hp_hc === "OUI" ||
    ctx?.form?.lead?.hp_hc === true;
  return hp ? "HPHC" : "BASE";
}

export function urbanBaseGridFeeHt() {
  return VB_LEGACY_URBAN_BASE_GRID_FEE_EUR_PER_KWH_HT;
}

/** Sélection palier MySmart ; requiredKwh &gt; dernier palier → erreur métier */
export function selectMySmartTier(requiredKwh) {
  const req = Number(requiredKwh);
  if (!Number.isFinite(req) || req < 0) {
    return { ok: false, reason: "INVALID_REQUIRED_CAPACITY" };
  }
  const sorted = [...MYSMART_CAPACITY_TIERS_HT].sort((a, b) => a[0] - b[0]);
  const last = sorted[sorted.length - 1];
  if (req > last[0]) {
    return { ok: false, reason: "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY", required_kwh: req, max_tier_kwh: last[0] };
  }
  const tier = sorted.find((t) => t[0] >= req) ?? last;
  return { ok: true, selected_capacity_kwh: tier[0], monthly_subscription_ht: tier[1] };
}

/**
 * Ventilation décharge HP/HC depuis un masque optionnel 8760 (1 = HP, 0 = HC).
 * @returns {{ ok: boolean, discharged_hp_kwh?: number, discharged_hc_kwh?: number, status: string }}
 */
export function splitDischargeHpHc(hourlyDischarge, hourlyIsHp) {
  const d = hourlyDischarge;
  if (!Array.isArray(d) || d.length !== 8760) {
    return { ok: false, status: "PARTIAL_HPHC_ALLOCATION" };
  }
  if (!Array.isArray(hourlyIsHp) || hourlyIsHp.length !== 8760) {
    return { ok: false, status: "PARTIAL_HPHC_ALLOCATION" };
  }
  let hp = 0;
  let hc = 0;
  for (let i = 0; i < 8760; i++) {
    const x = Number(d[i]) || 0;
    const isHp = hourlyIsHp[i] === true || hourlyIsHp[i] === 1;
    if (isHp) hp += x;
    else hc += x;
  }
  return {
    ok: true,
    discharged_hp_kwh: round2(hp),
    discharged_hc_kwh: round2(hc),
    status: "OK",
  };
}

/**
 * @param {{
 *   providerCode: string,
 *   contractType: "BASE" | "HPHC",
 *   installedKwc: number,
 *   meterKva: number,
 *   vbSim: object,
 *   unboundedRequiredCapacityKwh: number,
 *   hourlyDischargeKwh: number[],
 *   hphcHourlyIsHp?: boolean[]|number[]|null,
 *   tariffElectricityPerKwh: number,
 *   oaRatePerKwh: number,
 *   virtual_battery_settings?: object | null,
 * }} input
 */
export function computeVirtualBatteryP2Finance(input) {
  const notes = [];
  const grids =
    input.virtual_battery_settings && typeof input.virtual_battery_settings === "object"
      ? input.virtual_battery_settings
      : null;
  const useGrid = vbHasExploitableProviderGrid(grids);
  const providerCode = String(input.providerCode || "").toUpperCase();
  const contractType = input.contractType === "HPHC" ? "HPHC" : "BASE";
  const installedKwc = Number(input.installedKwc) || 0;
  const meterKva = Number(input.meterKva) || 0;
  const discharged = Number(input.vbSim?.virtual_battery_total_discharged_kwh) || 0;
  const overflowKwh = Number(input.vbSim?.virtual_battery_overflow_export_kwh) || 0;
  const billableImport = Number(input.vbSim?.grid_import_kwh) || 0;
  const reqCap = Number(input.unboundedRequiredCapacityKwh) || 0;

  /** @type {{ ok: true, selected_capacity_kwh: number, monthly_subscription_ht: number } | null} */
  let preselectedMySmartTier = null;
  if (providerCode === P.MYLIGHT_MYSMARTBATTERY) {
    let t = null;
    const pcGrid = useGrid ? grids.providers[providerCode] : null;
    if (pcGrid && Array.isArray(pcGrid.capacityTiers) && pcGrid.capacityTiers.length > 0) {
      const tg = vbSelectMySmartTierFromGrid(pcGrid, reqCap);
      if (tg.ok) {
        t = {
          ok: true,
          selected_capacity_kwh: tg.selected_capacity_kwh,
          monthly_subscription_ht: tg.monthly_subscription_ht,
        };
      } else if (tg.reason === "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY") {
        return {
          virtual_battery_finance: null,
          provider_tier_status: "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY",
          missing_tier: true,
          annual_recurring_provider_cost_ttc: null,
          annual_activation_fee_ttc_only: null,
        };
      }
    }
    if (!t) {
      const legacy = selectMySmartTier(reqCap);
      if (!legacy.ok) {
        return {
          virtual_battery_finance: null,
          provider_tier_status: "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY",
          missing_tier: true,
          annual_recurring_provider_cost_ttc: null,
          annual_activation_fee_ttc_only: null,
        };
      }
      t = legacy;
    }
    preselectedMySmartTier = t;
  }

  /** @type {"OK"|"PARTIAL_HPHC_ALLOCATION"|"NOT_APPLICABLE"} */
  let hphc_allocation_status = "NOT_APPLICABLE";
  let annual_virtual_discharge_cost_ht = null;
  let discharged_hp_kwh = null;
  let discharged_hc_kwh = null;

  let pricing_mode = "HYBRID";
  let annual_subscription_ht = 0;
  let annual_autoproducer_contribution_ht = 0;
  let annual_activation_fee_ht = 0;
  let selected_capacity_kwh = reqCap;

  if (contractType === "HPHC") {
    hphc_allocation_status = "PARTIAL_HPHC_ALLOCATION";
    const split = splitDischargeHpHc(input.hourlyDischargeKwh || [], input.hphcHourlyIsHp || null);
    if (split.ok) {
      hphc_allocation_status = "OK";
      discharged_hp_kwh = split.discharged_hp_kwh;
      discharged_hc_kwh = split.discharged_hc_kwh;
    }
  }

  if (providerCode === P.URBAN_SOLAR) {
    pricing_mode = contractType === "HPHC" ? "URBAN_HPHC" : "URBAN_BASE";
    annual_activation_fee_ht = 0;
    const rowUrban = useGrid ? vbGetSegmentRow(grids, providerCode, contractType, meterKva) : null;
    if (rowUrban && rowUrban.enabled) {
      annual_subscription_ht = round2(
        installedKwc * (Number(rowUrban.abonnement_per_kwc_month) || 0) * 12 +
          (Number(rowUrban.abonnement_fixed_month) || 0) * 12
      );
      annual_autoproducer_contribution_ht = round2(Number(rowUrban.contribution_eur_per_year) || 0);
      if (contractType === "BASE") {
        const rate = vbBaseDischargeRatePerKwhFromRow(rowUrban);
        if (rate != null) {
          annual_virtual_discharge_cost_ht = round2(discharged * rate);
        } else {
          annual_virtual_discharge_cost_ht = null;
          notes.push("Urban BASE : ligne grille sans restitution/réseau €/kWh — coût déstockage non calculé.");
        }
      } else if (hphc_allocation_status === "OK" && discharged_hp_kwh != null && discharged_hc_kwh != null) {
        const rates = vbHphcDischargeRatesFromRow(rowUrban);
        if (rates != null) {
          annual_virtual_discharge_cost_ht = round2(
            discharged_hp_kwh * rates.hp + discharged_hc_kwh * rates.hc
          );
        } else {
          annual_virtual_discharge_cost_ht = round2(
            discharged_hp_kwh * VB_LEGACY_URBAN_HPHC_HP_DISCHARGE_SUM_HT +
              discharged_hc_kwh * VB_LEGACY_URBAN_HPHC_HC_DISCHARGE_SUM_HT
          );
        }
      } else {
        annual_virtual_discharge_cost_ht = null;
        notes.push("HPHC Urban : ventilation HP/HC décharge absente ou incomplète — pas de coût déstockage calculé.");
      }
    } else {
      annual_subscription_ht = round2(installedKwc * VIRTUAL_BATTERY_LEGACY_SUBSCRIPTION_EUR_PER_KWC_MONTH * 12);
      annual_autoproducer_contribution_ht = VB_LEGACY_DEFAULT_AUTOPROD_CONTRIBUTION_EUR_PER_YEAR_HT;
      if (contractType === "BASE") {
        const e = urbanBaseEnergyPriceHt(meterKva);
        const g = urbanBaseGridFeeHt();
        if (e == null) {
          annual_virtual_discharge_cost_ht = null;
          notes.push(
            "Urban BASE : prix énergie déstockée TO_CONFIRM (palier kVA non résolu dans la grille 3–36 kVA alignée CRM)."
          );
        } else {
          annual_virtual_discharge_cost_ht = round2(discharged * (e + g));
        }
      } else if (hphc_allocation_status === "OK" && discharged_hp_kwh != null && discharged_hc_kwh != null) {
        annual_virtual_discharge_cost_ht = round2(
          discharged_hp_kwh * VB_LEGACY_URBAN_HPHC_HP_DISCHARGE_SUM_HT +
            discharged_hc_kwh * VB_LEGACY_URBAN_HPHC_HC_DISCHARGE_SUM_HT
        );
      } else {
        annual_virtual_discharge_cost_ht = null;
        notes.push("HPHC Urban : ventilation HP/HC décharge absente ou incomplète — pas de coût déstockage calculé.");
      }
    }
  } else if (providerCode === P.MYLIGHT_MYBATTERY) {
    pricing_mode = contractType === "HPHC" ? "MYBATTERY_HPHC" : "MYBATTERY_BASE";
    annual_activation_fee_ht = VB_LEGACY_MYBATTERY_ACTIVATION_FEE_HT;
    const rowMb = useGrid ? vbGetSegmentRow(grids, providerCode, contractType, meterKva) : null;
    if (rowMb && rowMb.enabled) {
      annual_subscription_ht = round2(
        installedKwc * (Number(rowMb.abonnement_per_kwc_month) || 0) * 12 +
          (Number(rowMb.abonnement_fixed_month) || 0) * 12
      );
      annual_autoproducer_contribution_ht = round2(Number(rowMb.contribution_eur_per_year) || 0);
      if (contractType === "BASE") {
        const rate = vbBaseDischargeRatePerKwhFromRow(rowMb);
        if (rate != null) {
          annual_virtual_discharge_cost_ht = round2(discharged * rate);
        } else {
          annual_virtual_discharge_cost_ht = round2(discharged * VB_LEGACY_MYBATTERY_BASE_DISCHARGE_EUR_PER_KWH_HT);
        }
      } else if (hphc_allocation_status === "OK" && discharged_hp_kwh != null && discharged_hc_kwh != null) {
        const rates = vbHphcDischargeRatesFromRow(rowMb);
        if (rates != null) {
          annual_virtual_discharge_cost_ht = round2(
            discharged_hp_kwh * rates.hp + discharged_hc_kwh * rates.hc
          );
        } else {
          annual_virtual_discharge_cost_ht = round2(
            discharged_hp_kwh * VB_LEGACY_MYBATTERY_HPHC_HP_DISCHARGE_EUR_PER_KWH_HT +
              discharged_hc_kwh * VB_LEGACY_MYBATTERY_HPHC_HC_DISCHARGE_EUR_PER_KWH_HT
          );
        }
      } else {
        annual_virtual_discharge_cost_ht = null;
        notes.push("HPHC MyBattery : ventilation HP/HC décharge absente — pas de coût déstockage calculé.");
      }
    } else {
      annual_subscription_ht = round2(installedKwc * VIRTUAL_BATTERY_LEGACY_SUBSCRIPTION_EUR_PER_KWC_MONTH * 12);
      annual_autoproducer_contribution_ht = VB_LEGACY_DEFAULT_AUTOPROD_CONTRIBUTION_EUR_PER_YEAR_HT;
      if (contractType === "BASE") {
        annual_virtual_discharge_cost_ht = round2(discharged * VB_LEGACY_MYBATTERY_BASE_DISCHARGE_EUR_PER_KWH_HT);
      } else if (hphc_allocation_status === "OK" && discharged_hp_kwh != null && discharged_hc_kwh != null) {
        annual_virtual_discharge_cost_ht = round2(
          discharged_hp_kwh * VB_LEGACY_MYBATTERY_HPHC_HP_DISCHARGE_EUR_PER_KWH_HT +
            discharged_hc_kwh * VB_LEGACY_MYBATTERY_HPHC_HC_DISCHARGE_EUR_PER_KWH_HT
        );
      } else {
        annual_virtual_discharge_cost_ht = null;
        notes.push("HPHC MyBattery : ventilation HP/HC décharge absente — pas de coût déstockage calculé.");
      }
    }
  } else if (providerCode === P.MYLIGHT_MYSMARTBATTERY) {
    pricing_mode = "MYSMART_CAPACITY";
    selected_capacity_kwh = preselectedMySmartTier.selected_capacity_kwh;
    annual_subscription_ht = round2(preselectedMySmartTier.monthly_subscription_ht * 12);
    annual_activation_fee_ht = 0;
    annual_virtual_discharge_cost_ht = 0;
    const pcSmart = useGrid ? grids.providers[providerCode] : null;
    const cr = pcSmart?.contributionRule;
    if (useGrid && pcSmart && cr && typeof cr === "object" && Number.isFinite(Number(cr.a))) {
      annual_autoproducer_contribution_ht = round2(Number(cr.a) * meterKva + Number(cr.b ?? 0));
    } else {
      annual_autoproducer_contribution_ht = round2(vbLegacyMySmartAnnualContributionHt(meterKva));
    }
    if (contractType === "HPHC") {
      hphc_allocation_status = "NOT_APPLICABLE";
      notes.push("MySmartBattery : contrat toujours forfait déstockage 0 €/kWh (réseau/taxes inclus dans palier).");
    }
  } else {
    notes.push(`Fournisseur non reconnu pour P2 : ${providerCode}`);
  }

  const annual_virtual_discharge_cost_ttc =
    annual_virtual_discharge_cost_ht != null ? htToTtc(annual_virtual_discharge_cost_ht) : null;

  const annual_subscription_ttc = htToTtc(annual_subscription_ht);
  const annual_activation_fee_ttc = htToTtc(annual_activation_fee_ht);
  const annual_autoproducer_contribution_ttc = htToTtc(annual_autoproducer_contribution_ht);

  const tariff = Number(input.tariffElectricityPerKwh) || 0;
  const oa = Number(input.oaRatePerKwh) || 0;

  const importKwhVirt = Number.isFinite(billableImport) ? billableImport : 0;
  const annual_grid_import_cost_ht = round2(importKwhVirt * tariff);
  const annual_grid_import_cost_ttc = htToTtc(annual_grid_import_cost_ht);

  const annual_overflow_export_revenue_ht = round2(overflowKwh * oa);
  const annual_overflow_export_revenue_ttc = htToTtc(annual_overflow_export_revenue_ht);

  const hphcPartial =
    contractType === "HPHC" &&
    (providerCode === P.URBAN_SOLAR || providerCode === P.MYLIGHT_MYBATTERY) &&
    annual_virtual_discharge_cost_ht === null;
  const urbanBaseEnergyMissing =
    contractType === "BASE" &&
    providerCode === P.URBAN_SOLAR &&
    annual_virtual_discharge_cost_ht === null;

  const dischargeForTotal =
    hphcPartial || urbanBaseEnergyMissing
      ? 0
      : annual_virtual_discharge_cost_ht != null
        ? annual_virtual_discharge_cost_ht
        : 0;
  if (urbanBaseEnergyMissing) {
    notes.push(
      "annual_total_virtual_cost : hors coût déstockage — prix énergie BASE Urban TO_CONFIRM ou non résolu."
    );
  }

  const annual_total_virtual_cost_ht = round2(
    annual_subscription_ht + annual_autoproducer_contribution_ht + dischargeForTotal
  );
  const annual_total_virtual_cost_ttc = round2(
    htToTtc(annual_subscription_ht + annual_autoproducer_contribution_ht + dischargeForTotal)
  );

  const virtual_battery_finance = {
    provider_code: providerCode,
    provider_tier_status: "OK",
    pricing_mode,
    required_capacity_kwh: round2(reqCap),
    selected_capacity_kwh: round2(selected_capacity_kwh),
    annual_subscription_ht: round2(annual_subscription_ht),
    annual_subscription_ttc,
    annual_activation_fee_ht: round2(annual_activation_fee_ht),
    annual_activation_fee_ttc,
    annual_autoproducer_contribution_ht: round2(annual_autoproducer_contribution_ht),
    annual_autoproducer_contribution_ttc,
    annual_virtual_discharge_cost_ht,
    annual_virtual_discharge_cost_ttc,
    annual_grid_import_cost_ht,
    annual_grid_import_cost_ttc,
    annual_overflow_export_revenue_ht,
    annual_overflow_export_revenue_ttc,
    annual_total_virtual_cost_ht,
    annual_total_virtual_cost_ttc,
    hphc_allocation_status,
    notes,
  };

  return {
    virtual_battery_finance,
    provider_tier_status: "OK",
    missing_tier: false,
    /** pour _virtualBatteryQuote : coût récurrent TTC annuel (hors activation ponctuelle) */
    annual_recurring_provider_cost_ttc: annual_total_virtual_cost_ttc,
    annual_activation_fee_ttc_only: annual_activation_fee_ttc,
  };
}

/**
 * Écart vs BASE (énergie + service BV récurrent TTC ; activation incluse côté virtuel seulement si indiqué).
 */
export function computeVirtualBatteryBusiness({
  virtual_battery_finance,
  baseImportKwh,
  virtImportKwh,
  baseOverflowOrSurplusKwh,
  virtOverflowKwh,
  tariffElectricityPerKwh,
  oaRatePerKwh,
  includeActivationInVirtualYear1 = false,
  annual_virtual_discharge_kwh = null,
}) {
  const price = Number(tariffElectricityPerKwh) || 0;
  const oa = Number(oaRatePerKwh) || 0;
  const bi = Number(baseImportKwh) || 0;
  const vi = Number(virtImportKwh) || 0;
  const bs = Number(baseOverflowOrSurplusKwh) || 0;
  const vo = Number(virtOverflowKwh) || 0;

  const baseNet = round2(bi * price - bs * oa);
  const virtEnergyNet = round2(vi * price - vo * oa);
  const vf = virtual_battery_finance;
  const recurringServiceTtc = vf?.annual_total_virtual_cost_ttc ?? 0;
  const activationTtc = includeActivationInVirtualYear1 ? (vf?.annual_activation_fee_ttc ?? 0) : 0;
  const virtTotal = round2(virtEnergyNet + recurringServiceTtc + activationTtc);

  const annual_cost_delta_vs_base_ttc = round2(virtTotal - baseNet);
  const annual_savings_vs_base_ttc = round2(baseNet - virtTotal);

  return {
    annual_cost_delta_vs_base_ttc,
    annual_savings_vs_base_ttc,
    annual_grid_import_reduction_kwh: round2(bi - vi),
    annual_overflow_export_kwh: vo,
    annual_virtual_discharge_kwh:
      annual_virtual_discharge_kwh != null && Number.isFinite(Number(annual_virtual_discharge_kwh))
        ? round2(Number(annual_virtual_discharge_kwh))
        : null,
  };
}
