# Rapport de parité legacy ↔ canonical 3D

## À quoi ça sert

Comparer **factuellement**, sur **la même source runtime** (fixture, session dev, export), deux pipelines :

1. **Legacy (sonde)** : `normalizeCalpinageGeometry3DReady` → entités `GeoEntity3D` → `houseModelV2` (même famille que l’aperçu phase3 / houseModel).
2. **Canonical** : `buildSolarScene3DFromCalpinageRuntime` → `SolarScene3D`.

Ce n’est **pas** une mesure de vérité physique absolue ni une certification terrain : uniquement la **parité / l’écart entre deux implémentations**.

## Ce qui est comparé (matching strict)

- **Pans** : ids `PAN_SURFACE` legacy vs `roofPlanePatches` canonical (après promotion volontaire `roof.roofPans` → `pans` pour la sonde legacy, voir ci‑dessous).
- **Panneaux** : ids `PV_PANEL` vs `pvPanels` ; orientation si `meta.orientation` legacy présent ; `panId` vs `roofPlanePatchId` si les deux pans existent.
- **Obstacles** : ids obstacles runtime conservés sur les volumes canonical ; hauteur d’extrusion `heightM` ; baseZ seulement si la base legacy n’est pas le fallback `0` évident (sinon **note** explicite, pas un faux écart).

## Ce qu’il ne faut pas surinterpréter

- **baseZ legacy = 0** sans `GeoEntity3DContext` : attendu pour la sonde « à froid » — le rapport l’indique dans `heights.notes`.
- **Shadow volumes / extensions** : comptés côté legacy ; pas de matching 1:1 automatique avec `extensionVolumes` dans cette version (messages dans `obstacles.issues`).
- **Tilt pan** : comparaison seulement si `tiltDeg` est présent des **deux** côtés (pas de bruit « données manquantes »).

## Lancer le rapport en dev

1. Mode runtime + fixture batterie :  
   `/dev/3d?mode=runtime&fixture=simple_gable_clean&parity=1`  
   (remplacer `simple_gable_clean` par tout id de `runtime3DFixtureBattery`.)

2. **Console** : résumé `overall.status` + `overall.summary` via `console.info('[dev/3d parity]', …)`.

3. **JSON** : bloc `<pre data-testid="dev-3d-parity-report">` sous le bandeau debug.

`inspect=1` reste indépendant (inspection viewer).

## Code

| Fichier | Rôle |
|---------|------|
| `frontend/src/modules/calpinage/canonical3d/dev/compareLegacyAndCanonical3D.ts` | Construction du `SceneParityReport` |
| `frontend/src/modules/calpinage/canonical3d/dev/useDev3DScene.ts` | `runtimeBuildInput` pour parité |
| `frontend/src/modules/calpinage/canonical3d/dev/__tests__/compareLegacyAndCanonical3D.test.ts` | Tests unitaires / ciblés |
| `frontend/src/modules/calpinage/canonical3d/dev/__tests__/runtime3DFixtureParity.integration.test.ts` | Fixtures officielles + cas KO |

## Commandes tests

```bash
cd frontend && npx vitest run src/modules/calpinage/canonical3d/dev/__tests__/compareLegacyAndCanonical3D.test.ts
cd frontend && npx vitest run src/modules/calpinage/canonical3d/dev/__tests__/runtime3DFixtureParity.integration.test.ts
```

## Liens

- Batterie fixtures : [canonical3d-runtime-fixture-battery.md](./canonical3d-runtime-fixture-battery.md)
