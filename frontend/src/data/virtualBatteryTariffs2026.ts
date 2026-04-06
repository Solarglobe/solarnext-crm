/**
 * Tarifs batterie virtuelle 2026 — valeurs par défaut (PDFs MyLight, Urban Solar).
 * Tous les montants HT.
 */

import type { PvVirtualBatterySettings, VirtualBatteryRow, CapacityTier } from "../types/pvVirtualBatterySettings";
import { KVA_KEYS, SEGMENT_KEYS, createEmptyRow, createEmptySegmentRows, createEmptySegments } from "../types/pvVirtualBatterySettings";

// ——— MyLight Offre électricité (mylight150) — BASE HT
const MYLIGHT_BASE_ABO: Record<string, number> = {
  "3": 9.16, "6": 11.76, "9": 14.46, "12": 16.24, "15": 17.62, "18": 20.6, "24": 24.51, "30": 28.41, "36": 32.31,
};
const MYLIGHT_BASE_ENERGY_LOW = 0.1308;  // 3-15 kVA
const MYLIGHT_BASE_ENERGY_HIGH = 0.1297; // 18-36 kVA

// ——— MyLight Offre électricité — HP/HC HT
const MYLIGHT_HPHC_ABO: Record<string, number> = {
  "3": 9.83, "6": 12.6, "9": 15.46, "12": 17.34, "15": 18.79, "18": 21.93, "24": 26.05, "30": 30.15, "36": 34.25,
};
const MYLIGHT_HPHC_ENERGY_HP = 0.1606;
const MYLIGHT_HPHC_ENERGY_HC = 0.0856;

// ——— MyLight MyBattery (stockage virtuel) — constantes
const MYBATTERY_ABO_KWC = 1.0;
export const DEFAULT_VB_MYLIGHT_MYBATT_RESEAU_HT = 0.0484;
export const DEFAULT_VB_MYLIGHT_MYBATT_RESTITUTION_HT = 0.07925;
const MYBATTERY_RESEAU = DEFAULT_VB_MYLIGHT_MYBATT_RESEAU_HT;
const MYBATTERY_RESTITUTION = DEFAULT_VB_MYLIGHT_MYBATT_RESTITUTION_HT;
const MYBATTERY_CONTRIBUTION = 3.96;

// ——— MyLight MySmartBattery — capacity tiers (kWh → €/mois HT)
export const MYSMARTBATTERY_CAPACITY_TIERS_2026: CapacityTier[] = [
  { kwh: 20, abonnement_month_ht: 10.83 },
  { kwh: 100, abonnement_month_ht: 14.16 },
  { kwh: 300, abonnement_month_ht: 22.49 },
  { kwh: 600, abonnement_month_ht: 29.16 },
  { kwh: 900, abonnement_month_ht: 33.33 },
  { kwh: 1200, abonnement_month_ht: 37.49 },
  { kwh: 1800, abonnement_month_ht: 47.49 },
  { kwh: 3000, abonnement_month_ht: 75.83 },
  { kwh: 5000, abonnement_month_ht: 112.49 },
  { kwh: 10000, abonnement_month_ht: 179.16 },
];

// ——— Urban Solar BASE HT
const URBAN_BASE_ABO: Record<string, number> = {
  "3": 9.96, "6": 11.4, "9": 12.9, "12": 14.4, "15": 15.9, "18": 17.4, "24": 20.4, "30": 23.4, "36": 26.4,
};
const URBAN_BASE_ENERGY_LOW = 0.1308;  // 3-9 kVA
const URBAN_BASE_ENERGY_HIGH = 0.1297; // 12-36 kVA
const URBAN_BASE_RESEAU = 0.0484;
const URBAN_BASE_ABO_KWC = 1.0;
const URBAN_BASE_CONTRIBUTION = 9.6;

// ——— Urban Solar HP/HC HT
const URBAN_HPHC_ABO: Record<string, number> = {
  "3": 11.8, "6": 13.5, "9": 15.2, "12": 16.9, "15": 18.2, "18": 21.2, "24": 25.2, "30": 29.2, "36": 33.2,
};
const URBAN_HPHC_ENERGY_HP = 0.1412;
const URBAN_HPHC_ENERGY_HC = 0.1007;
const URBAN_HPHC_RESEAU_HP = 0.0494;
const URBAN_HPHC_RESEAU_HC = 0.035;

function buildMyBatterySegmentBase(): Record<string, VirtualBatteryRow> {
  const rowsByKva: Record<string, VirtualBatteryRow> = {};
  for (const k of KVA_KEYS) {
    rowsByKva[k] = {
      abonnement_per_kwc_month: MYBATTERY_ABO_KWC,
      abonnement_fixed_month: MYLIGHT_BASE_ABO[k] ?? 0,
      restitution_energy_eur_per_kwh: MYBATTERY_RESTITUTION,
      reseau_eur_per_kwh: MYBATTERY_RESEAU,
      contribution_eur_per_year: MYBATTERY_CONTRIBUTION,
      enabled: true,
    };
  }
  return rowsByKva;
}

function buildMyBatterySegmentHphc(): Record<string, VirtualBatteryRow> {
  const rowsByKva: Record<string, VirtualBatteryRow> = {};
  for (const k of KVA_KEYS) {
    rowsByKva[k] = {
      abonnement_per_kwc_month: MYBATTERY_ABO_KWC,
      abonnement_fixed_month: MYLIGHT_HPHC_ABO[k] ?? 0,
      restitution_hp_eur_per_kwh: MYLIGHT_HPHC_ENERGY_HP,
      restitution_hc_eur_per_kwh: MYLIGHT_HPHC_ENERGY_HC,
      reseau_hp_eur_per_kwh: MYBATTERY_RESEAU,
      reseau_hc_eur_per_kwh: MYBATTERY_RESEAU,
      contribution_eur_per_year: MYBATTERY_CONTRIBUTION,
      enabled: true,
    };
  }
  return rowsByKva;
}

function buildUrbanSegmentBase(): Record<string, VirtualBatteryRow> {
  const rowsByKva: Record<string, VirtualBatteryRow> = {};
  for (const k of KVA_KEYS) {
    const energy = ["3", "6", "9"].includes(k) ? URBAN_BASE_ENERGY_LOW : URBAN_BASE_ENERGY_HIGH;
    rowsByKva[k] = {
      abonnement_per_kwc_month: URBAN_BASE_ABO_KWC,
      abonnement_fixed_month: URBAN_BASE_ABO[k] ?? 0,
      restitution_energy_eur_per_kwh: energy,
      reseau_eur_per_kwh: URBAN_BASE_RESEAU,
      contribution_eur_per_year: URBAN_BASE_CONTRIBUTION,
      enabled: true,
    };
  }
  return rowsByKva;
}

function buildUrbanSegmentHphc(): Record<string, VirtualBatteryRow> {
  const rowsByKva: Record<string, VirtualBatteryRow> = {};
  for (const k of KVA_KEYS) {
    rowsByKva[k] = {
      abonnement_per_kwc_month: URBAN_BASE_ABO_KWC,
      abonnement_fixed_month: URBAN_HPHC_ABO[k] ?? 0,
      restitution_hp_eur_per_kwh: URBAN_HPHC_ENERGY_HP,
      restitution_hc_eur_per_kwh: URBAN_HPHC_ENERGY_HC,
      reseau_hp_eur_per_kwh: URBAN_HPHC_RESEAU_HP,
      reseau_hc_eur_per_kwh: URBAN_HPHC_RESEAU_HC,
      contribution_eur_per_year: URBAN_BASE_CONTRIBUTION,
      enabled: true,
    };
  }
  return rowsByKva;
}

function buildMySmartBatterySegmentRows(): Record<string, VirtualBatteryRow> {
  const rowsByKva: Record<string, VirtualBatteryRow> = {};
  for (const k of KVA_KEYS) {
    const kva = Number(k);
    rowsByKva[k] = {
      abonnement_per_kwc_month: 0,
      abonnement_fixed_month: 0,
      restitution_energy_eur_per_kwh: MYBATTERY_RESTITUTION,
      reseau_eur_per_kwh: MYBATTERY_RESEAU,
      contribution_eur_per_year: parseFloat((3.96 * kva).toFixed(4)),
      enabled: true,
    };
  }
  return rowsByKva;
}

/** Grille complète 2026 par défaut. */
export function getVirtualBatteryTariffs2026(): PvVirtualBatterySettings {
  const segmentsBase = createEmptySegments();
  segmentsBase.PARTICULIER_BASE = { rowsByKva: buildMyBatterySegmentBase() };
  segmentsBase.PARTICULIER_HPHC = { rowsByKva: buildMyBatterySegmentHphc() };
  segmentsBase.PRO_BASE_CU = { rowsByKva: buildMyBatterySegmentBase() };
  segmentsBase.PRO_HPHC_MU = { rowsByKva: buildMyBatterySegmentHphc() };

  const segmentsUrban = createEmptySegments();
  segmentsUrban.PARTICULIER_BASE = { rowsByKva: buildUrbanSegmentBase() };
  segmentsUrban.PARTICULIER_HPHC = { rowsByKva: buildUrbanSegmentHphc() };
  segmentsUrban.PRO_BASE_CU = { rowsByKva: buildUrbanSegmentBase() };
  segmentsUrban.PRO_HPHC_MU = { rowsByKva: buildUrbanSegmentHphc() };

  const segmentsMySmart = createEmptySegments();
  const smartRows = buildMySmartBatterySegmentRows();
  for (const s of SEGMENT_KEYS) {
    segmentsMySmart[s] = { rowsByKva: JSON.parse(JSON.stringify(smartRows)) };
  }

  return {
    providers: {
      MYLIGHT_MYBATTERY: {
        label: "MyLight MyBattery",
        segments: segmentsBase,
      },
      MYLIGHT_MYSMARTBATTERY: {
        label: "MyLight MySmartBattery",
        segments: segmentsMySmart,
        capacityTiers: MYSMARTBATTERY_CAPACITY_TIERS_2026.map((t) => ({ ...t })),
        contributionRule: { type: "linear", a: 3.96, b: 0 },
      },
      URBAN_SOLAR: {
        label: "Urban Solar Stockage Virtuel",
        segments: segmentsUrban,
      },
    },
  };
}
