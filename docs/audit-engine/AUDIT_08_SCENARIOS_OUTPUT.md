# AUDIT 08 — Validation des sorties scenarios_v2

Structure du mapping final et cohérence avec les calculs.

---

## Fichier de mapping

- `backend/services/scenarioV2Mapper.service.js` : `mapScenarioToV2(scenario, ctx)`.

---

## Champs générés (structure finale)

Chaque scénario dans `scenarios_v2` est un objet avec :

| Bloc | Champs | Source (code) |
|------|--------|----------------|
| **id** | id (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL) | scenario.name |
| **label** | label (libellé affiché) | LABELS[id] |
| **energy** | production_kwh, autoconsumption_kwh, surplus_kwh, import_kwh, monthly, self_consumption_pct, self_production_pct | scenario.energy / scenario.prod_kwh, auto_kwh, surplus_kwh ; conso_kwh ; auto_pct_real ou (auto/conso)*100 ; (auto/prod)*100 |
| **finance** | capex_ttc, roi_years, irr_pct, lcoe, annual_cashflows, economie_year_1, economie_total, virtual_battery_cost_annual | scenario (après computeFinance) ; _virtualBatteryQuote.annual_cost_ttc |
| **capex** | total_ttc, injected_from_devis | scenario.capex_ttc ; _v2 === true |
| **hardware** | panels_count, kwc, battery_capacity_kwh | ctx.pv ; scenario.metadata ; ctx.battery_input.capacity_kwh |
| **shading** | near_loss_pct, far_loss_pct, total_loss_pct, quality | ctx.shading / form.installation.shading |
| **production** | annual_kwh, monthly_kwh | ctx.production (ou scenario.energy.prod) |
| **assumptions** | battery_enabled, virtual_enabled, shading_source, model_version | scenario.battery / batterie ; id === BATTERY_VIRTUAL ; shading ; "ENGINE_V2" |
| **computed_at** | ISO timestamp | new Date().toISOString() |

---

## Cohérence avec les calculs

- **energy** : les valeurs viennent du scénario après dispatch (et batterie physique si applicable) puis merge finance ; production_kwh = prod, autoconsumption_kwh = auto_kwh, surplus_kwh, import_kwh = energy.import. Les totaux annuels sont ceux de `aggregateMonthly` ou de `simulateBattery8760`.  
- **finance** : injectée par `computeFinance` (capex_ttc, roi_years, irr_pct, flows, economie_an1, gain_25a) ; virtual_battery_cost_annual = _virtualBatteryQuote.annual_cost_ttc pour BATTERY_VIRTUAL.  
- **self_consumption_pct** : auto / conso (part de la conso couverte par l’auto).  
- **self_production_pct** : auto / prod (part de la prod autoconsommée).  
- Aucune recalcul dans le mapper : il formate et renomme les champs déjà présents ; la cohérence dépend donc du respect des invariants dans monthlyAggregator, batteryService et financeService (cf. AUDIT_03, 05, 07).

---

## Filtrage des scénarios

- Seuls les scénarios avec `_v2 === true` sont mappés : `Object.values(scenariosFinal).filter(sc => sc._v2 === true).map(mapScenarioToV2)`.  
- Ordre : celui de `Object.values` (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL selon les clés présentes).
