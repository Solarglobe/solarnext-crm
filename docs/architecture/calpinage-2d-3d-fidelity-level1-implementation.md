# Niveau 1 — Implémentation fidélité 2D/3D (calpinage runtime)

**Référence charte :** [calpinage-2d-3d-fidelity-level0-charter.md](./calpinage-2d-3d-fidelity-level0-charter.md)

## 1. Emprise shell — source unique

| API | Rôle |
|-----|------|
| `resolveOfficialShellFootprintRingWorld` | `frontend/src/modules/calpinage/canonical3d/builder/officialShellFootprintRing.ts` |
| Consommateur principal | `buildBuildingShell3DFromCalpinageRuntime` (même fichier logique qu’avant, sans duplication) |
| Debug viewer | `DebugXYAlignmentOverlay` trace l’anneau en **cyan** au même zLevel que les autres preuves |

Tout nouvel outil (overlay 2D métier, export DXF, etc.) qui doit **coller au prisme** doit utiliser cette fonction, pas recalculer contour / plus grand pan.

## 2. Jeu vertical toit ↔ shell (anti z-fighting)

| Constante | Valeur | Fichier |
|-----------|--------|---------|
| `WALL_TOP_CLEARANCE_M` | **0,01 m** (10 mm) | `buildBuildingShell3DFromCalpinageRuntime.ts` (exportée) |

La couronne haute du shell est légèrement **sous** le plan toit local, ce qui réduit les artefacts GPU sans impact métier significatif.

## 3. Cotes 2D en mètres (même loi que la 3D)

| Fonction | Rôle |
|----------|------|
| `segmentHorizontalLengthMFromImagePx(a, b, mpp, northDeg)` | `worldMapping.ts` — distance horizontale monde entre deux points image |

À utiliser lorsque l’UI affiche une longueur en **m** dérivée de sommets px (évite une chaîne parallèle).  
**Niveau 2 :** ce helper est branché sur le canvas mesures, HUD obstacles, volumes ombrants et pente manuelle pan (`calpinage-2d-3d-fidelity-level2-implementation.md`).  
**Niveau 3 :** aires m² (`polygonHorizontalAreaM2FromImagePx`) et inférence dimensions modules PV — `calpinage-2d-3d-fidelity-level3-implementation.md`.

## 4. Viewer 3D — lissage d’affichage optionnel

Le pipeline produit reste en **`roofGeometryFidelityMode: "fidelity"`** par défaut (données).

Pour le **viewer inline** uniquement, définir avant le build :

```js
window.__CALPINAGE_3D_ROOF_DISPLAY_FIDELITY__ = "reconstruction";
```

`Inline3DViewerBridge` transmet alors `roofGeometryFidelityMode: "reconstruction"` à `getOrBuildOfficialSolarScene3DFromCalpinageRuntime` (mesh souvent plus lisse ; **pas** d’écriture state).

Retirer la propriété ou la remettre à toute autre valeur pour revenir au défaut fidélité.

## 5. Tests

- `builder/__tests__/officialShellFootprintRing.test.ts`
- `__tests__/geometricTruth.worldMapping.test.ts` (segment horizontal)
- `builder/__tests__/buildBuildingShell3DFromCalpinageRuntime.test.ts` (régression shell)

## 6. Révisions

| Version | Date | Changement |
|---------|------|------------|
| 1.0 | 2026-04-09 | Niveau 1 initial : resolver partagé, clearance 10 mm, helper cote, flag viewer. |
| 1.1 | 2026-04-09 | Référence au Niveau 2 (câblage legacy du helper). |
