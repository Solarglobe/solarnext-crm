# Batterie runtime 3D (canonical)

Objectif : prouver la **chaîne réelle** (runtime calpinage → adapter canonical 3D → `buildSolarScene3D` → scène → viewer) sur des cas nommés, proches produit, sans backend ni pixels WebGL.

## Où vivent les cas

| Emplacement | Rôle |
|-------------|------|
| `frontend/src/modules/calpinage/canonical3d/dev/runtime3DFixtureBattery.ts` | Fixtures + `RUNTIME_3D_FIXTURE_BATTERY`, ids officiels `RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS` |
| `frontend/src/modules/calpinage/canonical3d/dev/summarizeSolarRuntimeBuild.ts` | Résumé build (compteurs, codes d’erreur) |
| `frontend/src/modules/calpinage/canonical3d/dev/summarizeFixture3DReadiness.ts` | Résumé étendu : shading visuel effectif, cohérence, entités inspectables |
| `frontend/src/modules/calpinage/canonical3d/dev/__tests__/runtime3DFixtureFamilies.integration.test.ts` | Intégration **5 familles officielles** + inspection + comptages verrouillés |
| `frontend/src/modules/calpinage/canonical3d/dev/__tests__/runtime3DFixtureBattery.integration.test.ts` | Intégration **legacy** (5 cas historiques) |
| `frontend/src/modules/calpinage/canonical3d/viewer/__tests__/SolarScene3DFixtureViewer.smoke.test.tsx` | Smoke viewer : montage `SolarScene3DViewer` pour chaque fixture officielle |
| `frontend/src/modules/calpinage/canonical3d/buildSolarScene3DFromCalpinageRuntime.ts` | Injection `getAllPanels` / options moteur |

## Fixtures officielles (5 familles — non-régression forte)

| Id | Intention |
|----|-----------|
| `simple_gable_clean` | **Référence** : 2 pans, faîtage, 4 panneaux, pas d’obstacle, shading `perPanel` complet |
| `gable_with_chimney` | **Semi-réaliste** : 2 pans + cheminée métier, 4 panneaux, shading plausible |
| `multi_pan_complex` | **Chantier** : alias stable du cas L (3 pans, ridges + trait, lucarne, 5 panneaux), sans shading runtime → fallback neutre côté viewer |
| `partial_degraded_like` | **Imparfait** : pans sans `h` explicite, shading partiel, entrée `perPanel` orpheline ; build OK |
| `dense_loaded_case` | **Chargé** : 3 pans, 14 panneaux, 3 obstacles, shading complet |

Constante TypeScript : `RUNTIME_3D_OFFICIAL_FAMILY_FIXTURE_IDS`.

## Fixtures legacy (toujours valides)

| Id | Intention |
|----|-----------|
| `mono-pan-nominal` | 1 pan, obstacle, 2 panneaux |
| `dual-pan-ridge` | 2 pans, faîtage, panneaux sur chaque pan |
| `multi-pan-l-shaped` | Même runtime que `multi_pan_complex` (id historique) |
| `partial-missing-world-contract` | Sans `canonical3DWorldContract` → échec explicite |
| `tense-small-dual-pan` | Petits pans, 8 panneaux, obstacle proche |

**Important :** `ridges` / `traits` sont à la **racine** du state runtime, pas sous `roof` (voir `resolveCalpinageStructuralRoofForCanonicalChain`).

## Injection panneaux

Chaque bundle expose `panels` ; les tests passent :

`buildSolarScene3DFromCalpinageRuntime(runtime, { getAllPanels: () => bundle.panels })`.

## Sandbox `/dev/3d`

`?mode=runtime&fixture=<id>` charge une entrée de la batterie (voir `useDev3DScene.ts`).

**Parité legacy ↔ canonical** : ajouter `parity=1` — voir [canonical3d-legacy-parity-report.md](./canonical3d-legacy-parity-report.md).

Exemples :

- `/dev/3d?mode=runtime&fixture=simple_gable_clean`
- `/dev/3d?mode=runtime&fixture=dense_loaded_case`
- `/dev/3d?mode=runtime&fixture=multi_pan_complex&parity=1`

## Commandes tests

```bash
cd frontend && npx vitest run src/modules/calpinage/canonical3d/dev/__tests__/runtime3DFixtureFamilies.integration.test.ts
cd frontend && npx vitest run src/modules/calpinage/canonical3d/dev/__tests__/runtime3DFixtureBattery.integration.test.ts
cd frontend && npx vitest run src/modules/calpinage/canonical3d/viewer/__tests__/SolarScene3DFixtureViewer.smoke.test.tsx
```

## Hors scope volontaire

Benchmarks perf, tests pixel-perfect WebGL, vérité physique shading, dépendance API backend.
