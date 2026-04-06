/**
 * Calcul coût annuel batterie virtuelle.
 * CALC : computeVirtualBatteryQuote (config uniquement, sans DB) — réexport depuis virtualBatteryQuoteCalcOnly.
 * Route devis : computeVirtualBatteryQuoteFromGrid (grille DB).
 */

import { pool } from "../config/db.js";
import { computeVirtualBatteryQuote } from "./virtualBatteryQuoteCalcOnly.service.js";

export { computeVirtualBatteryQuote };

// ======================================================================
// Legacy : calcul depuis la grille DB (route POST /quotes/virtual-battery/compute)
// ======================================================================

const SEGMENT_CODES = ["PART_BASE", "PART_HPHC", "PRO_BASE_CU", "PRO_HPHC_MU"];
const KVA_OPTIONS = [3, 6, 9, 12, 15, 18, 24, 30, 36];
const DEFAULT_HP_RATIO = 0.7;
const DEFAULT_HC_RATIO = 0.3;

async function loadVirtualBattery(organizationId, providerCode) {
  const result = await pool.query(
    `SELECT tariff_grid_json, activation_fee_ht
     FROM pv_virtual_batteries
     WHERE organization_id = $1 AND provider_code = $2 AND is_active = true`,
    [organizationId, providerCode]
  );
  if (result.rows.length === 0) return null;
  const row = result.rows[0];
  const grid = row.tariff_grid_json;
  return {
    tariff_grid_json: grid && typeof grid === "object" ? grid : null,
    activation_fee_ht: row.activation_fee_ht != null ? Number(row.activation_fee_ht) : null,
  };
}

function findSegment(tariffGrid, segmentCode) {
  const segments = tariffGrid?.segments;
  if (!Array.isArray(segments)) return null;
  return segments.find((s) => s.segmentCode === segmentCode) || null;
}

function findKvaRow(segment, kva) {
  // Nouveau format : segment.kvaRows ; legacy : segment.pricing.kvaRows
  const rows = segment?.kvaRows ?? segment?.pricing?.kvaRows;
  if (!Array.isArray(rows) || rows.length === 0) return null;
  const sorted = [...rows].sort((a, b) => (Number(b.kva) ?? 0) - (Number(a.kva) ?? 0));
  const found = sorted.find((r) => (Number(r.kva) ?? 0) <= kva);
  return found ?? sorted[sorted.length - 1];
}

const VAT_RATE = 0.2;

/**
 * Frais d'activation batterie virtuelle (TTC) depuis pv_virtual_batteries + grille org.
 * Utilisé par le pipeline CALC (payload solarnext) — pas de valeur inventée si absente.
 * @returns {Promise<number|null>} TTC ou null si rien en config
 */
export async function resolveVirtualBatteryActivationFeeTtcFromOrgDb(
  organizationId,
  providerCode,
  contractType,
  meterKva
) {
  if (!organizationId || !providerCode) return null;
  const segmentCode =
    String(contractType || "BASE").toUpperCase() === "HPHC" ? "PART_HPHC" : "PART_BASE";

  const battery = await loadVirtualBattery(organizationId, String(providerCode).toUpperCase());
  if (!battery) return null;

  let activationFeeHt = null;
  const kvaNum = Number(meterKva);
  const grid = battery.tariff_grid_json;
  if (grid?.segments && Number.isFinite(kvaNum)) {
    const segment = findSegment(grid, segmentCode);
    const kvaRow = segment ? findKvaRow(segment, kvaNum) : null;
    if (
      kvaRow &&
      isNewFormatKvaRow(kvaRow) &&
      kvaRow.activation_fee_ht != null &&
      Number(kvaRow.activation_fee_ht) > 0
    ) {
      activationFeeHt = Number(kvaRow.activation_fee_ht);
    }
  }
  if (
    activationFeeHt == null &&
    battery.activation_fee_ht != null &&
    Number(battery.activation_fee_ht) > 0
  ) {
    activationFeeHt = Number(battery.activation_fee_ht);
  }
  if (activationFeeHt == null || activationFeeHt <= 0) return null;
  return Math.round(activationFeeHt * (1 + VAT_RATE) * 100) / 100;
}

/** True si la ligne est au format plat (nouveau). */
function isNewFormatKvaRow(kvaRow) {
  return kvaRow != null && typeof kvaRow.subscription_fixed_ttc === "number";
}

/**
 * Calcule le coût annuel batterie virtuelle à partir de la grille tarifaire en base (route devis).
 * À ne pas utiliser dans le pipeline CALC — pour le CALC utiliser computeVirtualBatteryQuote avec config injectée.
 */
export async function computeVirtualBatteryQuoteFromGrid(input) {
  const {
    organizationId,
    providerCode,
    segmentCode,
    kva,
    kwcInstalled,
    kwhRestitutionAnnual,
    includeActivationFee = false,
    hpRatio = DEFAULT_HP_RATIO,
    hcRatio = DEFAULT_HC_RATIO,
  } = input;

  const assumptions = [];

  if (!organizationId || !providerCode) {
    throw new Error("organizationId et providerCode requis");
  }
  if (!SEGMENT_CODES.includes(segmentCode)) {
    throw new Error(`segmentCode invalide: ${segmentCode}. Attendu: ${SEGMENT_CODES.join(", ")}`);
  }
  const kvaNum = Number(kva);
  if (!Number.isFinite(kvaNum) || !KVA_OPTIONS.includes(kvaNum)) {
    throw new Error(`kva invalide: ${kva}. Attendu: ${KVA_OPTIONS.join(", ")}`);
  }
  const kwc = Number(kwcInstalled);
  if (!Number.isFinite(kwc) || kwc <= 0) {
    throw new Error("kwcInstalled doit être > 0");
  }
  const kwh = Number(kwhRestitutionAnnual);
  if (!Number.isFinite(kwh) || kwh < 0) {
    throw new Error("kwhRestitutionAnnual doit être >= 0");
  }

  const battery = await loadVirtualBattery(organizationId, providerCode);
  if (!battery) {
    throw new Error(`Batterie virtuelle non trouvée: ${providerCode} pour cette organisation`);
  }

  const grid = battery.tariff_grid_json;
  if (!grid || !grid.segments) {
    throw new Error("Grille tarifaire absente ou invalide pour ce fournisseur");
  }

  const segment = findSegment(grid, segmentCode);
  if (!segment) {
    throw new Error(`Segment ${segmentCode} non trouvé dans la grille`);
  }

  const kvaRow = findKvaRow(segment, kvaNum);
  if (!kvaRow) {
    throw new Error(`Pas de ligne tarifaire pour ${kvaNum} kVA dans le segment`);
  }

  const useNewFormat = isNewFormatKvaRow(kvaRow);
  let virtualSubscriptionHt;
  let fixedSubscriptionHt = null;
  let fixedSubscriptionTtc = null;
  let restitutionEnergyHt = 0;
  let restitutionNetworkFeeHt = 0;
  let activationFeeHt = 0;
  let autoproducerContributionHt = 0;

  if (useNewFormat) {
    // Format plat : champs directs sur la ligne kVA
    const eurPerKwcPerMonth = Number(kvaRow.virtual_subscription_eur_kwc_month_ht ?? 0);
    virtualSubscriptionHt = kwc * (eurPerKwcPerMonth || 1) * 12;
    if (eurPerKwcPerMonth === 0) {
      assumptions.push("Abonnement virtuel: valeur par défaut 1 €/kWc/mois HT");
      virtualSubscriptionHt = kwc * 12;
    }
    const subFixedMonthly = Number(kvaRow.subscription_fixed_ttc ?? 0);
    fixedSubscriptionTtc = subFixedMonthly * 12;
    restitutionEnergyHt = kwh * Number(kvaRow.restitution_energy_eur_kwh_ht ?? 0);
    restitutionNetworkFeeHt = kwh * Number(kvaRow.restitution_network_fee_eur_kwh_ht ?? 0);
    autoproducerContributionHt = Number(kvaRow.autoproducer_contribution_eur_year_ht ?? 0);
    if (includeActivationFee && (kvaRow.activation_fee_ht != null && Number(kvaRow.activation_fee_ht) > 0)) {
      activationFeeHt = Number(kvaRow.activation_fee_ht);
      assumptions.push(`Frais d'activation: ${activationFeeHt} € HT (une fois)`);
    }
  } else {
    // Legacy : segment.pricing + kvaRow.subscriptionFixed, virtualEnergy, etc.
    const pricing = segment.pricing || {};
    const virtualSub = pricing.virtualSubscription;
    const annualContrib = pricing.annualAutoproducerContribution;

    const eurPerKwcPerMonth = virtualSub?.unit === "EUR_PER_KWC_PER_MONTH_HT"
      ? Number(virtualSub.value)
      : 1.0;
    if (virtualSub?.value == null) {
      assumptions.push("Abonnement virtuel: valeur par défaut 1 €/kWc/mois HT");
    }
    virtualSubscriptionHt = kwc * eurPerKwcPerMonth * 12;

    const subFixed = kvaRow.subscriptionFixed;
    if (subFixed) {
      fixedSubscriptionTtc = subFixed.ttc != null ? Number(subFixed.ttc) * 12 : null;
      fixedSubscriptionHt = subFixed.ht != null ? Number(subFixed.ht) * 12 : null;
    }

    const isHphc = segmentCode === "PART_HPHC" || segmentCode === "PRO_HPHC_MU";
    const vEnergy = kvaRow.virtualEnergy || {};
    const vNetwork = kvaRow.virtualNetworkFee || {};

    if (isHphc && vEnergy.hp_htt != null && vEnergy.hc_htt != null) {
      const hp = Math.max(0, Math.min(1, Number(hpRatio) || DEFAULT_HP_RATIO));
      const hc = Math.max(0, Math.min(1, Number(hcRatio) || DEFAULT_HC_RATIO));
      const sum = hp + hc;
      const normHp = sum > 0 ? hp / sum : DEFAULT_HP_RATIO;
      const normHc = sum > 0 ? hc / sum : DEFAULT_HC_RATIO;
      restitutionEnergyHt = kwh * (normHp * Number(vEnergy.hp_htt) + normHc * Number(vEnergy.hc_htt));
      restitutionNetworkFeeHt = kwh * (normHp * Number(vNetwork.hp_htt ?? vNetwork.htt ?? 0) + normHc * Number(vNetwork.hc_htt ?? vNetwork.htt ?? 0));
      assumptions.push(`Répartition HP/HC restitution: ${Math.round(normHp * 100)}% HP, ${Math.round(normHc * 100)}% HC`);
    } else {
      const htt = vEnergy.htt != null ? Number(vEnergy.htt) : 0;
      const netHtt = vNetwork.htt != null ? Number(vNetwork.htt) : 0;
      restitutionEnergyHt = kwh * htt;
      restitutionNetworkFeeHt = kwh * netHtt;
      if (isHphc) {
        assumptions.push("Tarif base (€/kWh) appliqué au kWh restitué (HP/HC non différencié dans la grille)");
      }
    }

    if (includeActivationFee && battery.activation_fee_ht != null && battery.activation_fee_ht > 0) {
      activationFeeHt = Number(battery.activation_fee_ht);
      assumptions.push(`Frais d'activation: ${activationFeeHt} € HT (une fois)`);
    }

    if (annualContrib?.unit === "EUR_PER_YEAR_HT" && annualContrib.value != null) {
      autoproducerContributionHt = Number(annualContrib.value);
    }
  }

  let capacityCostHt = null;
  let ceeHt = null;
  let proNotes = null;
  const proComp = kvaRow.proComponents;
  const isPro = segmentCode.startsWith("PRO_");
  if (isPro && proComp && kwh > 0) {
    const capAuction = proComp.capacityAuction_eur_per_mw ?? proComp.capacityAuctionEurPerMw;
    const coefCapa = proComp.coefCapa_kw_per_mwh ?? proComp.coefCapaKwPerMwh;
    if (typeof capAuction === "number" && typeof coefCapa === "number") {
      capacityCostHt = kwh * (capAuction * coefCapa / 1000);
    } else {
      proNotes = "Champs capacityAuction/coefCapa absents de la grille";
      assumptions.push(proNotes);
    }
    if (proComp.cee_ht != null) {
      ceeHt = Number(proComp.cee_ht);
    } else if (proComp.cee_eur_per_kwh != null && kwh > 0) {
      ceeHt = kwh * Number(proComp.cee_eur_per_kwh);
    }
  }

  const pro = (capacityCostHt != null || ceeHt != null || proNotes)
    ? { capacityCostHt: capacityCostHt ?? undefined, ceeHt: ceeHt ?? undefined, notes: proNotes ?? undefined }
    : null;

  const breakdown = {
    virtualSubscriptionHt: Math.round(virtualSubscriptionHt * 100) / 100,
    fixedSubscriptionHt: fixedSubscriptionHt != null ? Math.round(fixedSubscriptionHt * 100) / 100 : null,
    fixedSubscriptionTtc: fixedSubscriptionTtc != null ? Math.round(fixedSubscriptionTtc * 100) / 100 : null,
    restitutionEnergyHt: Math.round(restitutionEnergyHt * 100) / 100,
    restitutionNetworkFeeHt: Math.round(restitutionNetworkFeeHt * 100) / 100,
    activationFeeHt: Math.round(activationFeeHt * 100) / 100,
    autoproducerContributionHt: Math.round(autoproducerContributionHt * 100) / 100,
    pro,
  };

  let annualCostHt =
    virtualSubscriptionHt +
    (fixedSubscriptionHt ?? 0) +
    restitutionEnergyHt +
    restitutionNetworkFeeHt +
    activationFeeHt +
    autoproducerContributionHt +
    (capacityCostHt ?? 0) +
    (ceeHt ?? 0);

  annualCostHt = Math.round(annualCostHt * 100) / 100;

  const tvaRate = 0.2;
  const annualCostTtc = Math.round(annualCostHt * (1 + tvaRate) * 100) / 100;

  const eligibility = segment.eligibility || null;

  return {
    providerCode,
    segmentCode,
    annualCostHt,
    annualCostTtc,
    breakdown,
    assumptions,
    eligibility,
  };
}
