# Cartographie officielle — sources de hauteur / Z (Calpinage & Canonical 3D)

**Date :** 2026-04-03  
**Nature :** audit / cartographie uniquement (aucune modification de logique métier requise par ce document).  
**Périmètre :** runtime calpinage (legacy + bundles), adaptateurs → `LegacyRoofGeometryInput`, pipeline `canonical3d`, GeoEntity3D, ombrage proche/lointain, persistance backend où la hauteur transite.

**Référentiel vertical canonique (rappel) :** Z monde en **mètres**, repère **ENU Z-up**, origine Z = « niveau de référence chantier » implicite du runtime (pas d’altitude ellipsoïdale WGS84 dans ces champs). Voir `docs/architecture/3d-world-convention.md` et `canonical3d/builder/legacyInput.ts` (commentaire sur `heightM`).

---

## Synthèse exécutive

| Besoin | Source(s) autorisée(s) (sous contrat) |
|--------|----------------------------------------|
| Sommets 3D de la toiture (pans) | `LegacyImagePoint2D.heightM` sur chaque sommet du polygone pan **ou** Z issu de `heightConstraints.resolveZForPanCorner` (hiérarchie explicite → ridges/traits → moyennes → `defaultHeightM`). En amont runtime : **`pans[].points[].h`** (+ équivalents structurants **`h`** sur ridges/traits/contours) alimentent le résolveur ; **`getHeightAtXY`** n’est qu’une **interpolation plan** à partir de ces hauteurs sommet. |
| Obstacles ombrants (prisme vertical) | **`heightM`** résolu par `readExplicitHeightM` / catalogue / défauts **documentés** ; **base** du prisme : `resolveHeightAtXY` (ou équivalent) au sol du pan, pas une hauteur « décor ». |
| Extensions / lucarnes (volume simplifié) | **`ridgeHeightRelM`** comme hauteur d’extrusion **au-dessus du plan toit** local (même sémantique qu’« élévation au-dessus de la base résolue ») ; base Z par sommet via `resolveHeightAtXY`. |
| Panneaux PV (dimensions module) | **`widthM` / `heightM`** catalogue (envergure du module), **distinct** de toute altitude. Pose 3D : quad sur plan pan (Z dérivé du pan). |
| Ombrage lointain | **`elevation_deg`** horizon / soleil = **angles**, pas des hauteurs métriques bâtiment. |
| Prévisualisation legacy `houseModelV2` | **Ne pas** confondre l’axe Three.js `z` obtenu par `yPx * mpp` avec la **Z altitude canonique** ; repère legacy spécifique au viewer gelé. **Ne pas** utiliser ce viewer comme vérité produit (Prompt 30) — voir `legacy-3d-fallback-sunset.md`. |

---

## Fichiers scannés (inventaire principal)

- **Bundles / legacy exécution :** `frontend/public/calpinage/pans-bundle.js`, `frontend/calpinage/pans-bundle.js` (alignés), `frontend/calpinage/panelProjection.js`, `frontend/calpinage/shading/computeObjectZ.js`, `frontend/src/modules/calpinage/legacy/calpinage.module.js`
- **Résolution Z canonique injectable :** `frontend/src/modules/calpinage/core/heightResolver.ts`
- **Adaptateur état → entrée builder :** `frontend/src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts`, `frontend/src/modules/calpinage/adapter/resolveHeightsFromRuntime.ts` (référencé)
- **Builder toiture 3D :** `frontend/src/modules/calpinage/canonical3d/builder/buildRoofModel3DFromLegacyGeometry.ts`, `frontend/src/modules/calpinage/canonical3d/builder/heightConstraints.ts`, `frontend/src/modules/calpinage/canonical3d/builder/legacyInput.ts`, `frontend/src/modules/calpinage/canonical3d/builder/worldMapping.ts`
- **Adaptateurs 3D runtime :** `frontend/src/modules/calpinage/canonical3d/adapters/buildCanonicalPans3DFromRuntime.ts`, `frontend/src/modules/calpinage/canonical3d/adapters/buildCanonicalObstacles3DFromRuntime.ts`, `frontend/src/modules/calpinage/canonical3d/buildSolarScene3DFromCalpinageRuntime.ts`
- **Catalogue / normalisation entités :** `frontend/src/modules/calpinage/catalog/roofObstacleRuntime.ts`, `frontend/src/modules/calpinage/catalog/roofObstacleCatalog.ts` (référencé par runtime), `frontend/src/modules/calpinage/geometry/geoEntity3D.ts`
- **Legacy viewer maison :** `frontend/src/modules/calpinage/geometry/houseModelV2.ts`
- **Types scène :** `frontend/src/modules/calpinage/canonical3d/types/solarScene3d.ts`, `frontend/src/modules/calpinage/canonical3d/types/roof-extension-volume.ts`
- **Intégration / persistance :** `frontend/src/modules/calpinage/integration/mapCalpinageToCanonicalNearShading.ts`, `backend/services/shading/calpinageShading.service.js`, `backend/calpinage/schema/calpinage.v1.json`
- **Documentation contrat :** `docs/architecture/3d-world-convention.md`, `docs/architecture/3d-restart-contract.md`

Recherche complémentaire recommandée (hors chemin critique toit) : DSM / radar horizon (`frontend/src/modules/calpinage/dsmOverlay/`) — uniquement angles soleil / masque horizon.

---

## Tableau officiel des sources de hauteur

Légende **Pipeline canonique :** `UTILISER` = vérité ou dérivé officiellement prévu ; `UTILISER SOUS CONTRAT` = ok si contraintes respectées (traçabilité, pas confusion d’unité) ; `INTERDIRE` = ne pas utiliser comme vérité primaire de construction 3D métier.

| Nom / concept | Fichier(s) / fonction(s) | Type | Représentation physique | Référentiel | Unité | Stocké / dérivé | Source / dépendance | Fiabilité 3D maison | Pipeline canonique | Risques / ambiguïts | Recommandation |
|---------------|--------------------------|------|-------------------------|-------------|-------|-----------------|---------------------|---------------------|-------------------|---------------------|----------------|
| **`pans[].points[].h`** (`point.h`) | `pans-bundle.js` `ensurePanPhysicalProps`, `setPointHeight`, UI panneau ; état `CALPINAGE_STATE.pans` | nombre sur sommet polygone pan | Cote verticale du **sommet de pan** au **zéro chantier implicite** (même échelle que fitPlane). | Absolu « projet » (Z-up métrique locale) | m | **Stocké** (défaut `0` si absent) | Saisie utilisateur / édition sommet ; outils pente manuelle (`applyManualSlopeToPan`) | **OUI** (sommet porteur du plan toit) | **UTILISER** | Confusion si pan n’a que `polygon` sans `h` (`getPanPoints` fabrique `h:0`). | Source primaire pour le **plan pan** ; synchroniser les pans adjacents via `syncCommonHeights`. |
| **`contours[].points[].h`, `ridges[].a|b.h`, `traits[].a|b.h`** | `heightResolver.getExplicitHeightAtPoint` ; état `CALPINAGE_STATE` / `structural` | nombre sur point structurant | Même convention que `point.h` : cote au zéro projet. | Absolu projet | m | Stocké | Dessin phase 2 / structure toit | **OUI** | **UTILISER** | Exclus `roofRole === "chienAssis"` du scan P1. | Priorité P1 du résolveur ; **souverain** si snap px réussi. |
| **`LegacyImagePoint2D.heightM`** | `legacyInput.ts` ; produit par `calpinageStateToLegacyRoofInput` | champ optionnel sommet | Hauteur au sommet pour le **builder** `buildRoofModel3DFromLegacyGeometry`. | Absolu projet | m | **Dérivé** (adaptateur) ou fourni par fichier import | `resolveHeightAtPxRuntime` → `resolveHeightAtXY` (P1→P4) ou import externe | **OUI** | **UTILISER** | Absence → interpolation `heightConstraints` / défaut. | **Contrat d’entrée officiel** du builder toiture. |
| **`getHeightAtXY(panId, xPx, yPx, state)`** | `CalpinagePans.getHeightAtXY` dans `pans-bundle.js` | fonction → nombre \| null | **Évaluation du plan moindres carrés** \(h = a x_M + b y_M + c\) aux coordonnées horizontales du point. | Absolu projet | m | **Dérivé** | Sommets `getVertexH(pt,state)` → `fitPlane` | **OUI sous conditions** (si ≥2 sommets valides et plan non dégénéré) | **UTILISER SOUS CONTRAT** | **N’est pas** une mesure indépendante : **rejoue** les hauteurs sommet ; plan peut lisser / biaiser si résiduel. Log console DEV dans bundle public. | **Dérivé autorisé**, jamais vérité primaire seule ; toujours tracer les `point.h` sources. |
| **`fitPlane` (interne pans)** | `pans-bundle.js` `fitPlane` | objet `{a,b,c}` | Modèle plan du pan dans l’espace (x_m, y_m, h). | Paramétrique | m | Dérivé | `points[].h` (via `getVertexH`) | **OUI** (modèle) | **UTILISER SOUS CONTRAT** | Déterminant ~0 → plan null. | Même statut que `getHeightAtXY`. |
| **`physical.slope.valueDeg` / `computedDeg` / `mode`** | `pans-bundle.js` `recomputePanPhysicalProps`, `applyManualSlopeToPan` ; `calpinage.module.js` persistance UI | structure | **Angle de pente** (toit) estimé ou forcé ; **pas** une coordonnée Z. | Géométrie angulaire | deg | Stocké + dérivé (`computedDeg` depuis Δh/Δrun) | Géométrie `h` des sommets ; UI | **NON** (pas une hauteur) | **UTILISER SOUS CONTRAT** | Peut diverger légèrement du polygone 3D final si normale issue de Newell. | Sert **métadonnées** et **panelProjection** ; reconstruction 3D **via Z sommets / normale**, pas via seul `tiltDeg`. |
| **`physical.orientation.azimuthDeg` / `label`** | idem + `calpinage.module.js` | structure | **Azimut horizontal** du sens de pente / orientation pan. | Angles horizontaux | deg | Stocké + dérivé | Géométrie + nord image | **NON** | **UTILISER SOUS CONTRAT** | — | Pour ombrage / pose modules ; pas Z. |
| **`pan.tiltDeg` / `pan.azimuthDeg`** | sync depuis `physical` dans `pans-bundle.js` | nombre | Miroir des champs physiques pour APIs legacy. | deg | Stocké | Copie depuis `physical` | **NON** (hauteur) | **UTILISER SOUS CONTRAT** | Duplication de vérité — risque de désalignement si écriture directe. | Ne pas les utiliser comme **seule** source 3D Z. |
| **`LegacyRoofGeometryInput.defaultHeightM`** | `legacyInput.ts` ; passé au builder | nombre | **Z de repli** si aucune contrainte plus forte sur un sommet. | Absolu projet | m | Paramètre d’entrée | Config adaptateur (ex. 5.5 m par défaut) | **NON** (approximation) | **UTILISER SOUS CONTRAT** | Toiture « plate » apparente si tout est fallback. | Exiger diagnostic `HEIGHT_FALLBACK_*` côté builder. |
| **Hiérarchie `resolveZForPanCorner`** | `heightConstraints.ts` | fonction | Combine `heightM` explicite polygone, snap ridges/traits, interpolation segments, moyennes, défaut. | Absolu projet | m | Dérivé | `LegacyRoofGeometryInput` + segments structurants | **OUI** | **UTILISER** | Complexité — plusieurs tiers de confiance. | **Cœur de la vérité Z** pour `buildRoofModel3DFromLegacyGeometry`. |
| **`heightM` obstacle runtime** | `roofObstacleRuntime.readExplicitHeightM` ; entités `CALPINAGE_STATE.obstacles` | nombre | **Hauteur d’extrusion verticale** du prisme obstacle (souvent « au-dessus du toit » local). | Relatif à la base résolue sur le pan | m | Stocké ou défaut catalogue | Utilisateur / `height.heightM` / `heightRelM` / `height` / `ridgeHeightRelM` | **OUI** (volume ombrant simplifié) | **UTILISER SOUS CONTRAT** | `ridgeHeightRelM` lu aussi pour obstacles génériques — **surcharge sémantique** du champ. | Toujours coupler avec **base Z** résolue au footprint. |
| **`ridgeHeightRelM` (roofExtensions)** | `calpinage.module.js`, `buildCanonicalObstacles3DFromRuntime.resolveObstacleHeightDetailed` | nombre | **Hauteur de l’extension** au-dessus du plan toit (lucarne / chien-assis). | Relatif au toit local | m | Stocké | Saisie utilisateur | **OUI** (pour prisme simplifié) | **UTILISER SOUS CONTRAT** | Lucarnes complètes réduites à prisme : message diagnostic `DORMER_SIMPLIFIED_*`. | Ne pas confondre avec altitude absolue faîtage. |
| **Catalogue `defaultHeightM` obstacles** | `roofObstacleCatalog` + `resolveObstacleHeightDetailed` | nombre | Défaut métier par type d’obstacle. | m | Dérivé config | Catalogue | **OUI sous conditions** | **UTILISER SOUS CONTRAT** | — | Traçabilité `heightSource` obligatoire. |
| **`LEGACY_2D_OBSTACLE_NEAR_SHADING_HEIGHT_M` / shadow defaults** | `roofObstacleRuntime`, `buildCanonicalObstacles3DFromRuntime` | constante | Valeur de secours historique (~1 m) si aucune meta. | m | Dérivé politique | Code | **NON** comme vérité bâtiment | **UTILISER SOUS CONTRAT** | Risque juridique / physique si présenté comme mesure réelle. | Marquer **fallback** dans tout export client. |
| **`baseVertices3D[].zWorldM` / `topVertices3D[].zWorldM`** | `buildCanonicalObstacles3DFromRuntime` | nombre | Base = Z résolu par `resolveHeightAtXY` ; top = base + `heightM`. | Absolu projet | m | Dérivé | Résolveur + hauteur obstacle | **OUI** | **UTILISER** | `baseZUnreliable` si fallbacks dominent. | Agrégats `baseZWorldM` / `topZWorldM` = moyennes diagnostics. |
| **`CanonicalPanVertex3D.zWorldM` / `heightM`** | `buildCanonicalPans3DFromRuntime` | nombre | Redondance documentée : **Z monde = heightM** dans le repère projet (origine Z=0). | Absolu projet | m | Dérivé | `resolveHeightAtXY` par sommet | **OUI** | **UTILISER** | — | Vérité pan pour scène canonique. |
| **`GeoEntity3D.baseZWorldM`** | `geoEntity3D.getBaseZWorldM` | nombre | Z au centroid footprint via `resolveHeight` ou legacy `getHeightAtXY(x,y)`. | Absolu projet | m | Dérivé | Contexte injection | **OUI sous conditions** | **UTILISER SOUS CONTRAT** | **0** si aucun contexte (**non silencieux** documenté). | Toujours passer un **contexte résolveur** pour données sérieuses. |
| **`GeoEntity3D.heightM`** | `normalizeToGeoEntity3D` | nombre | Hauteur entité selon type (obstacle, volume, 0 pour pan surface…). | m | Dérivé | `resolveGeoEntityHeightM` | **OUI** selon type | **UTILISER SOUS CONTRAT** | — | |
| **`computeObjectZ.baseZ` / `topZ`** | `calpinage/shading/computeObjectZ.js` | paire | `baseZ` = `getHeightAtXY(x,y)` **signature 2 paramètres** ; `topZ` = base + `heightM`. | Absolu + offset | m | Dérivé | Wrapper ombrage | **INCERTAIN** si `getHeightAtXY` legacy attend `(panId,x,y)` — **vérifier l’appelant** : mismatch possible → baseZ=0. | **UTILISER SOUS CONTRAT** | **À verrouiller par test** (voir section tests). |
| **`placedPanels[].widthPx` / `heightPx`** | `calpinage.module.js` | nombre | Dimensions **image** du rectangle panneau posé. | Image px | px | Stocké | Moteur placement | **NON** | **INTERDIRE** (comme hauteur physique) | — | Uniquement collision / UI 2D. |
| **Catalogue panneau `heightM` (module)** | `calpinage.module.js` (dims panneau PV), `canonical3d` validation panels | nombre | **Dimension physique du module** (bord long/court selon orientation). | Métrique objet | m | Catalogue | Fournisseur | **NON** (altitude) | **UTILISER** pour surface module uniquement | Confusion avec Z toit. | Nommer explicitement `moduleHeightM` dans futurs schémas si besoin. |
| **`obstaclesFar[].heightM` + `point`** | `backend/calpinage/schema/calpinage.v1.json` | nombre + point | Hauteur d’obstacle **lointain** pour shading persistant — **pas** la toiture dessinée. | Échelle locale étude | m | Stocké persisté | Import / étude | **NON** pour toiture | **INTERDIT** comme Z toit | Contexte ombrage lointain uniquement. | Pipeline toit **ignore** ou sépare explicitement. |
| **Horizon `elevation_deg` / soleil `elevationDeg`** | `calpinage.module.js`, `dsmOverlay`, `nearShadingHorizonWeighted.ts` | nombre | **Angle** au-dessus de l’horizon. | Sphérique / ciel | deg | Donnée météo / masque | Calculs solaires | **NON** | **INTERDIT** comme altitude bâtiment | — | |
| **`houseModelV2` footprint `z` (Three)** | `houseModelV2.ts` `pxToWorld` | nombre | **Axe profondeur Three.js** = `yPx` image × mpp, **pas** la Z ENU canonique. | Repère viewer legacy | m (mais axe permuté) | Dérivé | Viewer phase3 | **NON** pour contrat canonique | **INTERDIT** comme vérité `RoofModel3D` | Double convention axes. | Migration viewer : utiliser `SolarScene3D` / mapping documenté. |
| **`meta.pointsWithHeights` (GeoEntity3D)** | `geoEntity3D.normalizeToGeoEntity3D` | trace | Copie des `h` sur points pan pour audit. | — | m | Dérivé | points pan | **OUI** (preuve) | **UTILISER SOUS CONTRAT** | Méta seulement. | Ne pas reconstruire la toiture **uniquement** depuis meta exportée sans polygone complet. |

---

## Classement par familles

### A. Hauteurs toiture réellement exploitables

- **`pans[].points[].h`** (et équivalents explicites sur lignes structurantes : **`h`** sur `ridges` / `traits` / `contours`).
- **`LegacyImagePoint2D.heightM`** une fois l’adaptateur appliqué.
- **Résultat de `resolveZForPanCorner`** dans `buildRoofModel3DFromLegacyGeometry` (agrégation contraintes + défauts).

### B. Hauteurs relatives d’objets posés sur la toiture

- **`heightM`** d’obstacle (extrusion au-dessus de la base toit résolue).
- **`ridgeHeightRelM`** pour **roofExtensions** (hauteur au-dessus du toit).
- **`heightRelM`** / variantes lues par `readExplicitHeightM` quand présentes.

### C. Valeurs dérivées utiles mais non souveraines

- **`getHeightAtXY`** / **`fitPlane`** (interpolation plan à partir des sommets).
- **`resolveHeightAtXY`** (`heightResolver.ts`) — orchestration P1–P4.
- **`baseZWorldM` / topZ** dans les adaptateurs 3D (dérivés résolveur + offset).
- **Moyennes** `computePanExplicitMeanM` / `computeGlobalExplicitMeanFromPans`.

### D. Valeurs descriptives mais non géométriques (pas des « hauteurs »)

- **`physical.slope`**, **`tiltDeg`**, **`physical.orientation`**, **`azimuthDeg`** (angles).
- **Angles soleil / horizon** (`elevation_deg`, `elevationDeg`).

### E. Valeurs dangereuses / ambiguës / interdites comme vérité primaire

- **`heightPx` / `widthPx`** des panneaux placés (2D seulement).
- **`houseModelV2`** coordonnées **sans** alignement sur ENU Z-up officiel.
- **`obstaclesFar.heightM`** pour reconstruire la toiture principale.
- **Fallbacks legacy non qualifiés** (`LEGACY_*_DEFAULT`) présentés comme mesures terrain.
- **Utiliser seul `tiltDeg`** sans polygone 3D ou sans Z sommets.
- **Confondre** `ridgeHeightRelM` sur un **obstacle** vs sur une **extension** (même clé, contextes différents).

---

## Conflits / ambiguïts détectés

1. **`getHeightAtXY` : deux signatures** — API officielle pans : `(panId, xPx, yPx, state)` ; `computeObjectZ` attend `(x, y)` **deux arguments** : **INCERTAIN** sans audit de tous les call sites — risque de `baseZ = 0` silencieux.
2. **`ridgeHeightRelM`** : lu à la fois pour **extensions** et dans **`readExplicitHeightM`** pour entités génériques — même nom, **sémantique « hauteur au-dessus du support »** ; l’altitude absolue reste **base résolue + offset**.
3. **`point.h` vs `polygon` sans `h`** : `getPanPoints` mappe `polygon` → `h:0` artificiel — plan faux si seul `polygon` est peuplé.
4. **Log `console.log` dans `getHeightAtXY`** (`pans-bundle.js` L1188) : bruit / perf ; pas une ambiguïté physique mais pollution diagnostic.
5. **Duplication `tiltDeg` / `physical.slope.valueDeg`** : deux champs reflétant la même intention métier.
6. **Builder `EXTENSIONS_INPUT_NOT_SOLVED`** : extensions complexes non dans le maillage shell principal — Z extension géré ailleurs (volumes).

---

## Décision officielle — vérité canonique

### 3.1 Vérité autorisée pour construire la maison / toiture 3D

- **Sommets de pan** : cotes **`h`** sur **`pans[].points`** (ou `heightM` sur `LegacyImagePoint2D` après mapping).
- **Contraintes structurantes** : **`h`** sur extrémités **ridges / traits** (et points de **contours** pertinents) intégrées via **`heightConstraints`** et **P1** de `heightResolver`.
- **Complément dérivé** : plan **`fitPlane` / `getHeightAtXY`** pour échantillonner la surface du pan **entre** sommets ou pour remplir l’adaptateur quand les sommets n’ont pas tous une cote explicite — **à condition** que les sommets portent des `h` cohérents ou qu’un défaut explicite soit assumé.
- **Paramètre global** : **`defaultHeightM`** uniquement comme **dernier** recours documenté.

**Obstacles / volumes ombrants (géométrie simplifiée)** : **`heightM`** (ou défaut catalogue traçable) + **base** = résultat **`resolveHeightAtXY`** sur le footprint (ou équivalent injecté).

**Roof extensions** : **`ridgeHeightRelM`** comme **hauteur relative** + base = résolution Z sur l’emprise.

**Panneaux PV** : dimensions **`widthM`/`heightM`** module pour la surface ; **position Z** sur le **plan du pan** (pas une « hauteur » indépendante du pan).

### 3.2 Vérité autorisée pour échantillonner une hauteur en un point (X,Y) image

- **`getHeightAtXY`** (fitPlane pans) est une **source dérivée autorisée** : elle **interpole** la vérité déjà portée par les **sommets** (`h`) [et éventuellement `state.getVertexH`].
- Elle **n’est pas** une vérité primaire indépendante du terrain : **INTERDIT** de l’ériger comme seule référence si les sommets sont vides ou à `0` arbitraire.
- Le moteur **`resolveHeightAtXY`** est la **façade canonique** : P1 explicite > fitPlane connu > hit-test > fallback.

### 3.3 Valeurs strictement interdites dans le pipeline canonique (comme vérité primaire de construction)

- **Pixels** `heightPx` / `widthPx` **comme cote métrique verticale bâtiment**.
- **Angles** (`slope`, `orientation`, `tiltDeg` seuls) **sans** surface 3D ou sans Z sommets résolus.
- **Axes legacy `houseModelV2`** mélangés à **`RoofModel3D`** sans transformation officielle.
- **`obstaclesFar.heightM`** pour la **géométrie toiture** dessinée.
- **Toute valeur Z** issue d’un **contexte résolveur absent** présentée comme mesure fiable (**baseZ = 0** fallback).

---

## Champs interdits dans le pipeline canonique

| Champ / concept | Interdiction |
|-----------------|--------------|
| `heightPx` (placement PV) | Comme **altitude** ou hauteur physique bâtiment |
| `tiltDeg` / `physical.slope` seuls | Comme **substitut** aux Z sommets pour le shell toiture |
| `houseModelV2` mapping `yPx`→Three `z` | Comme **Z ENU** canonique sans conversion |
| `obstaclesFar.heightM` | Pour **reconstruire** l’enveloppe toiture principale |
| `elevation_deg` / `elevationDeg` (soleil / horizon) | Comme **hauteur** métrique de toit ou d’obstacle |
| `baseZ` / `topZ` **sans** traçabilité de résolveur | Comme preuve client sans diagnostic de confiance |

---

## Tests minimaux à prévoir (zones INCERTAIN / verrouillage)

1. **Call graph `computeObjectZ`** : grep tous les appelants ; vérifier que la fonction `getHeightAtXY` passée est bien `(x,y) => …` avec **panId fermé** en closure ou refonte signature — **assert** `baseZ !== 0` sur pan incliné réel.
2. **Pan uniquement `polygon` sans `points`** : jeu de données → vérifier que `getHeightAtXY` / export legacy ne produisent pas un plan **zéro** alors que l’UI montre une pente.
3. **Cohérence `calpinageStateToLegacyRoofInput` vs `buildCanonicalPans3DFromRuntime`** : même sommet → même Z à ε près (mock résolveur).
4. **Obstacle avec `readExplicitHeightM` via `ridgeHeightRelM`** sur type **non-extension** : documenter le cas métier attendu (hauteur relative explicite).
5. **Persistance backend** : round-trip JSON `calpinage.v1` — `obstaclesFar` ne pollue pas la géométrie pans rechargée.

---

## Traçabilité rapide (qui écrit / qui lit)

| Donnée | Écriture typique | Lecture typique |
|--------|------------------|-----------------|
| `point.h` | UI calpinage / `setPointHeight` / `applyManualSlopeToPan` | `fitPlane`, `getHeightAtXY`, `heightResolver` P1 (via contours équivalents si présents) |
| `Legacy heightM` | `calpinageStateToLegacyRoofInput` | `buildRoofModel3DFromLegacyGeometry`, `heightConstraints` |
| `getHeightAtXY` | N/A (fonction) | Adaptateurs, GeoEntity3D context, ombrage |
| Obstacle `heightM` | UI / catalogue / imports | `buildCanonicalObstacles3DFromRuntime`, near shading, backend shading normalizer |

---

*Document produit pour alimenter les prompts de branchement canonique ultérieurs — aucun refactor imposé par ce livrable.*
