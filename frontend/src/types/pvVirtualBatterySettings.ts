/**
 * Structure normalisée pv.virtual_battery (org settings).
 * Tous les montants en HT. Segments : BASE (1 prix) ou HP/HC (HP + HC).
 */

export const SEGMENT_KEYS = ["PARTICULIER_BASE", "PARTICULIER_HPHC", "PRO_BASE_CU", "PRO_HPHC_MU"] as const;
export type SegmentKey = (typeof SEGMENT_KEYS)[number];

export const KVA_KEYS = ["3", "6", "9", "12", "15", "18", "24", "30", "36"] as const;
export type KvaKey = (typeof KVA_KEYS)[number];

/** Une ligne tarifaire par kVA. BASE : champs simples ; HP/HC : _hp / _hc. */
export interface VirtualBatteryRow {
  abonnement_per_kwc_month: number;
  abonnement_fixed_month: number;
  /** BASE uniquement */
  restitution_energy_eur_per_kwh?: number;
  /** BASE uniquement */
  reseau_eur_per_kwh?: number;
  /** HP/HC */
  restitution_hp_eur_per_kwh?: number;
  restitution_hc_eur_per_kwh?: number;
  reseau_hp_eur_per_kwh?: number;
  reseau_hc_eur_per_kwh?: number;
  contribution_eur_per_year: number;
  enabled: boolean;
}

export interface SegmentRows {
  rowsByKva: Record<string, VirtualBatteryRow>;
}

export interface CapacityTier {
  kwh: number;
  abonnement_month_ht: number;
}

export interface ContributionRule {
  type: "linear";
  a: number;
  b: number;
}

export interface ProviderSegmentConfig {
  label: string;
  segments: Record<SegmentKey, SegmentRows>;
}

export interface MySmartBatteryConfig extends ProviderSegmentConfig {
  capacityTiers: CapacityTier[];
  contributionRule: ContributionRule;
}

export type ProviderConfig = ProviderSegmentConfig | MySmartBatteryConfig;

export function isMySmartBatteryConfig(p: ProviderConfig): p is MySmartBatteryConfig {
  return "capacityTiers" in p && Array.isArray((p as MySmartBatteryConfig).capacityTiers);
}

export interface PvVirtualBatterySettings {
  providers: Record<string, ProviderConfig>;
}

/** Config batterie virtuelle (devis technique) — stockée dans economic_snapshots.config_json.virtualBattery */
export type VirtualBatteryProviderCode =
  | "MYLIGHT_MYBATTERY"
  | "MYLIGHT_MYSMARTBATTERY"
  | "URBAN_SOLAR";

export type VirtualBatteryContractType = "BASE" | "HPHC";

export interface VirtualBatteryConfig {
  provider: VirtualBatteryProviderCode;
  contractType: VirtualBatteryContractType;
  /** Obligatoire pour MYLIGHT_MYSMARTBATTERY (capacité en kWh) */
  capacityKwh?: number;
}

export const SEGMENT_LABELS: Record<SegmentKey, string> = {
  PARTICULIER_BASE: "Particulier Base",
  PARTICULIER_HPHC: "Particulier HP/HC",
  PRO_BASE_CU: "Pro Base (CU)",
  PRO_HPHC_MU: "Pro HP/HC (MU)",
};

/** Crée une ligne vide. */
export function createEmptyRow(): VirtualBatteryRow {
  return {
    abonnement_per_kwc_month: 0,
    abonnement_fixed_month: 0,
    contribution_eur_per_year: 0,
    enabled: true,
  };
}

/** Crée rowsByKva pour les 9 kVA. */
export function createEmptySegmentRows(): SegmentRows {
  const rowsByKva: Record<string, VirtualBatteryRow> = {};
  for (const k of KVA_KEYS) {
    rowsByKva[k] = createEmptyRow();
  }
  return { rowsByKva };
}

/** Crée les 4 segments vides pour un provider standard. */
export function createEmptySegments(): Record<SegmentKey, SegmentRows> {
  const out = {} as Record<SegmentKey, SegmentRows>;
  for (const s of SEGMENT_KEYS) {
    out[s] = createEmptySegmentRows();
  }
  return out;
}
