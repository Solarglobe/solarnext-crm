# Benchmark flux energie SGS-2026-0137

## Statut

- Statut: success
- Scenario comparable: BASE (Sans batterie)
- Methode: PV + consommation horaires, sans batterie/V2H/pilotage

## Bilan annuel benchmark

- Production: 11592 kWh
- Consommation: 12234.379 kWh
- Autoconsommation: 3734.012969 kWh
- Taux autoconsommation: 32.211982 %
- Autosuffisance: 30.520658 %
- Surplus injecte: 7857.987031 kWh
- Import reseau: 8500.366031 kWh

## Comparaison stockee

- production_kwh: alias `production_kwh`, benchmark=11592, stocke=11516, ecart=76 (0.659951 %)
- consumption_kwh: alias `consumption_kwh`, benchmark=12234.379, stocke=13195.03, ecart=-960.651 (-7.2804 %)
- autoconsumption_kwh: alias `autoconsumption_kwh`, benchmark=3734.012969, stocke=4486, ecart=-751.987031 (-16.762974 %)
- surplus_injected_kwh: non compare (ambiguous)
- grid_import_kwh: alias `grid_import_kwh`, benchmark=8500.366031, stocke=8709, ecart=-208.633969 (-2.395613 %)
- self_consumption_pct: alias `self_consumption_pct`, benchmark=32.211982, stocke=38.95, ecart=-6.738018 (-17.299148 %)
- self_sufficiency_pct: alias `self_production_pct`, benchmark=30.520658, stocke=34, ecart=-3.479342 (-10.233359 %)

## Champs absents ou ambigus

- autoconsumption_kwh: plusieurs alias presents avec la meme valeur (autoconsumption_kwh, total_pv_used_on_site_kwh); alias retenu: autoconsumption_kwh.
- surplus_injected_kwh: plusieurs alias presents (surplus_kwh, exported_kwh, surplus_to_virtual_or_grid_kwh), comparaison non retenue.
- grid_import_kwh: plusieurs alias presents avec la meme valeur (grid_import_kwh, energy_grid_import_kwh, import_kwh); alias retenu: grid_import_kwh.
- self_consumption_pct: plusieurs alias presents avec la meme valeur (self_consumption_pct, pv_self_consumption_pct); alias retenu: self_consumption_pct.
- self_sufficiency_pct: plusieurs alias presents avec la meme valeur (self_production_pct, site_autonomy_pct, energy_independence_pct, solar_coverage_pct); alias retenu: self_production_pct.

## Avertissements de definition

- Benchmark calcule sans batterie, sans V2H et sans pilotage: comparaison limitee aux champs energetiques de meme definition apparente.
- Le surplus benchmark correspond a max(PV-consommation, 0) avant toute batterie virtuelle ou valorisation contractuelle.
- L'import reseau benchmark correspond a max(consommation-PV, 0) avant batterie, credits ou pilotage.
