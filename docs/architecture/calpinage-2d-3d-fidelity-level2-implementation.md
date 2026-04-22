# Niveau 2 — Cotes 2D / mètres alignées sur le mapping officiel

**Référence :** [calpinage-2d-3d-fidelity-level0-charter.md](./calpinage-2d-3d-fidelity-level0-charter.md) (charte) · [calpinage-2d-3d-fidelity-level1-implementation.md](./calpinage-2d-3d-fidelity-level1-implementation.md) (Niveau 1)

## Objectif

Toute **longueur affichée ou dérivée en mètres** à partir de segments ou de côtés définis en **pixels image** doit utiliser la même loi que la 3D : `imagePxToWorldHorizontalM` + distance euclidienne dans le plan horizontal monde, exposée par **`segmentHorizontalLengthMFromImagePx`** (`canonical3d/builder/worldMapping.ts`), avec **`northAngleDeg`** issu du toit (`roof.north.angleDeg` ou `roof.roof.north.angleDeg`).

Interdit pour ces cas : `hypot(dxPx, dyPx) * metersPerPixel` seul (équivaut au monde seulement pour `north = 0`).

## Périmètre implémenté

| Zone | Fichier / module |
|------|-------------------|
| Outil **Mesure** (segments persistés + prévisualisation) | `legacy/calpinage.module.js` — `segmentHorizontalLengthMFromImagePx` + `readNorthAngleDegFromCalpinageRoof` |
| **Volumes ombrants** (cube / tube au drag) | `catalog/roofObstaclePlacement.ts` — `computeShadowCubeMetersFromAnchor`, `computeShadowTubeMetersFromAnchor` (paramètre optionnel `northAngleDeg`, défaut `0`) |
| **HUD obstacle** sélection | `formatObstacle2DSelectionHud(..., mpp, northAngleDeg?)` |
| **Pente manuelle pan** (`run` bas ↔ faîtage) | `calpinage/state/panPhysical.ts` et **`calpinage/pans-bundle.js`** (sync obligatoire) |

## Tests

- `catalog/__tests__/roofObstaclePlacement.worldMapping.test.ts`

## Révisions

| Version | Date | Changement |
|---------|------|------------|
| 1.0 | 2026-04-09 | Niveau 2 initial : mesures canvas, obstacles ombrants, HUD, pente manuelle + bundle. |

Suite : [calpinage-2d-3d-fidelity-level3-implementation.md](./calpinage-2d-3d-fidelity-level3-implementation.md) (aires m², inférence PV).
