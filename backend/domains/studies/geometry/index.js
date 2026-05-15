/**
 * domains/studies/geometry/index.js — Moteur géométrique PV.
 *
 * Critère de succès : ce module peut être importé et testé
 * SANS démarrer Express ni charger httpApp.js.
 *
 * Usage :
 *   import { runGeometryCalculation } from "./domains/studies/geometry/index.js";
 *   const result = await runGeometryCalculation(payload);
 */

export {
  runGeometryCalculation,
  pvgisService,
  consumptionService,
  solarModelService,
  computeProductionMultiPan,
  aggregateMonthly,
} from "./geometry.engine.js";
