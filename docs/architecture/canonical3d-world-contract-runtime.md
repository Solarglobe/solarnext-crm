# Contrat monde runtime (`canonical3DWorldContract`)

## Rôle

La chaîne **canonical3d** exige un repère explicite (échelle, nord, cadre) pour convertir l’image en mètres sans ambiguïté. Ce document décrit le **bloc officiel** porté par `CALPINAGE_STATE.roof`.

## Source de vérité vs miroir

| Donnée | Source autoritaire (éditable métier) | Miroir sérialisé |
|--------|--------------------------------------|------------------|
| Échelle | `roof.scale.metersPerPixel` | `canonical3DWorldContract.metersPerPixel` |
| Nord | `roof.roof.north.angleDeg` | `canonical3DWorldContract.northAngleDeg` |
| Cadre | — | `referenceFrame: "LOCAL_IMAGE_ENU"` uniquement |

Le miroir **`canonical3DWorldContract`** est recalculé à partir des deux sources (pas l’inverse). S’il est absent ou désynchronisé, `peekCalpinageRuntimeWorldFrame` **n’expose pas** `referenceFrame` : la 3D canonique reste non éligible jusqu’à resync.

## Forme du bloc

```ts
{
  schemaVersion: 1,
  metersPerPixel: number;      // fini, > 0 — copie de scale
  northAngleDeg: number;      // fini — copie de roof.roof.north.angleDeg
  referenceFrame: "LOCAL_IMAGE_ENU";
}
```

## Où c’est mis à jour (runtime)

Règle : **dès que** `roof.scale.metersPerPixel` ou `roof.roof.north.angleDeg` change (source autoritaire), le miroir `canonical3DWorldContract` doit être recalculé **dans le même cycle logique** via `applyCanonical3DWorldContractToRoof` (ou `syncCanonical3DWorldContractFromCalpinageRoof` dans le module legacy).

Chemins actuels :

- Après **capture** carte (échelle + nord).
- Au début de **`buildGeometryForExport`** (export / sauvegarde).
- **`loadCalpinageState`** : sync **immédiate** après restauration de `roofState.scale` / `roofState.roof`, puis sync finale en fin de load.
- **Calibration** (`map-selector-bundle.js`) : si `validateAndApplyCalibration` reçoit la même référence que `CALPINAGE_STATE.roof`, appel de `window.__CALPINAGE_SYNC_CANONICAL3D_WORLD_CONTRACT__` (posé par le module legacy au montage).

API TS : `applyCanonical3DWorldContractToRoof`, `diagnoseCanonical3DWorldContract`, `getCanonical3DWorldContractDriftReport` dans  
`frontend/src/modules/calpinage/runtime/canonical3DWorldContract.ts`.

Diagnostics lecture seule : `CalpinageRuntime.getCanonical3DWorldContractDiagnostics()` et `getCanonical3DWorldContractDriftReport()` lorsque le runtime est enregistré.

Débogage : `window.__CALPINAGE_DEBUG_WORLD_CONTRACT__ === true` → après chaque sync, un warn si le rapport de dérive signale encore une incohérence (anomalie).

## Persistance

Le champ est inclus dans `roofState` de l’export JSON (`buildGeometryForExport`). Les anciens dossiers sans ce bloc restent valides côté 2D ; au prochain export / sync, le bloc est ajouté si `scale` + `north` sont valides.

## Ce que ça ne garantit pas

- Aucune correction de géométrie toit, faîtages, hauteurs ou branchement viewer produit.
- N’active pas le near shading canonique ni ne remplace le preview 3D legacy.
