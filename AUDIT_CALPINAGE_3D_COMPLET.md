# AUDIT COMPLET — Pipeline Calpinage 2D → 3D

**Date** : 4 avril 2026
**Scope** : Analyse complète sans code, diagnostic des erreurs, éléments manquants, plan de corrections ordonné
**Fichiers lus** : ~15 fichiers source, ~7 000 lignes de code analysées

---

## RÉSUMÉ EXÉCUTIF

Le pipeline 2D→3D produit des toitures plates ou des hauteurs incohérentes à cause de **5 erreurs en cascade** et **3 éléments structurels manquants**. La plus critique est dans `pans-bundle.js` ligne 804 : **tous les sommets sans hauteur explicite reçoivent `h = 0`**, ce qui contamine `fitPlane()` et produit un plan quasi-horizontal. Même si les hauteurs étaient correctes, le système n'a **aucun solveur d'inclinaison global** — la pente n'existe que si les sommets ont des Z distincts. Enfin, **aucune géométrie de murs/façades** n'existe dans le modèle de données.

---

## SECTION 1 — CHAÎNE COMPLÈTE 2D → 3D (qui fait quoi)

### 1.1 Flux de données

```
CALPINAGE_STATE (window)
  │
  ├─ .roof.roofPans[]          (polygones image px + .h sur chaque point)
  ├─ .roof.scale.metersPerPixel
  ├─ .roof.roof.north.angleDeg
  ├─ .ridges[]                 (faîtages : a{x,y,h?}, b{x,y,h?})
  ├─ .traits[]                 (arêtes/noues)
  ├─ .roof.image.dataUrl       (satellite capturée)
  │
  ▼
Inline3DViewerBridge.tsx
  ├─ extractGroundImage() → lit state.roof.image
  ├─ buildScene() → appelle buildSolarScene3DFromCalpinageRuntime(state)
  │
  ▼
buildSolarScene3DFromCalpinageRuntime.ts
  ├─ resolveCalpinageStructuralRoofForCanonicalChain(state)
  │   └─ Filtre ridges/traits, rejette chienAssis, longueur < 1e-3px
  ├─ mapCalpinageRoofToLegacyRoofGeometryInput(roof, structural)
  │   ├─ ESSAI 1 : calpinageStateToLegacyRoofInput(roof, structural)
  │   │   └─ Pour chaque sommet : heightM = resolveHeightAtPxRuntime() ?? resolveHeightAtPx()
  │   │       └─ resolveHeightAtPx() → window.getHeightAtXY(panId, xPx, yPx)
  │   │           └─ CalpinagePans.getHeightAtXY(panId, xPx, yPx, getStateForPans())
  │   │               └─ fitPlane(pts, mpp, state) → h = a*xM + b*yM + c
  │   └─ ESSAI 2 (fallback) : mapCalpinageRoofToLegacyRoofGeometryInputFallback()
  │       └─ defaultHeightM: 5 (TOITURE PLATE FORCÉE), pas de résolution hauteur
  │
  ├─ → LegacyRoofGeometryInput {mpp, northAngleDeg, defaultHeightM, pans[], ridges[], traits[]}
  │
  ▼
buildRoofModel3DFromLegacyGeometry(input) — LE BUILDER PRINCIPAL
  ├─ buildHeightConstraintBundle(input, ridges, traits)
  │   └─ Extrait endpoints ridges/traits avec Z (ou defaultHeightM si absent)
  │
  ├─ BOUCLE PANS :
  │   ├─ resolveZForPanCorner(xPx, yPx, heightM?, bundle, panMean, default)
  │   │   P1: heightM explicite sur le sommet polygon
  │   │   P2: Snap ridge endpoint ≤ 15px
  │   │   P3: Snap trait endpoint ≤ 15px
  │   │   P4: Interpolation le long d'un ridge/trait
  │   │   P5: Moyenne locale du pan
  │   │   P6: defaultHeightM global
  │   ├─ imagePxToWorldHorizontalM(xPx, yPx, mpp, northAngleDeg) → {x, y} monde
  │   └─ cornersWorld[i] = {x: xy.x, y: xy.y, z: resolvedZ}
  │
  ├─ ANTI-SPIKE GUARD : si zRange/xyDiag > 1.5 → aplatir à meanZ
  │
  ├─ unifyLegacyPanCornerZAcrossPans() — fusion Z inter-pans (≤6px, poids ridge>trait>explicit)
  │
  ├─ PER-PAN GEOMETRY :
  │   ├─ Newell normal → orientée vers le ciel
  │   ├─ tiltDeg = angle(normal, vertical)
  │   ├─ azimuthDeg = atan2(nx, ny)
  │   └─ → RoofPlanePatch3D
  │
  ├─ assembleRoofRidges3D — match arêtes 3D sur segments 2D ridges/traits
  ├─ interPanSharedEdges — raffinement normales ⊥ arêtes structurantes
  │
  └─ → RoofModel3D {roofVertices, roofEdges, roofRidges, roofPlanePatches}

  ▼
buildSolarScene3D(roofModel, obstacles, panels) → SolarScene3D

  ▼
SolarScene3DViewer.tsx (React Three Fiber)
  ├─ roofPatchGeometry() — fan triangulation des cornersWorld
  ├─ roofEdgesLineGeometry() — segments arêtes
  ├─ GroundPlaneTexture — image satellite au sol
  ├─ CameraFramingRig — cadrage caméra perspective/ortho
  └─ Canvas avec camera.up.set(0,0,1) pour ENU Z-up
```

---

## SECTION 2 — LES 5 ERREURS CRITIQUES (par ordre de gravité)

### ERREUR 1 — `pans-bundle.js:804` : Initialisation forcée `h = 0` sur tous les sommets

**Fichier** : `frontend/calpinage/pans-bundle.js`, ligne 804
**Code** :
```javascript
if (p.points[j] && p.points[j].h === undefined) p.points[j].h = 0;
```

**Effet** : La fonction `ensurePanPhysicalProps()` (appelée au chargement de chaque pan) force `h = 0` sur tout sommet qui n'a pas de hauteur explicite. Quand l'utilisateur dessine un contour de pan en Phase 2, les sommets sont créés **sans** `.h`. Cette ligne met donc **tous les sommets à h=0**.

**Conséquence directe** : Quand `fitPlane()` est appelé via `getHeightAtXY()` (ligne 1183), il calcule un plan de régression des moindres carrés sur des points qui ont TOUS `h=0` (ou presque tous). Le plan résultant est `{a:0, b:0, c:0}` → hauteur = 0 partout.

**Cascade** : `calpinageStateToLegacyRoofInput.ts:217` appelle `resolveHeightAtPx(panId, xPx, yPx)` qui retourne 0 via `window.getHeightAtXY` → le `heightM` de chaque sommet est 0 → le builder reçoit des sommets à Z=0 → toiture plate.

**Diagnostic visible** : "C'est tout plat" — CECI est la cause principale.

---

### ERREUR 2 — `fitPlane()` calcule en espace pixel×mpp SANS rotation Nord

**Fichier** : `pans-bundle.js`, lignes 907-923
**Code** :
```javascript
var xM = pts[i].x * metersPerPixel;
var yM = pts[i].y * metersPerPixel;
```

**Problème** : `fitPlane()` convertit les coordonnées pixel en mètres par simple multiplication (`xPx * mpp`), **sans appliquer la rotation `northAngleDeg`**. Le plan résultant `h = a*xM + b*yM + c` est donc exprimé dans le repère image tourné, pas dans le repère monde ENU.

**Ensuite** : `getHeightAtXY()` (ligne 1185-1186) fait la même chose :
```javascript
var xM = xPx * mpp, yM = yPx * mpp;
var h = plane.a * xM + plane.b * yM + plane.c;
```

**Impact** : Tant que la requête et le calcul du plan utilisent le même repère (pixel×mpp), la hauteur retournée est **cohérente en interne**. Mais si `northAngleDeg ≠ 0`, le gradient du plan (pente/azimut) est dans le mauvais repère. Pour une maison orientée différemment du Nord image, le plan de régression produit des pentes dans la mauvaise direction.

**Note** : Cette erreur est masquée quand les hauteurs sont toutes identiques (Erreur 1). Elle deviendra visible une fois l'Erreur 1 corrigée.

---

### ERREUR 3 — Fallback `defaultHeightM: 5` dans le mapper historique

**Fichier** : `integration/mapCalpinageToCanonicalNearShading.ts`, ligne 141
**Code** :
```javascript
return {
  metersPerPixel: mpp,
  northAngleDeg,
  defaultHeightM: 5,   // ← TOITURE PLATE FORCÉE
  pans,
  // ...
};
```

**Contexte** : Si `calpinageStateToLegacyRoofInput()` échoue ou retourne un résultat non exploitable, le système tombe sur `mapCalpinageRoofToLegacyRoofGeometryInputFallback()` qui utilise `defaultHeightM: 5` et **ne résout aucune hauteur par sommet**. Tous les sommets reçoivent donc Z=5m → toiture plate à 5m.

**Quand ça arrive** : Si `window.getHeightAtXY` n'est pas disponible (pans-bundle pas encore chargé, ou erreur silencieuse), le chemin riche retourne des sommets sans `heightM`, et `isExploitableLegacyRoofGeometryInput()` peut quand même passer (il ne vérifie pas les hauteurs, seulement les polygones).

**Diagnostic visible** : Toiture plate mais à 5m au-dessus du sol au lieu de 0.

---

### ERREUR 4 — L'anti-spike guard est trop agressif

**Fichier** : `buildRoofModel3DFromLegacyGeometry.ts`, lignes 88-89 et 277-294
**Seuil** : `SPIKE_RATIO_THRESHOLD = 1.5`, `SPIKE_MIN_XY_DIAG_M = 0.5`

**Problème** : Un pan de 10m de diagonale XY avec 3m de variation Z (ratio 0.3) passe. Mais si les données de hauteur sont partiellement corrigées (ex: un sommet à 10m via ridge, les autres à 0 via Erreur 1), le ratio Z-range/XY-diag peut dépasser 1.5 → le pan est aplati à la moyenne Z.

**Scénario concret** : Pan de 5m × 4m (diag ≈ 6.4m). Si un sommet est à Z=10 (ridge snap) et les 3 autres à Z=0 (Erreur 1), zRange=10, ratio=10/6.4=1.56 → SPIKE CLAMPED → Z aplati à 2.5m → pente perdue.

**Impact** : Même une correction partielle de l'Erreur 1 sera sabotée par ce garde-fou si les données restent incohérentes.

---

### ERREUR 5 — Hauteurs ridges/traits sans `.h` dans CALPINAGE_STATE

**Fichier** : `integration/mapCalpinageToCanonicalNearShading.ts`, lignes 38-55
**Code** :
```javascript
const a = rec.a as { x?: number; y?: number };
// ...
out.push({
  id: ...,
  kind: "ridge",
  a: { xPx: a.x!, yPx: typeof a.y === "number" ? a.y : 0 },
  b: { xPx: b.x!, yPx: typeof b.y === "number" ? b.y : 0 },
});
```

**Problème** : La fonction `mapStructuralRidges()` dans le mapper fallback ne lit PAS `.h` des extrémités de ridge. Les `LegacyStructuralLine2D` produites n'ont pas de `heightM` sur leurs endpoints.

**Conséquence** : Dans `heightConstraints.ts:133-134`, `resolveZForImagePoint()` est appelé sur ces endpoints :
```javascript
const z0 = resolveZForImagePoint(ln.a, globalExplicitMeanM, defaultHeightM);
```
Si `ln.a.heightM` est undefined → fallback sur `globalExplicitMeanM` → si null → `defaultHeightM` (5 ou 5.5).

**Impact** : Les faîtages ne portent pas leur vraie hauteur → les snaps P2 (ridge endpoint) donnent la hauteur par défaut au lieu de la hauteur réelle du faîtage.

**Note** : Le mapper riche (`calpinageStateToLegacyRoofInput.ts:106`) utilise `mapEndpointWithHeight()` qui ESSAIE de résoudre via `resolveHeightAtPxRuntime()` — mais celui-ci dépend de `window.getHeightAtXY` qui retourne 0 (Erreur 1) ou null.

---

## SECTION 3 — POURQUOI "IL PREND LES HAUTEURS DU SOL (DEPUIS LA MER)"

### Source : `window.getHeightAtXY` vs DSM terrain

Il y a deux sources de hauteurs possibles :

1. **`window.getHeightAtXY(panId, xPx, yPx)`** — `pans-bundle.js:1175` — retourne `fitPlane()` basé sur les `.h` des sommets du pan. Problème : ces `.h` sont à 0 (Erreur 1).

2. **Données DSM/terrain** — si le système a des données d'élévation du terrain (MNT/DSM), les hauteurs sont en mètres au-dessus du niveau de la mer (ex: 350m pour une maison à Lyon).

**Le scénario "hauteurs depuis la mer"** se produit quand :
- `state.getVertexH` est défini sur le state passé à `fitPlane()` (ligne 820 pans-bundle)
- Cette fonction `getVertexH` retourne les hauteurs DSM du terrain au lieu des hauteurs relatives du bâtiment
- Le plan ajusté produit alors des Z entre 300-400m (altitude terrain) au lieu de 0-10m (hauteur bâtiment)
- Le builder reçoit des Z de 350m → `worldZOriginShiftM` compense partiellement, mais la géométrie est corrompue

**Condition** : Cela dépend de la façon dont `getStateForPans()` (appelé ligne 5705 de `calpinage.module.js`) construit le state passé à `CalpinagePans.getHeightAtXY`. Si ce state inclut un `getVertexH` qui lit les données terrain, les hauteurs sont contaminées.

---

## SECTION 4 — POURQUOI PAS DE MAISON RECONNAISSABLE (même avec hauteurs correctes)

### 4.1 Pas de solveur d'inclinaison global

**Fait** : Le builder (`buildRoofModel3DFromLegacyGeometry.ts`) n'a **aucun algorithme** pour déduire la pente d'un pan. La pente résulte UNIQUEMENT de la variation de Z entre les sommets du polygone.

**Concrètement** :
- Si sommets = [{x:0,y:0,z:5}, {x:10,y:0,z:5}, {x:10,y:8,z:5}, {x:0,y:8,z:5}] → **Newell normal = (0,0,1)** → tilt = 0° → PAN PLAT
- Pour avoir tilt = 30° sur ce pan, il faudrait que les sommets côté faîtage soient à Z ≈ 9.6m et côté gouttière à Z ≈ 5m

**Ce qui manque** : Un solveur qui, connaissant le faîtage (position + hauteur) et les gouttières (position + hauteur), calcule automatiquement le Z de chaque sommet par projection sur le plan incliné.

### 4.2 `tiltDegHint` et `azimuthDegHint` sont ignorés par le builder

**Fichier** : `calpinageStateToLegacyRoofInput.ts`, lignes 227-228 et `legacyInput.ts`

Les champs `tiltDegHint` et `azimuthDegHint` existent dans `LegacyPanInput`. Le builder les utilise (lignes 394-395, 415 de `buildRoofModel3DFromLegacyGeometry.ts`) mais **uniquement pour remplir les champs métadonnées** `tiltDeg` et `azimuthDeg` du `RoofPlanePatch3D` — ils n'influencent NI les `cornersWorld`, NI la `normal`, NI l'`equation` du plan. Résultat : le patch peut afficher `tiltDeg: 30` (via le hint) alors que sa géométrie réelle est plate (tous les Z identiques, normale verticale). C'est une **incohérence trompeuse** entre métadonnées et géométrie.

### 4.3 Pas de murs / façades dans le modèle

**Type** : `RoofModel3D` (fichier `canonical3d/types/model.ts`)

Le modèle contient :
- `roofVertices` — sommets 3D
- `roofEdges` — arêtes entre sommets
- `roofRidges` — polylignes de faîtage
- `roofPlanePatches` — faces planaires du **toit uniquement**
- `roofObstacles` — cheminées, VMC, etc.
- `roofExtensions` — lucarnes, chien-assis

**Ce qui manque** : Aucun type `RoofWall3D`, `BuildingFacade3D`, ou `GutterLine3D`. Le viewer ne peut dessiner que les faces du toit, pas les murs de la maison. Sans murs, même avec des pans inclinés corrects, la structure ressemble à des triangles flottants, pas à une maison.

### 4.4 Pas de ligne de gouttière explicite

Les gouttières (éaves) sont détectées implicitement par le rôle des sommets (`role: "eave"`) et des arêtes (`semantic.kind: "eave"`), mais il n'y a pas de structure dédiée "ligne de gouttière à Z=Xm" qui forcerait les sommets bas à une altitude donnée.

---

## SECTION 5 — VÉRIFICATION DU REPÈRE COORDONNÉES

### 5.1 Mapping image → monde

**`worldMapping.ts:17-30`** :
```
x0 = xPx * mpp
y0 = -yPx * mpp          (Y inversé : image Y-down → monde Y-up)
θ = northAngleDeg × π/180
x = x0·cos(θ) - y0·sin(θ)
y = x0·sin(θ) + y0·cos(θ)
```
**Résultat** : coordonnées ENU (X=Est, Y=Nord) en mètres, origine = pixel (0,0) de l'image.

### 5.2 Monde → Three.js

**`unifiedWorldFrame.ts`** : `worldMetersToThreeJsPosition(x,y,z) → {x:x, y:y, z:z}` — IDENTITÉ. Pas de swap Y↔Z.

**`SolarScene3DViewer.tsx`** : `camera.up.set(0,0,1)` compense le fait que Three.js utilise Y-up par défaut. Le Z-up ENU est donc respecté.

### 5.3 Image satellite → plan sol

**`GroundPlaneTexture.tsx`** : `computeGroundPlacement()` utilise la même formule que `imagePxToWorldHorizontalM` pour placer la texture. L'alignement 2D/3D est mathématiquement correct.

**Conclusion repère** : Le système de coordonnées est cohérent. L'image et la géométrie sont au même endroit. Le problème n'est PAS un décalage de coordonnées.

---

## SECTION 6 — CE QUI FONCTIONNE CORRECTEMENT

Pour être complet, voici ce qui est bien implémenté :

1. **Conversion pixel→monde** (`imagePxToWorldHorizontalM`) : formule correcte avec rotation Nord
2. **Newell normal** (`planePolygon3d.ts`) : calcul robuste de la normale sur polygone 3D
3. **Unification Z inter-pans** (`unifyLegacyPanSharedCornersZ.ts`) : algorithme Union-Find correct, poids cohérents
4. **Fan triangulation** (`solarSceneThreeGeometry.ts`) : tessellation correcte pour l'affichage
5. **CameraFramingRig** : cadrage caméra fonctionnel en mode SCENE_3D
6. **GroundPlaneTexture** : positionnement satellite correct
7. **Pipeline diagnostic** (`dumpPipelineDiagnostics`) : logging complet pour debug
8. **Architecture adaptateur** : séparation propre entre state runtime et modèle canonique

---

## SECTION 7 — ÉLÉMENTS À AJOUTER pour rendre une maison

### 7.1 Solveur de pente par pan (PRIORITÉ 1)

Algorithme nécessaire : étant donné un pan (polygone 2D) + un faîtage (segment avec Z) + une gouttière (segment avec Z), calculer le Z de chaque sommet du pan par projection sur le plan défini par ces contraintes.

Entrées : position 2D du faîtage, hauteur faîtage, position 2D gouttière, hauteur gouttière.
Sortie : Z de chaque sommet du polygone pan.

Ce solveur remplacerait la résolution P1-P6 actuelle qui ne fonctionne que si les hauteurs explicites sont correctement renseignées.

### 7.2 Géométrie des murs (PRIORITÉ 2)

Pour chaque arête de type "eave" (gouttière), générer un quad vertical allant de Z=sol (0 ou altitude terrain) à Z=gouttière. Cela crée les façades de la maison.

Type nécessaire : `BuildingWall3D { vertices: Vector3[4], normal: Vector3, adjacentPatchId: string }`

### 7.3 Ligne de gouttière explicite (PRIORITÉ 3)

Structure dédiée qui porte la hauteur de la gouttière pour chaque pan. Aujourd'hui, la gouttière est implicite (c'est le bord du pan qui n'est pas un faîtage). Il faudrait une annotation explicite `GutterLine3D { panId, height, endpoints }` qui force les sommets bas du pan à cette altitude.

### 7.4 Plan sol / empreinte bâtiment (PRIORITÉ 4)

Pour que la maison ait un "pied", il faut une face horizontale à Z=0 (ou Z=sol) couvrant l'empreinte du bâtiment. Aujourd'hui, le sol est uniquement la texture satellite — il n'y a pas de géométrie de sol opaque.

---

## SECTION 8 — PLAN DE CORRECTIONS (ordonné)

### Étape 1 — Corriger l'initialisation `h=0` (BLOQUANT)

**Fichier** : `pans-bundle.js:804`
**Action** : Ne PAS forcer `h = 0` sur les sommets sans hauteur. Laisser `h = undefined` ou `h = null`. Adapter `getH()` (ligne 814) pour retourner `null` au lieu de `0` si `h` n'est pas défini.
**Impact** : `fitPlane()` devra ignorer les points sans `h` dans sa régression. Il faut modifier `fitPlane()` pour ne compter que les points avec `h ≠ null/undefined` dans les sommes.
**Risque** : `fitPlane()` avec 0 points valides retournera `null` → `getHeightAtXY` retournera `null` → fallback sur `defaultHeightM`. C'est le comportement attendu.

### Étape 2 — Propager les hauteurs explicites du dessin 2D

**Contexte** : Quand l'utilisateur dessine un faîtage en Phase 2, il peut saisir une hauteur (ex: 9m). Cette hauteur doit arriver jusqu'au modèle 3D.
**Vérifier** : Que `CALPINAGE_STATE.ridges[].a.h` et `.b.h` portent bien les hauteurs saisies.
**Vérifier** : Que `mapEndpointWithHeight()` (`calpinageStateToLegacyRoofInput.ts:76`) lit bien `.h` en plus de `.x` et `.y`.
**Action si manquant** : Ajouter la lecture de `rec.a.h` / `rec.b.h` dans les mappers de ridges/traits.

### Étape 3 — Implémenter le solveur de pente par pan

**Principe** : Pour chaque pan, identifier le faîtage adjacent (ridge) et la gouttière opposée (arête la plus éloignée du ridge). Construire le plan incliné passant par le faîtage (à Z=hauteur_faitage) et la gouttière (à Z=hauteur_gouttiere). Projeter chaque sommet du pan sur ce plan pour obtenir son Z.
**Où** : Nouveau module `canonical3d/builder/panSlopeSolver.ts`
**Quand** : Appelé après `buildHeightConstraintBundle()` et avant la boucle de résolution Z par sommet.

### Étape 4 — Vérifier le seuil anti-spike

**Fichier** : `buildRoofModel3DFromLegacyGeometry.ts:88`
**Action** : Après correction des Étapes 1-3, re-valider si `SPIKE_RATIO_THRESHOLD = 1.5` est approprié. Un toit à 45° a un ratio de ~1.0 (Z-range ≈ XY-extent/2). Le seuil de 1.5 semble correct pour des cas normaux, mais il faut s'assurer que la correction partielle (certains sommets à Z correct, d'autres en fallback) ne déclenche pas de faux positifs.
**Test** : Créer un cas test avec un pan de 8m×6m, faîtage à 10m, gouttière à 6m → ratio = 4/10 = 0.4 → OK. Cas avec données partielles : Z={10, 10, 5.5, 5.5} → ratio=4.5/10=0.45 → OK aussi.

### Étape 5 — Ajouter la géométrie des murs

**Où** : Nouveau type + builder `canonical3d/builder/buildWalls3D.ts`
**Principe** : Pour chaque arête `eave` du `RoofModel3D`, générer un quad vertical de Z=0 à Z=eave.
**Affichage** : Ajouter un renderer dans `SolarScene3DViewer.tsx` (comme `obstacleVolumeGeometry` mais pour les murs).

### Étape 6 — Valider le rendu 3D de bout en bout

**Test minimal** : Maison rectangulaire simple, 2 pans symétriques, 1 faîtage au milieu.
**Attendu** : Deux triangles inclinés formant un toit en A, avec 4 murs verticaux, posés sur le sol, alignés avec l'image satellite.

---

## SECTION 9 — MATRICE DE TRAÇABILITÉ DES ERREURS

| Symptôme | Erreur(s) | Fichier(s) | Ligne(s) |
|----------|-----------|------------|----------|
| Toiture plate (Z=0) | E1 + E3 | pans-bundle.js + mapCalpinage...ts | 804 + 141 |
| Hauteurs mer/terrain | E1 + state.getVertexH | pans-bundle.js + calpinage.module.js | 820 + 5703 |
| Pas de pente visible | E1 + absence solveur | pans-bundle.js + buildRoofModel3D | 804 + §4.1 |
| Pente aplatie | E4 | buildRoofModel3D | 283-294 |
| Faîtage sans hauteur | E5 | mapCalpinage...ts | 38-55 |
| Pas de murs | Manquant §7.2 | — | — |
| Pas de gouttière | Manquant §7.3 | — | — |

---

## SECTION 10 — FICHIERS IMPACTÉS PAR LES CORRECTIONS

| Étape | Fichier | Action |
|-------|---------|--------|
| 1 | `frontend/calpinage/pans-bundle.js` | Modifier lignes 804, 814-816, 907-923 |
| 1 | `frontend/src/modules/calpinage/adapter/resolveHeightsFromRuntime.ts` | Vérifier gestion du `null` retourné |
| 2 | `frontend/src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts` | Vérifier lecture `.h` sur ridges |
| 2 | `frontend/src/modules/calpinage/integration/mapCalpinageToCanonicalNearShading.ts` | Ajouter lecture `.h` dans mapStructuralRidges |
| 3 | **NOUVEAU** `canonical3d/builder/panSlopeSolver.ts` | Solveur de pente |
| 3 | `canonical3d/builder/buildRoofModel3DFromLegacyGeometry.ts` | Intégrer le solveur avant résolution Z |
| 4 | `canonical3d/builder/buildRoofModel3DFromLegacyGeometry.ts` | Revalider SPIKE_RATIO_THRESHOLD |
| 5 | **NOUVEAU** `canonical3d/types/wall.ts` | Type BuildingWall3D |
| 5 | **NOUVEAU** `canonical3d/builder/buildWalls3D.ts` | Builder murs |
| 5 | `canonical3d/viewer/SolarScene3DViewer.tsx` | Renderer murs |
| 5 | `canonical3d/viewer/solarSceneThreeGeometry.ts` | wallGeometry() |

---

**FIN DE L'AUDIT**

Cet audit est basé sur la lecture directe de ~15 fichiers source totalisant ~7 000 lignes. Aucun code n'a été modifié. Chaque erreur est traçable à un fichier et une ligne précise. Le plan de corrections est ordonné par dépendance : chaque étape débloque la suivante.
