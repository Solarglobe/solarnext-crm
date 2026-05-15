/**
 * Résolveur tarifaire batterie virtuelle — grilles Paramètres PV (organizations.settings_json.pv.virtual_battery).
 * Calcule abonnement mensuel à partir de : fournisseur, type de contrat, kVA, kWc, capacité (SmartBattery).
 */

import type {
  PvVirtualBatterySettings,
  VirtualBatteryConfig,
  VirtualBatteryRow,
  SegmentKey,
} from "../types/pvVirtualBatterySettings";
import { isMySmartBatteryConfig } from "../types/pvVirtualBatterySettings";
import {
  getVirtualBatteryTariffs2026,
  DEFAULT_VB_MYLIGHT_MYBATT_RESEAU_HT,
  DEFAULT_VB_MYLIGHT_MYBATT_RESTITUTION_HT,
} from "../data/virtualBatteryTariffs2026";
import { vbLegacyMySmartAnnualContributionHt } from "../constants/virtualBatteryLegacyDefaults";

const KVA_VALUES = [3, 6, 9, 12, 15, 18, 24, 30, 36];

/** Même règle que backend vbHasExploitableProviderGrid (providers non vide + au moins un objet fournisseur). */
export function hasExploitableOrgVirtualBatteryProviders(
  settings: PvVirtualBatterySettings | null | undefined
): boolean {
  const p = settings?.providers;
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const keys = Object.keys(p);
  if (keys.length === 0) return false;
  return keys.some((k) => {
    const v = (p as Record<string, unknown>)[k];
    return v != null && typeof v === "object" && !Array.isArray(v);
  });
}

function segmentFromContractType(contractType: "BASE" | "HPHC"): SegmentKey {
  return contractType === "BASE" ? "PARTICULIER_BASE" : "PARTICULIER_HPHC";
}

function extractRestitutionReseauFromRow(row: VirtualBatteryRow | null | undefined): {
  restitutionPrice: number;
  reseauPrice: number;
} {
  if (!row) {
    return {
      restitutionPrice: DEFAULT_VB_MYLIGHT_MYBATT_RESTITUTION_HT,
      reseauPrice: DEFAULT_VB_MYLIGHT_MYBATT_RESEAU_HT,
    };
  }
  const restitutionPrice =
    row.restitution_energy_eur_per_kwh ??
    (row.restitution_hp_eur_per_kwh != null && row.restitution_hc_eur_per_kwh != null
      ? (Number(row.restitution_hp_eur_per_kwh) + Number(row.restitution_hc_eur_per_kwh)) / 2
      : null);
  const reseauPrice =
    row.reseau_eur_per_kwh ??
    (row.reseau_hp_eur_per_kwh != null && row.reseau_hc_eur_per_kwh != null
      ? (Number(row.reseau_hp_eur_per_kwh) + Number(row.reseau_hc_eur_per_kwh)) / 2
      : null);
  const r = restitutionPrice != null && Number.isFinite(Number(restitutionPrice)) ? Number(restitutionPrice) : null;
  const n = reseauPrice != null && Number.isFinite(Number(reseauPrice)) ? Number(reseauPrice) : null;
  return {
    restitutionPrice: r ?? DEFAULT_VB_MYLIGHT_MYBATT_RESTITUTION_HT,
    reseauPrice: n ?? DEFAULT_VB_MYLIGHT_MYBATT_RESEAU_HT,
  };
}

function kvaToKey(kva: number): string {
  const n = Math.max(3, Math.min(36, Math.round(kva)));
  const nearest = KVA_VALUES.reduce((prev, curr) =>
    Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev
  );
  return String(nearest);
}

export interface ResolveVirtualBatteryPricingParams {
  provider: VirtualBatteryConfig["provider"];
  contractType: VirtualBatteryConfig["contractType"];
  meterPowerKva: number;
  pvPowerKwc: number;
  capacityKwh?: number;
}

export interface VirtualBatteryPricingResult {
  aboStockageMonthly: number;
  aboFournisseurMonthly: number;
  contributionMonthly: number;
  restitutionPrice: number;
  reseauPrice: number;
  totalMonthly: number;
}

/**
 * Résout le tarif mensuel HT à partir des grilles org (ou défaut 2026).
 */
export function resolveVirtualBatteryPricing(
  settings: PvVirtualBatterySettings | null | undefined,
  params: ResolveVirtualBatteryPricingParams
): VirtualBatteryPricingResult | null {
  const { provider, contractType, meterPowerKva, pvPowerKwc, capacityKwh } = params;
  const hasOrgVirtualBattery = hasExploitableOrgVirtualBatteryProviders(settings);
  const grids = hasOrgVirtualBattery ? settings!.providers : getVirtualBatteryTariffs2026().providers;
  const providerConfig = grids[provider];
  if (!providerConfig) return null;

  const kvaKey = kvaToKey(meterPowerKva);
  const segmentKey = segmentFromContractType(contractType);

  if (provider === "MYLIGHT_MYSMARTBATTERY" && isMySmartBatteryConfig(providerConfig)) {
    const capacity = capacityKwh ?? 0;
    const tiers = providerConfig.capacityTiers ?? [];
    const sorted = [...tiers].sort((a, b) => a.kwh - b.kwh);
    let tier = sorted.find((t) => t.kwh >= capacity) ?? sorted[sorted.length - 1];
    if (!tier && sorted.length > 0) tier = sorted[0];
    const aboStockageMonthly = tier ? tier.abonnement_month_ht : 0;
    const rule = providerConfig.contributionRule;
    const useLegacyContribution =
      !hasOrgVirtualBattery || !rule || !Number.isFinite(Number(rule.a));
    const contributionYearly = useLegacyContribution
      ? vbLegacyMySmartAnnualContributionHt(meterPowerKva)
      : Number(rule.a) * meterPowerKva + Number(rule.b ?? 0);
    const contributionMonthly = contributionYearly / 12;
    const totalMonthly = aboStockageMonthly + contributionMonthly;
    const smartRow = providerConfig.segments?.[segmentKey]?.rowsByKva?.[kvaKey];
    const { restitutionPrice, reseauPrice } = extractRestitutionReseauFromRow(smartRow);
    return {
      aboStockageMonthly,
      aboFournisseurMonthly: 0,
      contributionMonthly,
      restitutionPrice,
      reseauPrice,
      totalMonthly,
    };
  }

  const segments = providerConfig.segments ?? {};
  const segment = segments[segmentKey];
  const rowsByKva = segment?.rowsByKva ?? {};
  const row: VirtualBatteryRow | undefined = rowsByKva[kvaKey];
  if (!row || !row.enabled) return null;

  const aboStockageMonthly = (row.abonnement_per_kwc_month ?? 0) * pvPowerKwc;
  const aboFournisseurMonthly = row.abonnement_fixed_month ?? 0;
  const contributionMonthly = (row.contribution_eur_per_year ?? 0) / 12;
  const totalMonthly = aboStockageMonthly + aboFournisseurMonthly + contributionMonthly;

  const { restitutionPrice, reseauPrice } = extractRestitutionReseauFromRow(row);

  return {
    aboStockageMonthly,
    aboFournisseurMonthly,
    contributionMonthly,
    restitutionPrice,
    reseauPrice,
    totalMonthly,
  };
}
