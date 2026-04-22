# Rendu premium Maison 3D (Prompt 10)

## Objectif

Couche officielle **d’affichage** après la chaîne géométrique et la validation (Prompt 9) : matériaux, lumière, hiérarchie visuelle, modes de lecture, **sans recalcul métier** et **sans masquer** une géométrie défaillante.

## Assembleur

- **Fonction** : `buildPremiumHouse3DScene`  
- **Fichier** : `frontend/src/modules/calpinage/canonical3d/viewer/premium/buildPremiumHouse3DScene.ts`  
- **Entrées** :
  - `scene` : `SolarScene3D` (produit par `buildSolarScene3D` / runtime calpinage validé),
  - `viewMode` : mode de lecture premium,
  - `geometryValidationReport?` : sortie de `validateCanonicalHouse3DGeometry` (optionnelle).
- **Sortie** : `PremiumHouse3DSceneAssembly` (`schemaId` = `premium-house-3d-scene-assembly-v1`) — couches, matériaux, lumière, cadrage, **présentation** du statut de validation.

Aucune nouvelle géométrie : les maillages restent issus de `solarSceneThreeGeometry.ts` (pans, arêtes, ridges, volumes, quads PV).

## Viewer

`SolarScene3DViewer` appelle `buildPremiumHouse3DScene` par défaut (sauf `premiumAssemblyOverride` pour tests).  
Props utiles :

| Prop | Rôle |
|------|------|
| `premiumViewMode` | `presentation` \| `technical` \| `validation` \| `pv` |
| `geometryValidationReport` | Rapport Prompt 9 — **obligatoire** pour une disclosure géométrique mesurée |
| `premiumAssemblyOverride` | Surcharge pure données (tests) |
| `showPremiumGeometryTrustStripe` | `false` force la masque du bandeau ; `undefined` = auto (rapport ou mode validation ou toolbar) |
| `showPremiumViewModeToolbar` | Toolbar modes (sandbox dev / QA) |

### Bandeau confiance (`PremiumGeometryTrustStripe`)

- Ne remplace pas la validation : il **reflète** `geometryValidationReport` quand il est fourni.
- Si le rapport est **absent**, le texte reste neutre (« non mesurée » / « non exécutée » en mode validation) — **pas** de niveau inventé.
- Mode **presentation** + qualité **clean** : pas de texte superflu (pas de « faux rassurant » visuel).
- **invalid** / **partial** / **ambiguous** : accent coloré explicite (lisible, pas un effet pour cacher des trous).

## Modes de lecture

| Mode | Rôle principal |
|------|----------------|
| `presentation` | Client / commercial : rendu équilibré, ombres plus douces (2048), cadrage aéré |
| `technical` | Structure : arêtes toit marquées, ridges si données présentes, volumes plus « outil » |
| `validation` | Qualité géométrique : pas de soleil décoratif, ridges + excerpt codes diagnostics |
| `pv` | Implantation : contours légers panneaux, matériau PV plus présent ; légende shading = prop viewer `showShadingLegend` |

Les flags finaux combinent **mode** × **props** du viewer (`showRoof`, etc.) : une couche peut être masquée par le parent même si le mode la prévoit.

## Hiérarchie visuelle

1. **Toiture** : PBR distinct des murs (futurs murs hors `SolarScene3D` resteront à brancher quand la coque sera dans la scène).
2. **Arêtes** : contour toit + option ridges (`roofRidges` canoniques).
3. **Obstacles / extensions** : teintes et rugosités différentes du toit.
4. **Panneaux** : métal/roughness modulés par mode ; léger contour en mode `pv` / `validation` (lisibilité, pas double mesh).
5. **Validation** : bandeau + couleur d’accent selon `globalQualityLevel` / `globalValidity`.

## Ce qui est premium vs simple

- **Premium** : assembleur typé, lumières scalées, shadow map 2048 en presentation/pv, matériaux différenciés, ridges, disclosure validation.
- **Volontairement simple** : pas de post-processing HDR, pas de PBR textures image, pas de refonte caméra hors marge de cadrage.

## Ce que ce document ne couvre pas

- Pas de moteur d’ombrage PV dans le viewer (lecture `panelVisualShadingByPanelId` inchangée).
- Pas de maillage « double peau » pour simuler des raccords — la vérité reste dans la géométrie canonique et le rapport Prompt 9.

## Tests

`frontend/src/modules/calpinage/canonical3d/viewer/premium/__tests__/buildPremiumHouse3DScene.test.ts`

## Sandbox dev

Route `dev/3d` : query `view=presentation|technical|validation|pv` + toolbar premium activée par défaut sur cette page.
