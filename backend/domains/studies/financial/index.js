/**
 * domains/studies/financial/index.js — Moteur financier PV.
 *
 * Critère de succès : testable sans Express.
 *
 * TODO Phase 5 — Extraire depuis calc.controller.js :
 *  - buildScenario()               (services/scenarioService.js)
 *  - buildScenarioBaseV2()         (services/scenarios/scenarioBuilderV2.service.js)
 *  - simulateBattery8760()         (services/batteryService.js)
 *  - computeVirtualBattery*()      (services/virtualBattery*.service.js)
 *  - financeService.*              (services/financeService.js)
 *  - impactService.*               (services/impactService.js)
 *
 * Interface cible :
 *   runFinancialCalculation(geometryResult, scenario, financialParams) → FinancialResult
 */

// export { runFinancialCalculation } from "./financial.engine.js";
