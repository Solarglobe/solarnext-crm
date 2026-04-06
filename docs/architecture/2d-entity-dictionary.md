# Dictionnaire officiel des entités 2D — module calpinage SolarNext

**Version** : 1.0 (audit code au 2026-04-06)  
**Périmètre** : moteur 2D réellement présent dans le repo (runtime CRM = legacy `window.CALPINAGE_STATE` + bundles canvas / pose / ombre).  
**Fichier machine** : `2d-entity-dictionary.csv` (une ligne par entité, colonnes normalisées).  
**Ambiguïtés** : `2d-entity-ambiguities.md`.

---

## 1. Méthode d’analyse (lecture seule)

1. **Point d’entrée state** : initialisation `window.CALPINAGE_STATE` dans `frontend/src/modules/calpinage/legacy/calpinage.module.js` (L2734+).
2. **Pipeline rendu** : fonction `safeRender` dans le même fichier (assignée à `window.CALPINAGE_RENDER`, L19194) — ordre de dessin documenté en commentaires (image → contours → traits → faîtages → pans → obstacles → extensions → volumes ombrants → phase PV → overlays).
3. **Moteurs satellites** (fichiers vérifiés) :
  - `frontend/public/calpinage/canvas-bundle.js` — `CalpinageCanvas` (handles obstacles / shadow volumes, viewport).
  - `frontend/calpinage/engine/pvPlacementEngine.js` — contexte projection, validation pose.
  - `frontend/calpinage/state/activePlacementBlock.js` — blocs actifs / figés.
  - `frontend/calpinage/panelProjection.js` — `computeProjectedPanelRect`.
  - `frontend/calpinage/ghostSlots.js` — fantômes valides uniquement.
  - `frontend/calpinage/tools/calpinage-dp2-behavior.js` — Phase 3 UX sur projections.
  - `frontend/src/modules/calpinage/runtime/calpinageRuntime.ts` — façade lecture `CALPINAGE_STATE`.
  - `frontend/calpinage/state/panState.ts`, `roofState.ts` — types documentaires TS.
  - `frontend/src/modules/calpinage/integration/calpinageStructuralRoofFromRuntime.ts`, `canonical3d/sourceTrace/buildScene2DSourceTrace.ts` — ponts 3D / trace.
4. **Règle** : aucune entité listée sans occurrence réelle dans ces chemins (nom de propriété, fonction, ou global documenté).

---

## 2. Catégories métier (taxonomie officielle)


| Catégorie                    | Description                                                                    |
| ---------------------------- | ------------------------------------------------------------------------------ |
| **Bâti / fond**              | Capture, carte, échelle, GPS, image — support du dessin.                       |
| **Toiture**                  | Contours, pans, extensions, références physiques (pente, azimut).              |
| **Topologie**                | Graphe contours / traits / faîtages → faces (pans), arêtes internes de calcul. |
| **Hauteur**                  | Points sources éditables, résolution Z, modes height edit.                     |
| **Obstacle**                 | Keepouts 2D, emprises, volumes ombrants (footprint 2D).                        |
| **Pose PV**                  | Blocs, panneaux projetés, fantômes, règles, safe zones.                        |
| **Interaction UX**           | Outils, sélection, marquee, drawState, phase locks.                            |
| **Sélection / manipulation** | Indices, ids, poignées, hit-tests.                                             |
| **Aide géométrique**         | Snap previews, mesures live, viewport.                                         |
| **Aide rendu**               | Overlays DSM, debug topo, boussole DOM.                                        |
| **Calcul dérivé**            | Shading brut/normalisé, caches safe zone, géométrie projetée.                  |
| **Export / persistance**     | `validatedRoofData`, `geometry_json`, localStorage keys associées.             |
| **Pré-3D / pont 3D**         | `canonical3DWorldContract`, adaptateurs canonical, traces 2D.                  |


---

## 3. Règles de nommage recommandées (pour futurs prompts)

1. **Ne pas confondre** : *pan* (surface) / *plan* (`planes` dérivé) / *panel* (module PV posé).
2. **Contour** : préciser *persisté* (`contours[]`) vs *brouillon* (`activeContour`).
3. **Trait** : dans le code le terme est `trait` ; côté métier couvreur, documenter explicitement le rôle (ex. arêtier) dans les specs produit, pas seulement le nom code.
4. **Obstacle** : distinguer `obstacles[]` (toiture 2D / keepout) de `shadowVolumes[]` (volume ombrant) même si le pipeline near shading les agrège.
5. **Projection panneau** : toujours nommer *projection 2D* pour la sortie de `computeProjectedPanelRect`, jamais confondre avec dimensions catalogue mm seules.
6. **Vérité pose PV** : le moteur (`pvPlacementEngine` + blocs) prime ; `placedPanels` est un **résumé** exportable.

---

## 4. Table principale (exhaustive — 50 entités)

Les colonnes détaillées (*draw_location*, *mutation_location*, *consumption_location*, *reliability*, *notes*) sont dans `**2d-entity-dictionary.csv`**. Ci-dessous : vue alignée avec la réponse exécutive (identifiant stable = `entity_id` CSV).


| entity_id                     | Nom code (principal)                  | Nom métier officiel recommandé | Type géométrique            | Source de vérité     | Rôle 3D futur               |
| ----------------------------- | ------------------------------------- | ------------------------------ | --------------------------- | -------------------- | --------------------------- |
| e_roof_image                  | `CALPINAGE_STATE.roof.image`          | Image plan toiture capturée    | non_geometric_helper        | primaire             | Texture / référence plan    |
| e_roof_map                    | `roof.map`                            | Métadonnées carte source       | non_geometric_helper        | primaire             | Contexte géographique       |
| e_roof_scale                  | `roof.scale.metersPerPixel`           | Échelle m/px image             | non_geometric_helper        | primaire             | Échelle monde               |
| e_roof_gps                    | `roof.gps`                            | Coordonnées GPS site           | point                       | primaire (+fallback) | Soleil / horizon            |
| e_north_reference             | `roof.roof.north`                     | Référence azimut Nord          | non_geometric_helper        | primaire             | Alignement nord monde       |
| e_c3d_contract                | `roof.canonical3DWorldContract`       | Contrat monde 3D canonique     | non_geometric_helper        | miroir               | Entrée pipeline 3D          |
| e_contour_bati                | `contours[]`                          | Contour bâti (polygone)        | polygon                     | primaire             | Limite toiture 3D           |
| e_contour_draft               | `activeContour`                       | Ébauche contour outil          | polyline                    | temporaire           | N/A jusqu’à commit          |
| e_trait_structurel            | `traits[]`                            | Segment structurel toiture     | segment                     | primaire             | Arête / contrainte 3D       |
| e_ridge_segment               | `ridges[]`                            | Segment de faîtage             | segment                     | primaire             | Crête / direction pente     |
| e_ridge_draft                 | `activeRidge`                         | Ébauche faîtage                | segment / polyline          | temporaire           | N/A jusqu’à commit          |
| e_measure_segment             | `measures[]`                          | Côte utilisateur               | segment                     | primaire             | Métadonnée / QA             |
| e_pan_surface                 | `pans[]`                              | Pan de toiture                 | polygon                     | dérivé + édition     | Plan pan 3D                 |
| e_planes_derived              | `planes[]`                            | Plans alignés sur pans         | multi_polygon               | miroir               | Doublon géométrique         |
| e_roof_roofpans_mirror        | `roof.roofPans`                       | Miroir pans sous `roof`        | multi_polygon               | miroir               | Adaptateurs                 |
| e_obstacle_roof               | `obstacles[]`                         | Obstacle / keepout toiture     | polygon (+ meta)            | primaire             | Extrusion / interdiction    |
| e_obstacle_polygon_draft      | `activeObstacle`                      | Ébauche obstacle polygone      | polyline                    | temporaire           | N/A                         |
| e_shadow_volume               | `shadowVolumes[]`                     | Volume ombrant (empreinte 2D)  | circle / oriented_rectangle | primaire             | Volume 3D                   |
| e_roof_extension              | `roofExtensions[]`                    | Extension (lucarne / workflow) | polygon + segments          | primaire             | Volume / lucarne 3D         |
| e_dormer_draft                | `dormerDraft` + `CALPINAGE_MODE`      | Ébauche lucarne multi-étapes   | mixed                       | temporaire           | N/A                         |
| e_validated_roof_snapshot     | `validatedRoofData`                   | Snapshot relevé validé         | mixed                       | figé dérivé          | Base figée 2D→3D            |
| e_phase_flags                 | `phase`, `currentPhase`, …            | Flags de phase métier          | non_geometric_helper        | primaire             | Gating                      |
| e_pv_params                   | `pvParams`                            | Paramètres PV state            | non_geometric_helper        | miroir               | Metadata                    |
| e_pv_layout_rules             | `PV_LAYOUT_RULES`                     | Règles pose actives            | non_geometric_helper        | primaire             | Règles 3D pose              |
| e_placement_block             | `pvPlacementEngine` / blocs           | Bloc de pose PV                | mixed                       | primaire             | Groupe modules 3D           |
| e_panel_in_block              | `block.panels[]`                      | Panneau posé (instance)        | oriented_rectangle          | primaire             | Surface module 3D           |
| e_panel_projection            | `projection`                          | Rectangle projeté panneau      | oriented_rectangle          | projection           | Géométrie pose              |
| e_ghost_slot                  | (moteur)                              | Emplacement fantôme valide     | oriented_rectangle          | dérivé / temporaire  | Aide placement              |
| e_safe_zone_cache             | `__SAFE_ZONE_PH3_`_                   | Zone posable dérivée           | multi_polygon               | cache                | Surface utile               |
| e_placed_panels_flat          | `placedPanels`                        | Résumé panneaux export         | non_geometric_helper        | miroir               | Legacy — pas shape complète |
| e_shading_last                | `shading.lastResult`                  | Ombrage brut                   | non_geometric_helper        | cache                | Diagnostic                  |
| e_shading_normalized          | `shading.normalized`                  | Ombrage normalisé              | non_geometric_helper        | dérivé               | KPI / matériau 3D           |
| e_horizon_mask                | `horizonMask`                         | Données horizon lointain       | non_geometric_helper        | primaire chargée     | Horizon 3D                  |
| e_geometry_json               | `geometry_json`                       | Payload export étude           | mixed                       | reconstruction       | Contrat backend             |
| e_dp2_state                   | `CALPINAGE_DP2_STATE`                 | État UX phase 3 DP2            | non_geometric_helper        | primaire             | N/A                         |
| e_draw_state                  | `drawState`                           | État transitoire dessin        | mixed                       | temporaire           | N/A                         |
| e_height_edit_selection       | `selectedHeightPoint(s)`              | Sélection points hauteur       | point                       | mixed                | Z sommets 3D                |
| e_selection_mixed             | `selectedPanId`, `selected{}`, …      | Sélection courante             | non_geometric_helper        | primaire             | Inspection                  |
| e_viewport                    | `Viewport` (`vp`)                     | Zoom / pan canvas              | non_geometric_helper        | session              | N/A                         |
| e_selection_marquee           | `selectionBox`*                       | Rectangle sélection            | oriented_rectangle          | temporaire           | N/A                         |
| e_snap_marker                 | `snapPreview`, `rxDragSnap`, …        | Indicateur snap                | point                       | temporaire           | N/A                         |
| e_live_measure_preview        | `measureLineStart` + souris           | Prévisu mesure                 | segment                     | temporaire           | N/A                         |
| e_topo_graph_internal         | (local `computePansFromGeometryCore`) | Graphe topologique interne     | mixed                       | reconstruction       | Faces implicites            |
| e_debug_pans_overlay          | `debugFaces`                          | Debug faces pans               | multi_polygon               | debug                | N/A prod                    |
| e_dsm_overlay_pixels          | `__CALPINAGE_DSM_OVERLAY_DATA`__      | Grille DSM overlay             | non_geometric_helper        | projection           | Visualisation               |
| e_dom_north_compass           | `#calpinage-north-compass`            | Boussole DOM                   | handle_ui                   | dérivée              | UX                          |
| e_calpinage_panstate_mirror   | `CalpinagePans.panState`              | Miroir bundle pans             | non_geometric_helper        | miroir               | Sync UI                     |
| e_catalog_equipment_selection | `CALPINAGE_SELECTED_PANEL_ID`…        | Sélection catalogue équipement | non_geometric_helper        | primaire             | Spec équipement             |
| e_unified_hit_result          | hit-test unifié                       | Résultat hit-test              | non_geometric_helper        | temporaire           | N/A                         |
| e_sun_vector_global           | `__CALPINAGE_SUN_VECTOR`              | Vecteur soleil preview         | non_geometric_helper        | projection           | Lumière                     |


**Total** : **50** entités recensées dans la table + CSV (1 ligne d’en-tête + 50 lignes données dans le CSV).

---

## 5. Cartographie rapide « où ça vit »


| Zone           | Fichiers clés                                                                                              |
| -------------- | ---------------------------------------------------------------------------------------------------------- |
| State global   | `calpinage.module.js` (`CALPINAGE_STATE`, `saveCalpinageState`, `buildGeometryForExport`)                  |
| Rendu canvas   | `calpinage.module.js` `safeRender` ; `canvas-bundle.js` ; `calpinage-dp2-behavior.js` `render`             |
| Topologie pans | `calpinage.module.js` `computePansFromGeometryCore`, `getEdgesFromState`                                   |
| Pose PV        | `pvPlacementEngine.js`, `activePlacementBlock.js`, `panelProjection.js`, `ghostSlots.js`                   |
| Shading        | `calpinage.module.js` `computeCalpinageShading`, `buildNearObstaclesFromState`, `nearShadingCore` (global) |
| Pont 3D        | `canonical3d/`*, `calpinageStructuralRoofFromRuntime.ts`, `buildScene2DSourceTrace.ts`                     |


---

## 6. Référence croisée

- **Ambiguïtés & pièges** : `docs/architecture/2d-entity-ambiguities.md`
- **Audit CSV / prompts automatisés** : `docs/architecture/2d-entity-dictionary.csv`

---

## 7. Limites déclarées de cet audit

- Les bundles sous `frontend/public/calpinage/` sont des **copies exécutables** ; la source commentée mentionne `canvasEngine.ts` etc. — le dictionnaire se base sur les **fichiers réellement chargés** par le CRM (`public` + `legacy` module).
- Les outils **carte** (Leaflet/Google) produisent des marqueurs hors canvas calpinage (ex. confirmation bâtiment) : non listés comme primitives 2D toiture sauf mention GPS/map dans le tableau fond.
- **Onduleurs / catalogue** : sélection UI globale ; pas une forme 2D sur le toit — référencé comme entité support `e_catalog_equipment_selection`.

