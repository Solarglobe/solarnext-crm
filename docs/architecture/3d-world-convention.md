# SolarNext — 3D World Convention (Official)

## 1. Objectif

Définir la convention monde 3D **unique de référence** pour le module calpinage SolarNext : axes, unités, origine, passages image ↔ monde ↔ viewer, et règles de compatibilité avec le legacy.

La convention **canonique** est celle implémentée aujourd’hui par `canonical3d` (types `RoofModel3D`, builder `buildRoofModel3DFromLegacyGeometry`, `imagePxToWorldHorizontalM`). Toute nouvelle logique 3D doit s’y conformer.

---

## 2. Principes fondamentaux

### Source de vérité

- La **géométrie canonique** (`RoofModel3D`, `SolarScene3D`, entités associées) est la source de vérité.
- Le **rendu 3D** (Three.js, `SolarScene3DViewer`) ne recalcule pas la géométrie métier : il **tesselle / affiche** les coordonnées monde déjà résolues.

### Séparation stricte


| Espace            | Rôle                                                                                                                                 |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| **Image space**   | Pixels du dessin / overlay 2D (`xPx`, `yPx`).                                                                                        |
| **World space**   | Repère cartésien unique du modèle canonique, **longueurs en mètres**.                                                                |
| **Viewer space**  | Pour le viewer officiel : **même coordonnées numériques** que le world (pas de changement d’axes dans `solarSceneThreeGeometry.ts`). |
| **Plan pan (UV)** | Coordonnées `(u, v)` **dans le repère tangent du pan** — pas confondues avec le plan horizontal monde ni avec les pixels.            |


Voir aussi `frontend/src/modules/calpinage/canonical3d/types/coordinates.ts`.

---

## 3. Convention d’axes officielle (canonique)

Définie par `RoofModelMetadata.referenceFrame` (`types/model.ts`) :

- **Unité de longueur** : mètre (`metadata.units.length === "m"`).
- **Axe « vertical » monde** : `referenceFrame.upAxis` (vecteur unitaire, typiquement `{ x: 0, y: 0, z: 1 }` pour **Z up**).
- **Plan horizontal métier** : plan orthogonal à `upAxis` (empreintes horizontales, aires projetées).
- **Convention nommée usuelle** : `axisConvention: "ENU_Z_UP"` — **X ≈ Est, Y ≈ Nord, Z ≈ haut** (géographique local), **sous réserve** que `upAxis` et les données effectives du modèle restent cohérents.

Le mapping **image → plan horizontal monde** (avant ajout de l’altitude Z) est implémenté dans `canonical3d/builder/worldMapping.ts` :

- Sans rotation nord :  
  - `x0 = xPx * metersPerPixel`  
  - `y0 = -yPx * metersPerPixel`  
  (le **haut de l’image** correspond à **y pixel décroissant** ; le signe moins aligne le **Nord monde** sur le sens attendu après rotation.)
- Puis rotation **autour de l’axe vertical monde** (`northAngleDeg`, en degrés).

**Important** : ne pas réinventer ce mapping ailleurs ; utiliser `imagePxToWorldHorizontalM` ou les helpers de `worldConvention.ts`.

---

## 4. Unités officielles


| Couche                      | Unité                                                                            |
| --------------------------- | -------------------------------------------------------------------------------- |
| Image                       | **Pixels** (`px`).                                                               |
| World (canonique)           | **Mètres** (`m`) pour toutes les positions / distances 3D.                       |
| Angles (métadonnées modèle) | **Degrés** (`deg`) où le schéma l’indique.                                       |
| Viewer officiel             | **Même unité que le world** (m) — pas de mise à l’échelle métier dans le viewer. |
| UV pan                      | **Mètres** dans le repère tangent du pan (`PlaneFrameUv2D`).                     |


Aucune logique physique canonique ne doit dépendre directement du pixel **sans** passer par `metersPerPixel` et les helpers centralisés.

---

## 5. Origine officielle

### Canonique (builder 2D → `RoofModel3D`)

- L’origine du repère **horizontal** issu de l’image est **le coin pixel (0,0)** de la référence utilisée par le builder : `imagePxToWorldHorizontalM` ne soustrait pas de `originPx` (contrairement au legacy viewer).
- L’**altitude Z** (ou plus généralement la coordonnée le long de `upAxis`) est résolue **après** ce mapping par la chaîne de hauteurs (`heightConstraints.ts`, etc.) — sommets explicites, traits, faîtages, défauts.

### Métadonnées `referenceFrame`

- `WorldReferenceFrame.originDescription` peut documenter une origine site / projet ; le modèle géométrique reste exprimé dans le repère défini par `upAxis` et les positions des sommets.

### Legacy (`houseModelV2` / `phase3Viewer`)

- Utilise une **origine image** `(originPx.x, originPx.y)` et `worldX = (xPx - originPx.x) * mpp`, `worldZ = (yPx - originPx.y) * mpp` puis placement Three.js **Y = hauteur**.  
- C’est une **approximation / chemin legacy** pour le viewer historique — voir section 9.

---

## 6. Mapping image → monde

1. **Entrée** : `xPx`, `yPx`, `metersPerPixel`, `northAngleDeg` (angle nord calpinage / toiture, en degrés).
2. **Sortie plan horizontal** : `imagePxToWorldHorizontalM` → `{ x, y }` en mètres dans le plan horizontal monde (Z à fixer séparément).
3. **Champs / modules** :
  - `buildRoofModel3DFromLegacyGeometry.ts`  
  - `volumes/footprintWorld.ts`  
  - `assembleRoofRidges3D.ts`
4. **Échelle** : `metersPerPixel`.
5. **Orientation** : `northAngleDeg` (rotation autour de l’axe vertical monde après le mapping de base).

Point d’ancrage code unique : `frontend/src/modules/calpinage/canonical3d/builder/worldMapping.ts` et `canonical3d/core/worldConvention.ts`.

---

## 7. Mapping monde → viewer

### Viewer officiel (`SolarScene3DViewer`)

- `solarSceneThreeGeometry.ts` copie **tel quel** `(x, y, z)` monde dans les attributs `position` Three.js (BufferGeometry).
- **Pas de recalcul métier** dans le viewer : pas de nouveau repère implicite pour les panneaux / pans / obstacles.

### Ce qui est « pur rendu »

- Tessellation, matériaux, grille, contrôles de caméra, éclairage.

### Ce qui ne doit pas être recalculé dans le viewer

- Positions des sommets monde, normales « vérité toiture », résultats shading — déjà portés par `SolarScene3D` / `RoofModel3D`.

---

## 8. Règles strictes

1. Aucun module ne doit redéfinir ses propres axes implicites pour le **chemin canonique**.
2. Aucun module ne doit convertir pixels ↔ monde « à sa sauce » sur le pipeline officiel : utiliser `**imagePxToWorldHorizontalM`** ou `**worldConvention.ts`**.
3. Toute logique 3D **nouvelle** doit respecter cette convention et `types/coordinates.ts` (WORLD vs UV pan).
4. Les directions **vers le soleil** suivent la convention documentée du near shading 3D (`directionTowardSunWorld`).

---

## 9. Legacy / compatibilité

- `**phase3Viewer.js` + `houseModelV2`** : repère **approximation** pour aperçu historique (origine `originPx`, axe vertical Three.js **Y**, horizontal **X/Z** dérivés des pixels). **Gelé** — ne pas étendre comme référence métier.
- Le **chemin canonique** reste la référence pour shading réel, exports, et `SolarScene3DViewer`.
- Migration future : réduire l’écart en réutilisant les mêmes helpers que le builder quand c’est possible, sans casser le rendu legacy tant qu’il est en service.

---

## 10. Objectif final

Chaîne cible cohérente :

**image (px) → géométrie canonique (world, m) → SolarScene3D → viewer / shading / export**

Références code :

- `docs/architecture/3d-world-convention.md` (ce document)
- `docs/architecture/calpinage-2d-3d-fidelity-level0-charter.md` (cadrage produit A vs B, témoins, critères d’acceptation)
- `docs/architecture/calpinage-2d-3d-fidelity-level4-implementation.md` (trace audit : emprise contour en m² monde dans `sourceTrace`)
- `frontend/src/modules/calpinage/canonical3d/core/worldConvention.ts`
- `frontend/src/modules/calpinage/canonical3d/types/coordinates.ts`
- `frontend/src/modules/calpinage/canonical3d/builder/worldMapping.ts`

