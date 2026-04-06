# AUDIT 02 — Cartographie du pipeline de calcul

Ordre exact des étapes du moteur SolarNext (fichiers et fonctions réels).

---

## Schéma du pipeline réel

```
┌─────────────────────────────────────────────────────────────────────────────┐
│  ENTRÉE : req.body.solarnext_payload (ou form + settings)                     │
│  → buildLegacyPayloadFromSolarNext() → form, settings                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  0) Contexte global                                                          │
│  buildContext(form, settings)  [calc.controller.js]                         │
│  ctx.finance_input, ctx.battery_input, ctx.virtual_battery_input            │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  1) Load_8760 — Consommation 8760h                                           │
│  consumptionService.loadConsumption(mergedConso, csvPath)                    │
│  → ctx.conso = { hourly, annual_kwh, clamped }                               │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  2) PV_8760 — Production PV mensuelle puis horaire                           │
│  Si form.roof?.pans : computeProductionMultiPan() → buildHourlyPV()          │
│  Sinon : pvgisService.computeProductionMonthly() → shadingLossPct →         │
│          resolveKwcMono() → buildHourlyPV(monthly_total, ctx)                │
│  → ctx.pv = { hourly, kwc, monthly, total_kwh, … }                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  3) Production PV horaire (déjà dans ctx.pv.hourly)                         │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  4) Pilotage                                                                 │
│  buildPilotedProfile(conso.hourly, ctx.pv.hourly)  [pilotageService.js]     │
│  → ctx.conso_p_pilotee = pilotage.conso_pilotee_hourly                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  5) Dispatch énergétique + batterie physique                                 │
│  buildBaseScenarioOnly(ctx) → buildScenarioBaseV2(ctx)                       │
│    → aggregateMonthly(ctx.pv.hourly, ctx.conso_p_pilotee)  [sans batterie]   │
│  Si battery_input.enabled && capacity_kwh > 0 :                              │
│    simulateBattery8760(pv_hourly, conso_p_pilotee, battery_input)            │
│    → aggregateMonthly(pv, conso, batt) pour BATTERY_PHYSICAL                  │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  6) Batterie virtuelle (finance uniquement)                                  │
│  Si virtual_battery_input.enabled :                                          │
│    computeVirtualBatteryQuote(surplus, import, config)                         │
│    → scénario BATTERY_VIRTUAL avec _virtualBatteryQuote                       │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  7) Import / export finaux                                                   │
│  Déjà dans aggregateMonthly : import_kwh = conso - auto ; surplus = prod - auto│
│  (batterie physique modifie auto_hourly, surplus_hourly, grid_import dans     │
│   simulateBattery8760)                                                        │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  8) Finance                                                                  │
│  financeService.computeFinance(ctx, scenarios)                               │
│  → mergeFinanceIntoScenarios(scenarios, finance.scenarios)                   │
│  CAPEX depuis ctx.finance_input.capex_ttc ; cashflows, ROI, IRR, LCOE         │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  9) Impact CO₂                                                               │
│  impactService.computeImpact(ctx, scenariosFinal)                           │
└─────────────────────────────────────────────────────────────────────────────┘
                                        │
                                        ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│  10) Sortie scenarios_v2                                                     │
│  Object.values(scenariosFinal).filter(_v2).map(mapScenarioToV2)             │
│  → ctxFinal.scenarios_v2                                                     │
└─────────────────────────────────────────────────────────────────────────────┘
```

---

## Fichiers et fonctions par étape

| Étape | Fichier | Fonction / détail |
|-------|---------|-------------------|
| 0 | `controllers/calc.controller.js` | `buildContext(form, settings)` |
| 1 | `services/consumptionService.js` | `loadConsumption(formOrConso, csvPath, formParams)` |
| 2 | `services/pvgisService.js` | `computeProductionMonthly(ctx)` ou `computeProductionMonthlyForOrientation(ctx, azimuth, tilt)` |
| 2 | `services/productionMultiPan.service.js` | `computeProductionMultiPan({ site, settings, pans })` |
| 2 | `services/solarModelService.js` | `buildHourlyPV(monthlyArray, ctx)` |
| 4 | `services/pilotageService.js` | `buildPilotedProfile(baseLoadHourly, pvHourly)` |
| 5 | `services/scenarios/scenarioBuilderV2.service.js` | `buildScenarioBaseV2(ctx)` |
| 5 | `services/monthlyAggregator.js` | `aggregateMonthly(prodHourly, consoHourly, battSummary)` |
| 5 | `services/batteryService.js` | `simulateBattery8760({ pv_hourly, conso_hourly, battery })` |
| 6 | `services/virtualBatteryQuoteCalculator.service.js` | `computeVirtualBatteryQuote({ annual_surplus_kwh, annual_import_kwh, config })` |
| 8 | `services/financeService.js` | `computeFinance(ctx, scenarios)` |
| 9 | `services/impactService.js` | `computeImpact(ctx, scenarios)` |
| 10 | `services/scenarioV2Mapper.service.js` | `mapScenarioToV2(scenario, ctx)` |

---

## Flux des données clés

- **Conso brute** : `ctx.conso.hourly` (8760).
- **Conso après pilotage** : `ctx.conso_p_pilotee` (8760) — utilisée pour BASE et BATTERY_PHYSICAL.
- **PV** : `ctx.pv.hourly` (8760), inchangé par la batterie.
- **Sans batterie** : `aggregateMonthly(pv, conso_p_pilotee)` → auto = min(pv, load), surplus = max(0, pv - load), import = max(0, load - auto).
- **Avec batterie physique** : `simulateBattery8760` produit `auto_hourly`, `surplus_hourly`, `grid_import_kwh` ; `aggregateMonthly(pv, conso, batt)` utilise ces séries.
- **Batterie virtuelle** : ne modifie pas les flux énergétiques ; ajoute `_virtualBatteryQuote` (coût annuel) et le module finance soustrait cet OPEX des cashflows.
