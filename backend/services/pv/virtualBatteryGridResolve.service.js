/**
 * Résolution tarifaire BV depuis settings_json.pv.virtual_battery (même logique que le frontend virtualBatteryPricing).
 * Aucune migration — lecture JSON org uniquement.
 */

import { vbLegacyMySmartAnnualContributionHt } from "./virtualBatteryLegacyDefaults.js";

const KVA_VALUES = [3, 6, 9, 12, 15, 18, 24, 30, 36];

/**
 * Grille org « exploitable » : au moins un fournisseur objet non nul.
 * `providers: {}` ou absent → false (fallback legacy / snapshot, pas d’état ambigu).
 */
export function vbHasExploitableProviderGrid(virtualBatterySettings) {
  if (!virtualBatterySettings || typeof virtualBatterySettings !== "object") return false;
  const p = virtualBatterySettings.providers;
  if (!p || typeof p !== "object" || Array.isArray(p)) return false;
  const keys = Object.keys(p);
  if (keys.length === 0) return false;
  return keys.some((k) => p[k] != null && typeof p[k] === "object" && !Array.isArray(p[k]));
}

export function vbKvaToKey(meterKva) {
  const n = Math.max(3, Math.min(36, Math.round(Number(meterKva) || 0)));
  return String(KVA_VALUES.reduce((prev, curr) => (Math.abs(curr - n) < Math.abs(prev - n) ? curr : prev)));
}

export function vbContractToSegmentKey(contractType) {
  return contractType === "HPHC" ? "PARTICULIER_HPHC" : "PARTICULIER_BASE";
}

/**
 * @param {object|null|undefined} grids — { providers: Record<string, object> }
 * @param {{ provider: string, contractType: string, meterPowerKva: number, pvPowerKwc: number, capacityKwh?: number }} opts
 * @returns {number} mensuel HT total, ou 0 si invalide
 */
export function resolveVirtualBatteryMonthlyFromGrid(grids, { provider, contractType, meterPowerKva, pvPowerKwc, capacityKwh }) {
  if (!vbHasExploitableProviderGrid(grids)) return 0;
  const providers = grids.providers;
  const providerConfig = providers[provider];
  if (!providerConfig) return 0;
  const segmentKey = vbContractToSegmentKey(contractType);
  const kvaKey = vbKvaToKey(meterPowerKva);

  if (provider === "MYLIGHT_MYSMARTBATTERY") {
    const cap =
      capacityKwh != null && Number.isFinite(Number(capacityKwh)) ? Number(capacityKwh) : 0;
    const tiers = Array.isArray(providerConfig.capacityTiers) ? providerConfig.capacityTiers : [];
    const cr = providerConfig.contributionRule;
    const contribYearly =
      cr && typeof cr === "object" && Number.isFinite(Number(cr.a))
        ? Number(cr.a) * Number(meterPowerKva) + Number(cr.b ?? 0)
        : vbLegacyMySmartAnnualContributionHt(meterPowerKva);
    const contributionMonthly = contribYearly / 12;
    if (tiers.length > 0) {
      const sorted = [...tiers].sort((a, b) => a.kwh - b.kwh);
      const tier =
        sorted.find((t) => t.kwh >= cap) ?? sorted[sorted.length - 1] ?? { abonnement_month_ht: 0 };
      return (Number(tier.abonnement_month_ht) || 0) + contributionMonthly;
    }
    return contributionMonthly;
  }

  const segments = providerConfig.segments ?? {};
  const segment = segments[segmentKey];
  const rowsByKva = segment?.rowsByKva ?? {};
  const row = vbPickRowByKvaKey(rowsByKva, kvaKey);
  if (!row || !row.enabled) return 0;
  const aboStockage = (Number(row.abonnement_per_kwc_month) || 0) * (Number(pvPowerKwc) || 0);
  const aboFixe = Number(row.abonnement_fixed_month) || 0;
  const contribution = (Number(row.contribution_eur_per_year) || 0) / 12;
  return aboStockage + aboFixe + contribution;
}

/**
 * @returns {{ ok: boolean, selected_capacity_kwh?: number, monthly_subscription_ht?: number, reason?: string, max_tier_kwh?: number }}
 */
export function vbSelectMySmartTierFromGrid(providerConfig, requiredKwh) {
  const tiers = providerConfig?.capacityTiers;
  if (!Array.isArray(tiers) || tiers.length === 0) {
    return { ok: false, reason: "NO_CAPACITY_TIERS" };
  }
  const req = Number(requiredKwh);
  if (!Number.isFinite(req) || req < 0) {
    return { ok: false, reason: "INVALID_REQUIRED_CAPACITY" };
  }
  const sorted = [...tiers].sort((a, b) => a.kwh - b.kwh);
  const last = sorted[sorted.length - 1];
  if (req > last.kwh) {
    return {
      ok: false,
      reason: "MISSING_PROVIDER_TIER_FOR_REQUIRED_CAPACITY",
      required_kwh: req,
      max_tier_kwh: last.kwh,
    };
  }
  const tier = sorted.find((t) => t.kwh >= req) ?? last;
  return {
    ok: true,
    selected_capacity_kwh: tier.kwh,
    monthly_subscription_ht: Number(tier.abonnement_month_ht) || 0,
  };
}

/** Résout une ligne rowsByKva même si clé stockée différemment (ex. "9" vs 9). */
export function vbPickRowByKvaKey(rowsByKva, kvaKey) {
  if (!rowsByKva || typeof rowsByKva !== "object") return null;
  const k = String(kvaKey);
  if (Object.prototype.hasOwnProperty.call(rowsByKva, k)) return rowsByKva[k];
  const n = Number(kvaKey);
  if (!Number.isFinite(n)) return null;
  for (const key of Object.keys(rowsByKva)) {
    if (String(key) === k || Number(key) === n) return rowsByKva[key];
  }
  return null;
}

export function vbGetSegmentRow(grids, providerCode, contractType, meterKva) {
  if (!vbHasExploitableProviderGrid(grids)) return null;
  const pc = grids.providers[providerCode];
  if (!pc || typeof pc !== "object") return null;
  const seg = vbContractToSegmentKey(contractType);
  const k = vbKvaToKey(meterKva);
  const raw = pc.segments?.[seg]?.rowsByKva;
  return vbPickRowByKvaKey(raw, k);
}

/** BASE : somme €/kWh restitution + réseau depuis la ligne grille (aligné extractRestitutionReseauFromRow front). */
export function vbBaseDischargeRatePerKwhFromRow(row) {
  if (!row || typeof row !== "object") return null;
  let r = row.restitution_energy_eur_per_kwh;
  let n = row.reseau_eur_per_kwh;
  if (
    (r == null || !Number.isFinite(Number(r))) &&
    row.restitution_hp_eur_per_kwh != null &&
    row.restitution_hc_eur_per_kwh != null
  ) {
    r = (Number(row.restitution_hp_eur_per_kwh) + Number(row.restitution_hc_eur_per_kwh)) / 2;
  }
  if (
    (n == null || !Number.isFinite(Number(n))) &&
    row.reseau_hp_eur_per_kwh != null &&
    row.reseau_hc_eur_per_kwh != null
  ) {
    n = (Number(row.reseau_hp_eur_per_kwh) + Number(row.reseau_hc_eur_per_kwh)) / 2;
  }
  if (r != null && n != null && Number.isFinite(Number(r)) && Number.isFinite(Number(n))) {
    return Number(r) + Number(n);
  }
  return null;
}

/** HPHC : retourne { hp, hc } sommes (restitution + réseau) par kWh si disponibles. */
export function vbHphcDischargeRatesFromRow(row) {
  if (!row || typeof row !== "object") return null;
  const rhp = row.restitution_hp_eur_per_kwh;
  const rhc = row.restitution_hc_eur_per_kwh;
  const nhp = row.reseau_hp_eur_per_kwh;
  const nhc = row.reseau_hc_eur_per_kwh;
  if (
    [rhp, rhc, nhp, nhc].every((v) => v != null && Number.isFinite(Number(v)))
  ) {
    return {
      hp: Number(rhp) + Number(nhp),
      hc: Number(rhc) + Number(nhc),
    };
  }
  return null;
}
