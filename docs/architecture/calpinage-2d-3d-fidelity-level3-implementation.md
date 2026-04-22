# Niveau 3 — Aires horizontales monde (m²) & inférence modules PV

**Référence :** [calpinage-2d-3d-fidelity-level0-charter.md](./calpinage-2d-3d-fidelity-level0-charter.md) · [calpinage-2d-3d-fidelity-level2-implementation.md](./calpinage-2d-3d-fidelity-level2-implementation.md)

## Objectif

- **Surfaces** : une seule chaîne pour l’aire **horizontale monde** (m²) d’un polygone défini en pixels image : projection des sommets par `imagePxToWorldHorizontalM`, puis **shoelace** dans le plan XY monde.
- **Panneaux** : inférence `moduleWidthM` / `moduleHeightM` depuis un quad image via **`segmentHorizontalLengthMFromImagePx`** (même loi que la 3D), avec **`northAngleDeg`** propagé depuis `buildCanonicalPlacedPanelsFromRuntime`.

Note : avec la transformée linéaire actuelle, l’aire monde coïncide numériquement avec `aire_px² × mpp²` ; le helper **`polygonHorizontalAreaM2FromImagePx`** matérialise néanmoins la charte « une loi, un endroit ».

## API

| Fonction | Fichier |
|----------|---------|
| `polygonHorizontalAreaM2FromImagePx(ring, mpp, northAngleDeg)` | `canonical3d/builder/worldMapping.ts` |

## Périmètre implémenté

| Zone | Détail |
|------|--------|
| Export public | `canonical3d/index.ts`, `canonical3d/builder/index.ts` |
| Obstacles (heuristique emprise) | `catalog/obstacleFootprint.ts` — polygone via helper ; rectangle via produit des côtés monde |
| Legacy calpinage | `polygonAreaM2` (surface pan validée), dimensions plan obstacle export, `footprintAreaM2` avec nord |
| Adaptateur panneaux | `inferModuleDimsFromProjectionQuadPx`, `mapPvEnginePanelsToPanelInputs` (+ `northAngleDeg`), `buildCanonicalPlacedPanelsFromRuntime` |

## Tests

- `canonical3d/__tests__/geometricTruth.worldMapping.test.ts` (aire polygone)
- `catalog/__tests__/obstacleFootprint.worldMapping.test.ts`
- Tests existants `buildCanonicalPlacedPanelsFromRuntime.test.ts` (signature élargie avec défauts)

## Révisions

| Version | Date | Changement |
|---------|------|------------|
| 1.0 | 2026-04-09 | Niveau 3 initial : `polygonHorizontalAreaM2FromImagePx`, footprint, legacy surface pan, inférence PV + nord. |

Suite : [calpinage-2d-3d-fidelity-level4-implementation.md](./calpinage-2d-3d-fidelity-level4-implementation.md) (trace + validateur).
