/**
 * Constantes moteur SolarNext — centralisées (hors CRM).
 * Toute modification doit rester alignée avec le comportement historique du moteur.
 */

// =============================================================================
// Pertes AC résidentiel (factor AC hors température / IAM PVGIS)
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans _computeFactorAC, computeProductionMonthly, computeProductionMonthlyForOrientation (via pvgisService.js)
// =============================================================================
export const L_CABLE = 0.015;
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans _computeFactorAC (pvgisService.js)
export const L_SOIL = 0.025;
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans _computeFactorAC (pvgisService.js)
export const L_MISMATCH = 0.01;
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans _computeFactorAC (pvgisService.js)
export const L_AVAIL = 0.005;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans _computeFactorAC (pvgisService.js) — rendement onduleur si fiche absente ou η ≤ 50 %
export const DEFAULT_INVERTER_EFFICIENCY = 0.965;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé hors moteur calc (ex. calpinage.controller) — le calcul principal exige un panneau catalogue (voir resolvePanelPowerWc / resolveKwcMono)
export const DEFAULT_PANEL_POWER_WC = 485;

// =============================================================================
// Fallback PVGIS — profil DC national (1 kWp) puis zones FR
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans fallbackPV, getFallbackAnnualDcKwhPerKwp (pvgisService.js)
// =============================================================================
export const FALLBACK_NATIONAL_MONTHLY_DC = [52, 67, 93, 115, 135, 145, 150, 145, 120, 88, 60, 48];
export const FALLBACK_NATIONAL_ANNUAL_DC_REF = FALLBACK_NATIONAL_MONTHLY_DC.reduce((a, b) => a + b, 0);

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans getFallbackAnnualDcKwhPerKwp (pvgisService.js)
export const PVGIS_FALLBACK_LAT_MIN = 41;
export const PVGIS_FALLBACK_LAT_MAX = 51.5;
export const PVGIS_FALLBACK_LON_DEFAULT = 2.5;
export const PVGIS_FALLBACK_LON_MIN = -5.5;
export const PVGIS_FALLBACK_LON_MAX = 10.5;
/** Corse / zone sud-est (lat/lon boîte) */
export const PVGIS_FALLBACK_DC_KWH_KWP_ZONE_A = 1340;
export const PVGIS_FALLBACK_DC_KWH_KWP_NORTH = 1020;
export const PVGIS_FALLBACK_DC_KWH_KWP_NORTH_MID = 1080;
export const PVGIS_FALLBACK_DC_KWH_KWP_CENTER = 1180;
export const PVGIS_FALLBACK_DC_KWH_KWP_SW = 1200;
export const PVGIS_FALLBACK_DC_KWH_KWP_SE = 1280;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans computeProductionMonthly, computeProductionMonthlyForOrientation (pvgisService.js)
export const PVGIS_FETCH_TIMEOUT_MS = 8000;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans computeProductionMonthlyForOrientation (pvgisService.js) — inclinaison si non fournie
export const PVGIS_DEFAULT_TILT_DEG = 30;

// =============================================================================
// Modèle solaire horaire (solarModelService.js)
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans buildHourlyPV / distributeMonthToHourly
// =============================================================================
export const SOLAR_MODEL_DAYS_IN_MONTH = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans buildDailyFactors (solarModelService.js) — σ log journalier
export const SOLAR_MODEL_DAILY_SIGMA = 0.4;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans fnv1aSeed (solarModelService.js)
export const SOLAR_MODEL_FNV_OFFSET_BASIS = 2166136261;
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans fnv1aSeed (solarModelService.js)
export const SOLAR_MODEL_FNV_PRIME = 16777619;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans mulberry32 (solarModelService.js)
export const SOLAR_MODEL_MULBERRY_ADD = 0x6d2b79f5;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans buildDailyFactors (solarModelService.js) — sel fixe graine journalière
export const SOLAR_MODEL_DAILY_SEED_SALT = 9371;
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans buildDailyShape (solarModelService.js)
export const SOLAR_MODEL_SHAPE_SEED_SALT = 4217;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans buildDailyFactors — coordonnées par défaut si site absent (solarModelService.js)
export const SOLAR_MODEL_DEFAULT_LAT = 48.8;
export const SOLAR_MODEL_DEFAULT_LON = 2.35;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans buildDailyShape — bruit de forme horaire ±8 % (solarModelService.js)
export const SOLAR_MODEL_HOURLY_SHAPE_NOISE = 0.16;
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans buildDailyShape (solarModelService.js)
export const SOLAR_MODEL_SHAPE_MORNING_POW = 1.8;
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans buildDailyShape (solarModelService.js)
export const SOLAR_MODEL_SHAPE_EVENING_POW = 3.2;

/** Heures lever/coucher approximatifs par mois — utilisé dans buildDailyShape (solarModelService.js) */
export const SOLAR_MODEL_SUN_TIMES = [
  { rise: 8, set: 17 },
  { rise: 7.5, set: 18 },
  { rise: 7, set: 19 },
  { rise: 6.5, set: 20 },
  { rise: 6, set: 21 },
  { rise: 6, set: 22 },
  { rise: 6.5, set: 21.5 },
  { rise: 7, set: 20.5 },
  { rise: 7.5, set: 19 },
  { rise: 8, set: 18 },
  { rise: 8.5, set: 17 },
  { rise: 9, set: 17 },
];

// =============================================================================
// Scénarios énergie (scenarioService.js)
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans simulateDirect8760, simulateEnergyAnnual
// =============================================================================
export const SCENARIO_HOURS_PER_YEAR = 8760;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans simulateEnergyAnnual — bonus auto max +10 % en fallback mensuel avec batterie
export const SCENARIO_MONTHLY_BATTERY_AUTO_BOOST = 1.1;

// =============================================================================
// Impact environnemental (impactService.js) — facteurs pédagogiques ADEME / équivalents
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans computeImpact
// =============================================================================
export const IMPACT_FACTOR_CO2_AUTO_KG_PER_KWH = 0.081;
export const IMPACT_FACTOR_CO2_SURPLUS_KG_PER_KWH = 0.048;
export const IMPACT_TREE_CO2_KG_PER_YEAR = 25;
export const IMPACT_CAR_CO2_KG_PER_KM = 0.192;
export const IMPACT_SMARTPHONE_KWH_PER_CHARGE = 0.0035;
export const IMPACT_FOYER_CO2_KG_PER_YEAR = 950;
/** Distance de référence Paris–Marseille (km) pour équivalence trajets (impactService.js) */
export const IMPACT_PARIS_MARSEILLE_KM_REF = 775;

// =============================================================================
// Batterie virtuelle — legacy tarifs (virtualBatteryLegacyDefaults + P2)
// Alignement frontend : frontend/src/constants/virtualBatteryLegacyDefaults.ts
// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// =============================================================================
export const VB_LEGACY_MYSMART_CONTRIBUTION_FIXED_EUR_PER_YEAR_HT = 9.6;
export const VB_LEGACY_MYSMART_CONTRIBUTION_PER_KVA_EUR_PER_YEAR_HT = 2.38;
export const VB_LEGACY_DEFAULT_AUTOPROD_CONTRIBUTION_EUR_PER_YEAR_HT = 9.6;
export const VB_LEGACY_MYBATTERY_ACTIVATION_FEE_HT = 232.5;
export const VB_LEGACY_MYBATTERY_BASE_DISCHARGE_EUR_PER_KWH_HT = 0.07925;
export const VB_LEGACY_MYBATTERY_HPHC_HP_DISCHARGE_EUR_PER_KWH_HT = 0.08025;
export const VB_LEGACY_MYBATTERY_HPHC_HC_DISCHARGE_EUR_PER_KWH_HT = 0.06585;
export const VB_LEGACY_URBAN_BASE_GRID_FEE_EUR_PER_KWH_HT = 0.0484;
/** Sommes legacy HP/HC Urban (énergie + réseau) — inchangé vs 0.1412+0.0494 et 0.1007+0.035 */
export const VB_LEGACY_URBAN_HPHC_HP_DISCHARGE_SUM_HT = 0.1412 + 0.0494;
export const VB_LEGACY_URBAN_HPHC_HC_DISCHARGE_SUM_HT = 0.1007 + 0.035;

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans computeVirtualBatteryP2Finance (virtualBatteryP2Finance.service.js)
export const VIRTUAL_BATTERY_P2_VAT_RATE = 0.2;

/** Paliers MySmartBattery [kWh palier, €/mois HT] — virtualBatteryP2Finance.service.js */
export const MYSMART_CAPACITY_TIERS_HT = [
  [20, 10.83],
  [100, 14.16],
  [300, 22.49],
  [600, 29.16],
  [900, 33.33],
  [1200, 37.49],
  [1800, 47.49],
  [3000, 75.83],
  [5000, 112.49],
  [10000, 179.16],
];

// HARD CONSTANT – NOT CONFIGURABLE FROM CRM
// utilisé dans meterKvaToNearestUrbanBaseStep, urbanBaseEnergyPriceHt (virtualBatteryP2Finance.service.js)
export const URBAN_BASE_KVA_STEPS = [3, 6, 9, 12, 15, 18, 24, 30, 36];
export const URBAN_BASE_ENERGY_LOW = 0.1308;
export const URBAN_BASE_ENERGY_HIGH = 0.1297;

/** Abonnement legacy sans grille Urban/MyBattery : €/kWc/mois × 12 (virtualBatteryP2Finance.service.js) */
export const VIRTUAL_BATTERY_LEGACY_SUBSCRIPTION_EUR_PER_KWC_MONTH = 1.0;
