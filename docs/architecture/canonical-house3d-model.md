# Modèle canonique officiel — Moteur Maison 3D SolarNext

**Version schéma** : `canonical-house3d-model-v1`  
**Statut** : contrat cible — **sans parseur**, **sans branchement prod**.  
**Alignement** : dérivé du dictionnaire 2D officiel (`2d-entity-dictionary.md`, `.csv`, `2d-entity-ambiguities.md`).  
**Fichiers associés** : `canonical-house3d-model.json`, `canonical-house3d-invariants.md`, `frontend/src/modules/calpinage/canonical3d/model/canonicalHouse3DModel.ts`.

---

## A. Périmètre officiel — « Qu’est-ce qui appartient au moteur Maison 3D ? »

### Réponse obligatoire

Le **moteur Maison 3D** (cœur métier géométrique) est le sous-système qui possède et raisonne sur :

- la **géométrie 3D métier** du bâtiment et de sa toiture **dans le repère local bâtiment** ;
- la **topologie** (graphes, rattachements, classifications d’arêtes) ;
- les **hauteurs métier locales** avec **traçabilité** (provenance) ;
- les **obstacles / extensions / volumes** **classés par famille sémantique** (pas un fourre-tout) ;
- les **rattachements** pan ↔ patch toiture, obstacle ↔ patch, panneau ↔ patch (prévu) ;
- les **invariants** et **métadonnées de dérivation** (ce qui est primaire vs dérivé).

Le moteur Maison 3D **ne contient pas** et **ne doit pas dépendre** de : rendu, caméra, pixels écran, états UI, sélection, outils de dessin, ni d’artefacts calculés uniquement pour l’affichage.

### DOIT faire partie du moteur Maison 3D

| Domaine | Contenu canonique (exemples) | Lien dictionnaire 2D (entity_id) |
|--------|------------------------------|-----------------------------------|
| Bâti | Emprise / coque : contour fermé au sol ou niveau de référence, murs (si modélisés), ligne de faîtage murs / haut de mur | `e_contour_bati` (interprétation parseur : périmètre bâti vs ligne de toit à figer au parseur) |
| Toiture | Contours de toit en plan local, **patches** (faces), **arêtes** typées (faîtage, noue, arêtier, rive, égout, pignon…), graphe topologique | `e_trait_structurel`, `e_ridge_segment`, `e_pan_surface`, `e_planes_derived` / `e_roof_roofpans_mirror` (miroirs → dérivés) |
| Extensions | Lucarnes / chiens-assis / extensions constructives | `e_roof_extension` |
| Obstacles physiques | Volumes ou prismes toiture associés à une géométrie physique | `e_obstacle_roof` **si** typé `physical` (voir bloc Annexes) |
| Keepouts | Zones d’interdiction de pose **sans** équivalence physique obligatoire | `e_obstacle_roof` **si** typé `layout_keepout` |
| Volumes ombrants | Objet 3D ou extrusion dont la **sémantique** est l’ombrage (distinct du keepout) | `e_shadow_volume` |
| Hauteurs | Toute cote **z locale** ou différence de cote, traçable | sommets 2D avec `h`, solver futur — aligné `e_height_edit_selection`, `e_pan_surface` |
| PV (prévu) | Groupes, panneaux, transform local sur patch, lien `roofPatchId` | `e_placement_block`, `e_panel_in_block`, `e_panel_projection` |

### NE DOIT PAS faire partie du moteur Maison 3D

| Exclusion | Exemples (entity_id / code) |
|-----------|----------------------------|
| UX / outils | `e_draw_state`, `e_contour_draft`, `e_ridge_draft`, `e_obstacle_polygon_draft`, `e_dormer_draft`, `e_phase_flags` |
| Sélection / manipulation | `e_selection_mixed`, `e_unified_hit_result`, poignées canvas |
| Viewport / navigation | `e_viewport`, zoom/pan, `CALPINAGE_VIEWPORT_*` |
| Aides visuelles | `e_snap_marker`, `e_selection_marquee`, `e_live_measure_preview`, `e_ghost_slot` (fantôme UX moteur pose — **hors** canonique maison ; réintégration éventuelle côté **bloc PV** uniquement) |
| Overlays & debug | `e_debug_pans_overlay`, `e_dsm_overlay_pixels`, `e_safe_zone_cache` |
| DOM / hors canvas métier | `e_dom_north_compass` |
| Caches shading produit | `e_shading_last`, `e_shading_normalized`, `e_horizon_mask` — **consomment** la maison + soleil ; **ne font pas partie** du modèle géométrique canonique de la maison (couche **analyse** séparée) |
| Miroirs export incomplets | `e_placed_panels_flat` — **jamais** source géométrique primaire pour le canonique |

### Frontière nette

```
┌─────────────────────────────────────────────────────────────┐
│  MOTEUR MAISON 3D (canonique, repère local bâtiment)         │
│  building + roofTopology + roofGeometry + heights + annexes │
│  + rattachements (+ bloc PV prévu)                           │
└─────────────────────────────────────────────────────────────┘
                            ↑ parse / build
┌─────────────────────────────────────────────────────────────┐
│  ADAPTATEURS (hors cœur) : image px, monde ENU, GPS, viewer   │
│  metersPerPixel, northAngleDeg, placement scène Three.js    │
└─────────────────────────────────────────────────────────────┘
                            ↑
┌─────────────────────────────────────────────────────────────┐
│  UX / RUNTIME LEGACY / CANVAS / SHADING KPI / VIEWER         │
└─────────────────────────────────────────────────────────────┘
```

**Règle** : le **viewer** et **Three.js** ne font que **lire** le canonique (ou une vue projetée monde) ; ils **ne mutent** pas le modèle maison.

---

## B. Repère officiel

### B.1 Repère local bâtiment (obligatoire pour le cœur métier)

| Axe | Sens | Unité |
|-----|------|--------|
| **X** | axe 1 du **plan horizontal local** du bâtiment | m |
| **Y** | axe 2 du **plan horizontal local** du bâtiment | m |
| **Z** | **hauteur métier locale**, orthogonal au plan (X,Y) | m |

- **Z = 0** : **base locale officielle du bâtiment** (plan de référence arbitraire du projet, ex. niveau fini sol / dallage — **décision parseur / métier**, mais **unique** par instance `CanonicalHouseDocument`).
- **Aucune altitude absolue**, **aucun ellipsoïde**, **aucune coordonnée terrain monde** dans les types du cœur `building` / `roof` / `annexes` / `heights`.
- Les polygones **empreinte** sont donnés dans le plan **(X,Y)** ; les surfaces inclinées sont décrites par géométrie 3D locale (plans, maillages, ou paramètres patch) **toujours** en m dans ce repère.

### B.2 Séparation : géométrie métier locale vs placement monde / viewer

| Couche | Contenu | Exemples (dictionnaire 2D) |
|--------|---------|---------------------------|
| **Géométrie métier locale** | Tout ce qui est dans `CanonicalHouseDocument` | équivalent de `contours`, `traits`, `ridges`, `pans`, obstacles typés, extensions |
| **Placement monde / viewer** | GPS, rotation nord, échelle image→m, origine scène, caméra | `e_roof_gps`, `e_north_reference`, `e_roof_scale`, `e_roof_image`, `e_c3d_contract`, `e_viewport` |

Le document canonique peut inclure un bloc optionnel **`worldPlacement`** (hors cœur géométrique interne) qui **référence** uniquement des paramètres d’alignement — **sans** les mélanger aux coordonnées des sommets du cœur. Le parseur futur pourra remplir ce bloc **après** construction locale, ou le laisser vide pour des usages « maison seule ».

Le bloc **`pv`** est **optionnel** tant qu’aucune pose n’est importée (voir `canonicalHouse3DModel.ts`).

**Note de cohérence repo** : `docs/architecture/3d-world-convention.md` décrit le repère **monde** (ENU Z-up, m) pour la chaîne **actuelle** `RoofModel3D` / viewer. Le modèle **Maison 3D** ici est **local d’abord** ; le passage **local → monde** est une **responsabilité d’adaptateur**, pas du cœur.

---

## C. Blocs officiels du modèle canonique

### C.1 Bloc BÂTIMENT (`building`)

| Champ / concept | Rôle | Statut (v1) |
|-----------------|------|-------------|
| `buildingId` | Identifiant stable | **primary** |
| `buildingFootprint` | Polygone fermé (X,Y) — emprise au niveau de référence | **primary** ou **derived** (si déduit du contour toit au parseur — **à documenter au parseur**) |
| `buildingOuterContour` | Alias sémantique : limite extérieure « coque » en plan | **primary** / **derived** (même remarque) |
| `baseZ` | Toujours **0** dans le repère local (constante conventionnelle) | **convention** |
| `wallTopContour` | Polygone ou polyligne 3D / 2D+Z pour couronne haute murs | **future** / **optional** |
| `wallHeight` | Hauteur murale constante ou par segment | **future** / **optional** |
| `buildingShell` | Surfaces fermées murs / sol (maillage ou B-rep léger) | **derived** (builder futur) |

**Parseur v1 minimal** : au minimum `buildingId` + une emprise **`buildingFootprint`** cohérente avec la topologie toit (ou dérivée explicitement).  
**Builder** : `buildingShell`, `wallTopContour` quand le produit exige le volume bâtiment complet.

### C.2 Bloc TOITURE (`roof`) — distinction topologie / géométrie

#### A. Topologie toiture (`roofTopology`)

Graphe logique **stable** :

- **Sommets** topologiques (ids) + optionnellement lien vers coordonnées (X,Y) ou (X,Y,Z) locales.
- **Arêtes** avec `RoofEdgeKind` explicite (voir TS + JSON).
- **Faces** (patches) comme cycles d’arêtes ou liste de sommets — **référence** `roofPatchId`.

**Sources 2D primaires typiques** : segments `traits[]`, `ridges[]`, contours `contours[]` (hors brouillon).

#### B. Géométrie toiture (`roofGeometry`)

- **`roofPatches`** : une entrée par pan / face porteur — plan, boundary, normale sortante, paramètres pente / azimut **locaux**.
- **`roofEdges` enrichis** : géométrie 3D des arêtes (segments 3D), longueurs, types alignés sur la topologie.

**Sources** : `pans[]` → **dérivé** de la topologie + solver hauteur ; `planes[]` / `roof.roofPans` = **miroirs** — **ne pas** les traiter comme sources indépendantes dans le canonique (éviter la dette du dictionnaire 2D).

Champs demandés par le cahier des charges :

| Concept | Bloc | Nature |
|---------|------|--------|
| `roofId` | roof | **primary** |
| `roofTopologyInput` | roof.topology | **primary** (graphe issu parseur) |
| `roofPlanesInput` | roof.geometry | **optional** — entrées planes si fournies explicitement (sinon **derived**) |
| `roofPatches` | roof.geometry | **derived** (builder) |
| `roofEdges` | roof.geometry + topology | **mixed** |
| `ridges` / `hips` / `valleys` / `eaves` / `gableEdges` | roof.topology.edges typées | **primary** (classification) ou **derived** (si inféré) |
| `internalStructuralEdges` | roof.topology | **primary** (ex. `traits[]` non classés couvreur au parseur) |
| `roofToBuildingBindings` | roof | **derived** — liens patch/obstacle → `buildingId` / niveau |

### C.3 Bloc HAUTEURS (`heightModel`)

**Règle officielle** : toute hauteur ou cote **Z** dans le canonique est portée par un type **`HeightQuantity`** :

- `valueM` : nombre (m)
- `provenance` : `user_input` | `business_rule` | `solver` | `fallback` | `reconstruction`
- `sourceRef` : id d’entité source (ex. sommet topologique, arête, patch)
- `derivationRuleId` : identifiant stable de règle (chaîne versionnée, ex. `height.default-eave-v1`)

Exemples de concepts métier (pas tous obligatoires v1) :

| Concept | Usage |
|---------|--------|
| `zGround` | optionnel — **hors** cœur si = monde ; si « sol local » = 0 par convention |
| `zBase` | = 0 (base locale) |
| `zWallTop` | future |
| `zEave` / `zRidge` | par patch ou arête |
| `zObstacleBase` / `zObstacleTop` | annexes |
| `zPanelBase` | bloc PV |

### C.4 Bloc ANNEXES (`annexes`) — pas de mélange flou

Familles **disjointes** (union discriminée) :

1. **`layout_keepout`** — zone 2D/3D où la pose PV est interdite ; **pas** nécessairement un obstacle physique.
2. **`physical_roof_obstacle`** — obstacle réel (cheminée, VMC, volume saillant modélisé).
3. **`shading_volume`** — volume dont la **fonction** est l’ombrage (ex. `shadowVolumes[]` 2D extrudé).
4. **`roof_extension`** — lucarne / chien assis / extension constructive (`roofExtensions[]`).
5. **`future_opening`** — trémie, fenêtre de toit ouverte (réserve schéma).
6. **`future_parapet_acrotere`** — acrotère / relevé (réserve).

Chaque entrée : `id`, `family`, `attachedRoofPatchIds[]`, géométrie locale, liens `HeightQuantity` pour Z bas / haut si pertinent.

### C.5 Bloc PV (`pv` — prévu, non implémenté moteur ici)

Emplacement **obligatoire** dans le document pour éviter un sous-système parallèle :

- `pvGroups[]` — groupe d’implantation
- `pvPanels[]` — instance : `roofPatchId`, `mountPlaneRef`, `panelLocalTransform`, `orientationDeg`, `layoutMetadata`
- `pvPanelProjection2dRef` — **référence** à la trace 2D (`projection` image) **hors** cœur local si nécessaire — lien via `traceId` / `legacyBlockId` (optionnel)

**Règle** : la géométrie **canonique** du panneau en maison 3D est dans le **repère local** du patch (ou du bâtiment) ; la projection 2D image est **donnée dérivée / trace** pour audit.

---

## D. Règles officielles du moteur Maison 3D

1. **Une entité = une responsabilité** — pas d’objet fourre-tout « obstacle » sans `family`.
2. **Donnée canonique ≠ donnée UX** — rien issu de `drawState`, sélection, ou preview dans le document cœur.
3. **Toute géométrie dérivée est marquée** — `dataStatus: primary | derived | future` sur champs du JSON + types TS.
4. **Toute relation critique est explicite** — ids (`roofPatchId`, `buildingId`, `edgeId`, `vertexId`).
5. **Lisible sans legacy** — noms de champs en anglais stable ; mapping 2D documenté à part (matrice ci-dessous).
6. **Traçabilité des hauteurs** — pas de `number` nu pour une cote métier sans `HeightQuantity` ou équivalent.
7. **Le viewer ne mutile pas le canonique** — lecture seule ; transformations caméra hors document.

---

## E. Relations entre blocs (familles)

1. **Appartenance** : `roof` → `building` ; `roofPatch` → `roof` ; `annex` → `roof` (+ optionnel `building`).
2. **Topologie** : `vertex` — `edge` — `patch` (incidence).
3. **Géométrie dérivée** : `roofTopology` + `heightModel` → `roofGeometry`.
4. **Rattachement PV** : `pvPanel` → `roofPatch` (+ `heightModel` pour pose).
5. **Provenance** : chaque `HeightQuantity` → source / règle.
6. **Placement externe** (optionnel) : `worldPlacement` → paramètres monde **sans** altérer coordonnées cœur.

---

## F. Conventions de nommage

- **IDs** : `StableEntityId` — chaîne opaque stable (UUID ou préfixe métier + hash structurel).
- **Préfixes** : `building`, `roof`, `patch`, `edge`, `vertex`, `annex`, `pv` dans les ids recommandés.
- **Anglais** pour champs du schéma JSON / TS ; libellés métier FR restent dans la doc produit.

---

## G. Matrice de mapping 2D → modèle canonique 3D

| Entité 2D (entity_id) | Bloc canonique cible | Statut |
|------------------------|----------------------|--------|
| `e_contour_bati` | `building.buildingFootprint` + `roof.roofTopology` (arêtes contour) | **primary** (interprétation bâti vs ligne de toit au parseur) |
| `e_trait_structurel` | `roof.roofTopology.edges` → `internalStructuralEdges` ou type métier une fois classé | **primary** |
| `e_ridge_segment` | `roof.roofTopology.edges` (kind `ridge`) | **primary** |
| `e_pan_surface` | `roof.roofGeometry.roofPatches[]` | **derived** (builder topo + hauteurs) ; **fallback** si parseur reçoit pans déjà calculés |
| `e_planes_derived` | *Ignoré comme source* ; vérif cohérence seulement | **mirror / do not use as primary** |
| `e_roof_roofpans_mirror` | idem | **mirror** |
| `e_obstacle_roof` | `annexes[]` → `layout_keepout` **ou** `physical_roof_obstacle` selon `meta` / `kind` / règle parseur | **primary** (à **typer** explicitement — dette 2D) |
| `e_shadow_volume` | `annexes[]` → `shading_volume` | **primary** (empreinte + params hauteur) |
| `e_roof_extension` | `annexes[]` → `roof_extension` | **primary** |
| `e_validated_roof_snapshot` | Snapshot **entrée parseur** prioritaire pour figer l’état « relevé validé » | **primary** pour rejeu ; **derived** depuis live si politique produit |
| `e_measure_segment` | `roof.metadata` / QA / calibration — **pas** arête porteuse sauf décision métier | **optional** |
| `e_placement_block` | `pv.pvGroups[]` + panneaux | **primary** (pose) |
| `e_panel_in_block` | `pv.pvPanels[]` | **primary** |
| `e_panel_projection` | `pvPanel.projectionTrace` + géométrie locale dérivée | **projection** / **derived** |
| `e_ghost_slot` | **Hors** canonique maison ; uniquement pipeline pose UX | **exclude** |
| `e_safe_zone_cache` | **Hors** canonique ; reconstruit depuis règles PV + géométrie | **exclude** |
| `e_placed_panels_flat` | **Ne pas** reconstruire géométrie complète ; hint export seulement | **mirror_incomplete** |
| `e_roof_scale` / `e_north_reference` / `e_roof_gps` | `worldPlacement` (adaptateur) | **external** |
| `e_roof_image` | Textures / UV — couche **viewer** ou `metadata.textures` | **external** |
| `e_c3d_contract` | Alignement avec chaîne `canonical3d` existante — **adaptateur** | **bridge** |

---

## H. Références croisées

- Dictionnaire 2D : `2d-entity-dictionary.md`, `2d-entity-dictionary.csv`
- Ambiguïtés : `2d-entity-ambiguities.md`
- Invariants : `canonical-house3d-invariants.md`
- Schéma machine : `canonical-house3d-model.json`
- Types TS : `canonical3d/model/canonicalHouse3DModel.ts`
