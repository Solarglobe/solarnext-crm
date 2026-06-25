# Correction — cohérence moteur des 4 scénarios (interdire le mélange 8760 / mensuel)

**Date :** 25/06/2026 · Cas déclencheur : FAVER (batterie physique affichée à 95,5 % / 244 cycles, impossible en 8760).

## Résultat après correction (test exécuté sur le vrai moteur)

| | Capture (buguée) | Après correction (8760) |
|---|---|---|
| Autoconso PV batterie physique | 95,5 % | **75,5 %** |
| Énergie utilisée | 5 608 kWh | **4 471 kWh** |
| Décharge batterie | 1 711 kWh | **1 132 kWh** |
| Cycles équivalents | 244 | **162** |
| Export restant | 316 kWh | **1 330 kWh** |

✅ Conforme à l'objectif (75-81 % d'autoconso, 1 130-1 220 kWh déchargés). Les 3 tests anti-régression passent.

## Modifications (7 points demandés)

1. **`backend/services/core/engineConstants.js`** — `SCENARIO_MONTHLY_BATTERY_AUTO_BOOST` passé de **1.1 → 1.0** (bonus mensuel neutralisé). *(#6)*
2. **`backend/services/scenarioService.js`** — le fallback mensuel ne crédite plus d'autoconso batterie supplémentaire (boost = 1.0) ; la sortie mensuelle est taguée `energy_basis: "monthly_fallback"` (détectable). *(#2, #6)*
3. **`backend/controllers/calc.controller.js`** — garde de cohérence après assemblage des scénarios : chaque carte est taguée `energy_basis` (`hourly_8760` / `skipped`) ; toute carte batterie dont la base diffère de la base SANS est **forcée `_skipped`** (jamais une batterie mensuelle à côté d'une base horaire). *(#1, #2, #3)*
4. **`backend/services/scenarioV2Mapper.service.js`** — `energy_basis` propagé dans chaque entrée de `scenarios_v2` (traçabilité de la base temporelle).
5. **`backend/services/calc/calc.constants.js`** — `CALC_ENGINE_VERSION` bumpé **V12 → V13** → invalide tous les snapshots anciens. *(#4)*
6. **`backend/controllers/studyCalc.controller.js`** — persiste `scenarios_engine_version` + `scenarios_computed_at` dans `data_json` à chaque calcul. *(#5)*
7. **`backend/controllers/studyScenarios.controller.js`** — à la lecture, compare la version du snapshot à la version courante et vérifie la cohérence des `energy_basis` ; renvoie `stale_snapshot`, `engine_coherent`, `needs_recompute` (et tague `_engine_stale` sur les cartes suspectes). **Aucun chiffre n'est fabriqué** : le front est invité à relancer le calcul. *(#3, #4)*
8. **`backend/tests/faverBatteryCoherence.test.mjs`** — test anti-régression : la batterie physique FAVER ne ressort jamais ≥ 90 % ni ≥ 200 cycles ; décharge hiver ≈ 0 ; boost mensuel = 1.0 ; fallback mensuel n'inflate plus. *(#7)*

## Déploiement / effet sur FAVER

- Le bump `CALC_ENGINE_VERSION → V13` marque le snapshot actuel de FAVER comme **périmé** (`needs_recompute: true`).
- **Relancer le calcul** de l'étude FAVER (bouton « Lancer calcul ») régénère `scenarios_v2` avec le moteur 8760 corrigé → la carte Physique tombe à **~75,5 %** et toutes les cartes partagent `energy_basis: "hourly_8760"`.
- Aucune carte batterie mensuelle ne pourra plus coexister avec une base 8760 (garde dans `calc.controller`).

## Vérifications faites

- `node --check` OK sur les 6 fichiers modifiés + le test.
- `node --test backend/tests/faverBatteryCoherence.test.mjs` : **3/3 pass**.
- Reconstruction 8760 sur le vrai moteur : 75,5 % / 1 132 kWh / 162 cycles.

> Note : `git diff` global est bruité par un problème de fins de ligne du dépôt (tout l'arbre apparaît modifié) ; les fichiers touchés ont été validés individuellement (line counts = HEAD + lignes ajoutées, syntaxe OK). Le **front** peut ensuite exploiter `needs_recompute` / `_engine_stale` pour proposer le recalcul automatiquement (amélioration UI optionnelle, non incluse ici).
