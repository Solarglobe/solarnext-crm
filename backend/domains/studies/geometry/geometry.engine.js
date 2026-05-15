/**
 * domains/studies/geometry/geometry.engine.js — Moteur de calcul PV géométrique.
 *
 * CE MODULE N'A AUCUNE DÉPENDANCE EXPRESS.
 * Il peut être importé et testé sans démarrer le serveur HTTP.
 *
 * Critère de succès (Step #8 — DDD léger) :
 *   import { runGeometryCalculation } from "./domains/studies/geometry/geometry.engine.js";
 *   const result = await runGeometryCalculation(payload); // sans Express
 *
 * Ce module orchestre les services PV purs :
 *  - pvgisService      : irradiation solaire depuis l'API PVGIS
 *  - solarModelService : modèle de production PV (angle, orientation, pertes)
 *  - consumptionService: profil de consommation 8760h
 *  - productionMultiPan: calcul multi-pan (plusieurs pans de toit)
 *  - monthlyAggregator : agrégation mensuelle des résultats horaires
 *
 * Interface :
 *   runGeometryCalculation(payload) → Promise<GeometryResult>
 *   runShadingCalculation(payload)  → Promise<ShadingResult>
 *   runHorizonMask(payload)         → Promise<HorizonResult>
 */

import * as pvgisService      from "../../../services/pvgisService.js";
import * as consumptionService from "../../../services/consumptionService.js";
import * as solarModelService  from "../../../services/solarModelService.js";
import { computeProductionMultiPan } from "../../../services/productionMultiPan.service.js";
import { aggregateMonthly }   from "../../../services/monthlyAggregator.js";
import { buildLegacyPayloadFromSolarNext } from "../../../services/solarnextAdapter.service.js";
import {
  applyPanelPowerFromCatalog,
} from "../../../services/pv/resolvePanelFromDb.service.js";
import {
  resolvePvInverterEngineFields,
} from "../../../services/pv/resolveInverterFromDb.service.js";
import {
  applyPhysicalBatteryTechnicalFromCatalog,
} from "../../../services/pv/resolveBatteryFromDb.service.js";

// ---------------------------------------------------------------------------
// Type documenté du payload d'entrée
// ---------------------------------------------------------------------------
/**
 * @typedef {object} GeometryPayload
 * @property {number}   lat              - Latitude du site (degrés décimaux)
 * @property {number}   lng              - Longitude du site (degrés décimaux)
 * @property {number}   peak_power_kwp   - Puissance crête installée (kWc)
 * @property {number}   [tilt]           - Inclinaison des panneaux (°, défaut 30)
 * @property {number}   [azimuth]        - Azimut (° depuis Sud, défaut 0)
 * @property {object}   [shading]        - Masque d'ombrage (optionnel)
 * @property {string}   [csv_path]       - Chemin vers le profil de consommation CSV
 * @property {object}   [multi_pan]      - Configuration multi-pan
 * @property {object}   equipment        - Équipement PV (panel, inverter, battery)
 */

/**
 * @typedef {object} GeometryResult
 * @property {number[]} hourly_production_kwh  - Production horaire 8760h
 * @property {number}   annual_production_kwh  - Production annuelle totale
 * @property {object}   monthly                - Agrégats mensuels
 * @property {object}   pvgis_raw              - Données brutes PVGIS
 */

// ---------------------------------------------------------------------------
// Fonction principale — PURE (pas de req/res)
// ---------------------------------------------------------------------------

/**
 * Calcule la production PV géométrique pour un site et un équipement donnés.
 *
 * @param {GeometryPayload} payload
 * @param {{ pool?: object }} [ctx] - Contexte optionnel (pool DB pour résolution catalogue)
 * @returns {Promise<GeometryResult>}
 */
export async function runGeometryCalculation(payload, ctx = {}) {
  const {
    lat, lng, peak_power_kwp, tilt = 30, azimuth = 0,
    shading, csv_path, multi_pan, equipment,
  } = payload;

  // 1. Résolution catalogue équipement (optionnel — nécessite pool DB)
  let resolvedEquipment = equipment ?? {};
  if (ctx.pool && equipment?.panel_id) {
    resolvedEquipment = await applyPanelPowerFromCatalog(resolvedEquipment, ctx.pool);
    resolvedEquipment = await resolvePvInverterEngineFields(resolvedEquipment, ctx.pool);
    if (equipment?.battery_id) {
      resolvedEquipment = await applyPhysicalBatteryTechnicalFromCatalog(resolvedEquipment, ctx.pool);
    }
  }

  // 2. Construction du payload legacy (format attendu par solarModelService)
  const legacyPayload = buildLegacyPayloadFromSolarNext({
    ...payload,
    equipment: resolvedEquipment,
  });

  // 3. Données PVGIS (irradiation horaire)
  const pvgisData = await pvgisService.fetchHourlyData({ lat, lng, tilt, azimuth, peak_power_kwp });

  // 4. Profil de consommation
  const consumptionProfile = csv_path
    ? await consumptionService.loadFromCsv(csv_path)
    : consumptionService.buildDefaultProfile();

  // 5. Modèle de production (avec pertes, ombrage, etc.)
  const productionResult = solarModelService.compute({
    pvgisData,
    legacyPayload,
    shading: shading ?? null,
  });

  // 6. Multi-pan (si configuré)
  const multiPanResult = multi_pan
    ? await computeProductionMultiPan({ pvgisData, multi_pan, legacyPayload })
    : null;

  // 7. Agrégation mensuelle
  const monthly = aggregateMonthly(
    multiPanResult?.hourly ?? productionResult.hourly_kwh
  );

  return {
    hourly_production_kwh: multiPanResult?.hourly ?? productionResult.hourly_kwh,
    annual_production_kwh: multiPanResult?.annual ?? productionResult.annual_kwh,
    monthly,
    pvgis_raw: pvgisData,
    consumption_profile: consumptionProfile,
    equipment: resolvedEquipment,
  };
}

// ---------------------------------------------------------------------------
// Re-exports des services PV pour les tests unitaires
// ---------------------------------------------------------------------------

export {
  pvgisService,
  consumptionService,
  solarModelService,
  computeProductionMultiPan,
  aggregateMonthly,
};
