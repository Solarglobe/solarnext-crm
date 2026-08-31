/**
 * Urban Solar batterie virtuelle — tarifs applicables au 1er août 2026.
 * Ne modifie pas les economic_snapshots historiques : uniquement settings org
 * globaux et table de configuration pv_virtual_batteries.
 */

import {
  URBAN_SOLAR_VIRTUAL_BATTERY_TARIFFS_2026_08_01 as URBAN,
} from "../../shared/urbanSolarVirtualBatteryTariffs2026.js";

export const shorthands = undefined;

const KVA_KEYS = ["3", "6", "9", "12", "15", "18", "24", "30", "36"];
const SEGMENT_KEYS = ["PARTICULIER_BASE", "PARTICULIER_HPHC", "PRO_BASE_CU", "PRO_HPHC_MU"];

function buildUrbanBaseRows() {
  const rowsByKva = {};
  for (const k of KVA_KEYS) {
    const kva = Number(k);
    rowsByKva[k] = {
      abonnement_per_kwc_month: URBAN.storageSubscriptionEurPerKwcMonthHt,
      abonnement_fixed_month: (URBAN.supplierSubscriptionTtcPerMonth.base[kva] ?? 0) / 1.2,
      abonnement_fixed_month_ttc: URBAN.supplierSubscriptionTtcPerMonth.base[kva] ?? 0,
      abonnement_includes_contribution: URBAN.supplierSubscriptionIncludesAutoproducerContribution,
      restitution_energy_eur_per_kwh: URBAN.restitutionTtcPerKwh.base / 1.2,
      restitution_energy_ttc_per_kwh: URBAN.restitutionTtcPerKwh.base,
      electricity_base_ttc_per_kwh: URBAN.electricityTtcPerKwh.baseByKva[kva] ?? null,
      reseau_eur_per_kwh: URBAN.restitutionTtcPerKwh.base / 1.2,
      contribution_eur_per_year: URBAN.autoproducerContributionEurPerYearHt,
      enabled: true,
    };
  }
  return { rowsByKva };
}

function buildUrbanHphcRows() {
  const rowsByKva = {};
  for (const k of KVA_KEYS) {
    const kva = Number(k);
    rowsByKva[k] = {
      abonnement_per_kwc_month: URBAN.storageSubscriptionEurPerKwcMonthHt,
      abonnement_fixed_month: (URBAN.supplierSubscriptionTtcPerMonth.hphc[kva] ?? 0) / 1.2,
      abonnement_fixed_month_ttc: URBAN.supplierSubscriptionTtcPerMonth.hphc[kva] ?? 0,
      abonnement_includes_contribution: URBAN.supplierSubscriptionIncludesAutoproducerContribution,
      restitution_hp_eur_per_kwh: URBAN.restitutionTtcPerKwh.hp / 1.2,
      restitution_hc_eur_per_kwh: URBAN.restitutionTtcPerKwh.hc / 1.2,
      restitution_hp_ttc_per_kwh: URBAN.restitutionTtcPerKwh.hp,
      restitution_hc_ttc_per_kwh: URBAN.restitutionTtcPerKwh.hc,
      electricity_hp_ttc_per_kwh: URBAN.electricityTtcPerKwh.hp,
      electricity_hc_ttc_per_kwh: URBAN.electricityTtcPerKwh.hc,
      reseau_hp_eur_per_kwh: URBAN.restitutionTtcPerKwh.hp / 1.2,
      reseau_hc_eur_per_kwh: URBAN.restitutionTtcPerKwh.hc / 1.2,
      contribution_eur_per_year: URBAN.autoproducerContributionEurPerYearHt,
      enabled: true,
    };
  }
  return { rowsByKva };
}

function buildUrbanProviderGrid() {
  const base = buildUrbanBaseRows();
  const hphc = buildUrbanHphcRows();
  const segments = {};
  for (const segment of SEGMENT_KEYS) {
    segments[segment] = segment.includes("HPHC") ? hphc : base;
  }
  return {
    label: "Urban Solar Stockage Virtuel",
    effectiveDate: URBAN.effectiveDate,
    sourceLabel: URBAN.sourceLabel,
    segments,
  };
}

/** @param {import("node-pg-migrate").MigrationBuilder} pgm */
export const up = async (pgm) => {
  const urbanProvider = buildUrbanProviderGrid();

  const { rows } = await pgm.db.query(`SELECT id, settings_json FROM organizations`);
  for (const row of rows) {
    const settings =
      row.settings_json && typeof row.settings_json === "object" && !Array.isArray(row.settings_json)
        ? { ...row.settings_json }
        : {};
    settings.pv = settings.pv && typeof settings.pv === "object" ? { ...settings.pv } : {};
    settings.pv.virtual_battery =
      settings.pv.virtual_battery && typeof settings.pv.virtual_battery === "object"
        ? { ...settings.pv.virtual_battery }
        : {};
    settings.pv.virtual_battery.providers =
      settings.pv.virtual_battery.providers && typeof settings.pv.virtual_battery.providers === "object"
        ? { ...settings.pv.virtual_battery.providers }
        : {};
    settings.pv.virtual_battery.providers.URBAN_SOLAR = urbanProvider;

    await pgm.db.query(`UPDATE organizations SET settings_json = $1::jsonb WHERE id = $2`, [
      JSON.stringify(settings),
      row.id,
    ]);
  }

  await pgm.db.query(
    `UPDATE pv_virtual_batteries
       SET monthly_subscription_ht = $1,
           cost_per_kwh_ht = $2,
           activation_fee_ht = 0,
           contribution_autoproducteur_ht = $3,
           includes_network_fees = true,
           tariff_grid_json = $4::jsonb,
           tariff_source_label = $5,
           tariff_effective_date = $6::date,
           updated_at = NOW()
     WHERE provider_code = 'URBAN_SOLAR'`,
    [
      URBAN.storageSubscriptionEurPerKwcMonthHt,
      URBAN.restitutionTtcPerKwh.base / 1.2,
      URBAN.autoproducerContributionEurPerYearHt,
      JSON.stringify({ provider: "URBAN_SOLAR", ...urbanProvider }),
      URBAN.sourceLabel,
      URBAN.effectiveDate,
    ]
  );
};

export const down = () => {};

