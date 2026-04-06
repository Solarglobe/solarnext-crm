# E2E Scénarios réels V2 (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL)

Harness de test end-to-end pour prouver par JSON que les 3 scénarios V2 sont bien générés et que la config batterie (physique / virtuelle) impacte les métriques attendues.

## Objectif

1. **Obtenir les JSON complets** des 3 variantes (BASE, BATTERY_PHYSICAL, BATTERY_VIRTUAL) via le flux réel : `economic_snapshot.config_json` → calcul → `study_versions.data_json.scenarios_v2`.
2. **Prouver par diff** :
   - **BATTERY_PHYSICAL** modifie les métriques **énergie** vs BASE (autoconsommation, surplus, import, etc.).
   - **BATTERY_VIRTUAL** modifie la **finance** vs BASE (abonnement, coût annuel, ROI, cashflows selon l’offre).
3. En cas d’échec, **identifier** où la config n’est pas injectée (payload builder, calc, finance).

## Usage

```bash
cd backend

# Dernière version de la première org (comme verify-quote-scenarios-audit.js)
node scripts/run-real-scenarios-e2e.js

# Version ciblée
node scripts/run-real-scenarios-e2e.js --studyId <uuid> --versionId <uuid>

# Avec dump des blocs comparés en cas d’échec
node scripts/run-real-scenarios-e2e.js --studyId <uuid> --versionId <uuid> --dump

# Autonome sans UI calpinage : injecte un calpinage minimal si absent (dev only)
node scripts/run-real-scenarios-e2e.js --fixture-calpinage

# Idem + suppression du calpinage fixture après le run
node scripts/run-real-scenarios-e2e.js --fixture-calpinage --cleanup
```

**Prérequis** : une étude avec **calpinage_data** pour la version ciblée, ou utiliser **`--fixture-calpinage`** pour injecter un calpinage minimal si absent (une commande suffit pour produire `tmp/scenarios_*.json`). En production (`NODE_ENV=production`), `--fixture-calpinage` est refusé.

## Comportement

1. **Résolution** : sans `--studyId` / `--versionId`, prend la dernière version de la première organisation.
2. **Chargement** : `economic_snapshot` (config actuelle) pour la version ; création d’un snapshot vide si absent.
3. **3 variantes de `config_json`** :
   - **BASE** : `batteries.physical.enabled = false`, `batteries.virtual.enabled = false`.
   - **PHYSICAL** : `batteries.physical.enabled = true`, `capacity_kwh = 10`, `product_snapshot` (puissance, rendement).
   - **VIRTUAL** : `batteries.virtual.enabled = true`, `annual_subscription_ttc = 480` (et champs optionnels).
4. Pour chaque variante :
   - Upsert de `economic_snapshots.config_json` pour la version.
   - Appel du calcul en processus (`runStudyCalc`).
   - Lecture de `scenarios_v2` depuis `study_versions.data_json`.
   - Sauvegarde dans `backend/tmp/scenarios_<BASE|PHYSICAL|VIRTUAL>.json`.
5. **Assertions** :
   - Au moins un champ **énergie** (autoconsommation, surplus, import) diffère entre BASE et BATTERY_PHYSICAL.
   - Au moins un champ **finance** (ROI, coût annuel batterie virtuelle, cashflows) diffère entre BASE et BATTERY_VIRTUAL.
6. **En cas d’échec** : message `FAIL` + extrait des deux blocs comparés ; avec `--dump`, écriture de `tmp/diff_physical_energy_fail.json` et/ou `tmp/diff_virtual_finance_fail.json`.

## Option `--fixture-calpinage`

- Si **calpinage_data** est absent et que `--fixture-calpinage` est passé : le script upsert un calpinage minimal valide pour la version (lat/lon depuis l’adresse du lead si dispo, sinon défaut Paris), log *"Injected fixture calpinage_data"*, puis enchaîne le run normal.
- Le fixture contient uniquement les champs lus par le payload builder / calc : `roofState.gps`, `roof.gps`, `validatedRoofData.pans` (orientation/tilt/panelCount), `frozenBlocks`, `shading.totalLossPct`, et colonnes `total_panels`, `total_power_kwc`, `annual_production_kwh`, `total_loss_pct`.
- **Sécurité** : si `NODE_ENV === "production"`, le script refuse d’injecter (throw).
- **`--cleanup`** : après le run, supprime le calpinage_data injecté (uniquement si c’est le fixture qui a été utilisé).

## Sorties

- **Console** : config batterie utilisée après upsert, liste des `scenario ids` dans `scenarios_v2`, extraits energy/finance, *"Fixture calpinage injected"* (si utilisé), *"Wrote tmp/scenarios_BASE.json, ..."*.
- **Fichiers** : `backend/tmp/scenarios_BASE.json`, `scenarios_PHYSICAL.json`, `scenarios_VIRTUAL.json`. Chaque fichier contient `usedConfig` (config batteries), `scenarios_v2` complet et `scenarios` (alias).

## Diagnostic si échec

- **PHYSICAL ne change pas l’énergie**  
  Vérifier :  
  - `solarnextPayloadBuilder.service.js` : lecture de `config.batteries.physical` et construction de `battery_input` (enabled, capacity_kwh, product_snapshot).  
  - `calc.controller.js` : `ctx.battery_input` utilisé pour `simulateBattery8760` et génération du scénario BATTERY_PHYSICAL.

- **VIRTUAL ne change pas la finance**  
  Vérifier :  
  - `solarnextPayloadBuilder.service.js` : mapping de `config.batteries.virtual` vers `virtual_battery_input` (annual_subscription_ttc, etc.).  
  - `calc.controller.js` : `computeVirtualBatteryQuote(ctx.virtual_battery_input)` et injection dans le scénario BATTERY_VIRTUAL ; `computeFinance` et merge des flux / ROI.

## Fichiers concernés

- Script : `backend/scripts/run-real-scenarios-e2e.js`
- Config → payload : `backend/services/solarnextPayloadBuilder.service.js` (batteries.physical / batteries.virtual)
- Calcul : `backend/controllers/calc.controller.js`, `backend/controllers/studyCalc.controller.js`
- Finance : `backend/services/financeService.js`, `backend/services/virtualBatteryQuoteCalcOnly.service.js`
