# Ambiguïtés, doublons et dette structurelle — calpinage 2D

Document compagnon de `2d-entity-dictionary.md`. Tout ce qui suit est observé dans le code au 2026-04-06 (branche de travail locale), sans correction proposée.

---

## 1. Vocabulaire et noms qui se chevauchent

| Symptôme | Où | Risque |
|----------|-----|--------|
| **Contour** désigne à la fois le polygone bâti (`contours[]`), le brouillon outil (`activeContour`), et parfois la clé d’export `contoursBati` dans `roofState` JSON | `calpinage.module.js` (`CALPINAGE_STATE.contours`, `activeContour`, `buildGeometryForExport`) | Confusion prompt / spec entre « contour en cours » et « contour persisté ». |
| **Mesure** vs **measure** : state `measures` (orthographe anglaise) vs libellés UI « mesure » | `CALPINAGE_STATE.measures` | Incohérence nommage API / doc. |
| **Plan** : `planes` (dérivé topo) vs **pan** (surface de pose) | `computePansFromGeometry`, `CALPINAGE_STATE.planes`, `pans` | « Plan » et « pan » sont phonétiquement proches ; `planes` est un miroir dérivé, pas une entité utilisateur. |
| **Trait** : ligne structurelle bleue en UI vs sens métier « arêtier / ligne de noue » non nommé explicitement dans le code | `traits[]`, rendu `safeRender` | Le code dit `trait` partout ; le vocabulaire couvreur n’est pas reflété. |
| **Chien assis / extension / dormer** : `roofRole === "chienAssis"`, `roofExtensions`, modes `MODE_DORMER_*`, `drawState.dormerDraft` | Multiple | Trois niveaux de nommage pour une même famille fonctionnelle. |
| **Obstacle** : entrées `obstacles[]` mélangent keepouts métier, formes catalogue (`obstacleBusinessId`), et volumes ombrants sont **ailleurs** (`shadowVolumes`) | Toolbar HTML `data-obstacle-business-id`, `buildNearObstaclesFromState` fusionne aussi `shadowVolumes` et `roofExtensions` | Risque de croire qu’un obstacle 2D = tout ce qui ombrage ; le pipeline near shading agrège trois sources. |

---

## 2. Double représentation géométrique des pans

- **`pan.polygon`** vs **`pan.points`** : les deux coexistent ; `panState.ts` documente `points` comme sommets avec hauteur optionnelle, et `polygon` comme legacy 2D.
- Le rendu surlignage pan sélectionné utilise **`selPan.polygon`** uniquement (`safeRender`), alors que le hover pan accepte **`points` ou `polygon`**.
- **`ensurePansHavePoints`** / **`buildGeometryForExport`** réalignent après `computePansFromGeometry`.

**Statut** : **dupliqué / ambigu** — source de vérité effective = résultat de `computePansFromGeometryCore` + champs préservés lors de l’export, mais le lecteur du code doit savoir quel champ lire selon l’écran.

---

## 3. Miroirs et caches non persistés

| Artefact | Stockage | Piège |
|----------|----------|--------|
| `roof.roofPans` | Sous `CALPINAGE_STATE.roof` (rempli par topo) | Duplication de `pans` / `planes` ; risque de divergence si un seul est mis à jour à la main. |
| `placedPanels` | `CALPINAGE_STATE.placedPanels` | Reconstruit depuis blocs figés (`syncPlacedPanelsFromBlocks`) — **résumé**, pas la vérité de pose. |
| `__SAFE_ZONE_PH3__` | `window` | Cache géométrie PV (safe zones) + Path2D ; **pas** dans `CALPINAGE_STATE`. |
| `CALPINAGE_STATE.shading.lastResult` vs `normalized` | state | Deux couches ; consommateurs doivent utiliser le normalizer officiel. |
| `drawState` | Closure `calpinage.module.js` | Énorme surface « UX transitoire » non sérialisée ; facile à confondre avec données métier. |

---

## 4. Entités visibles mais non stockées comme telles

- **Fantômes de pose** : produits par `ghostSlots.js` / moteur, consommés pour le rendu Phase 3 ; pas un tableau dédié dans `CALPINAGE_STATE` (liés au bloc actif via `pvPlacementEngine`).
- **Prévisualisations** : `activeRidge`, `activeContour`, `activeObstacle`, traits/faîtages « live » (`drawLiveTrait`, `drawLiveRidge`), segment mesure en cours, `snapPreview`, marqueurs dormer.
- **Poignées** : cercles / disques calculés à la volée (`CalpinageCanvas.drawObstacles`, `drawShadowVolumeHandles`, `calpinage-dp2-behavior.js` rotation handle).
- **Overlay DSM lecture** : `__CALPINAGE_DSM_OVERLAY_DATA__` + canvas `#calpinage-dsm-read-overlay` — pixels, pas le modèle toit.

---

## 5. Persistance vs rendu

- **`validatedRoofData`** : snapshot au verrouillage relevé ; le live `pans` / `contours` peut continuer à évoluer côté code dans certains chemins de sync — la cohérence repose sur `buildValidatedRoofData` et post-traitements.
- **`geometry_json`** : agrégat d’export (voir `buildGeometryForExport`) ; ce n’est pas le même objet que `window.CALPINAGE_STATE` brut.
- **Modules TS** (`frontend/calpinage/state/*.ts`) : types documentaires partagés ; le runtime CRM est **`window.CALPINAGE_STATE`** dans le legacy module — deux « couches » de vérité typologique.

---

## 6. Pont 3D (canonical3d) sans contrat unique par primitive

- Les **ridges/traits** passent par `resolveCalpinageStructuralRoofForCanonicalChain` et filtrent `roofRole === "chienAssis"`.
- Les **obstacles** near shading utilisent `buildNearObstaclesFromState` avec heuristique multi-champs (`polygonPx`, `polygon`, `points`, `contour.points`).
- **`canonical3DWorldContract`** vit sous `roof` et est synchronisé depuis le toit (`syncCanonical3DWorldContractFromCalpinageRoof` dans le module legacy) — contrat séparé des polygones bruts.

**Risque** : consommer une géométrie 2D « visible » sans passer par les mêmes filtres que la chaîne 3D / shading.

---

## 7. Champs legacy ou diagnostiques

- `CALPINAGE_STATE.debugFaces` / `debugPansInfo` quand `CALPINAGE_DEBUG_PANS` actif.
- `selected` (`{ type, id, pointIndex }`) coexiste avec des sélections par index (`selectedContourIndex`, etc.) et `CALPINAGE_DP2_STATE`.
- Globals `window.CALPINAGE_SELECTED_PANEL_ID`, `PV_SELECTED_PANEL`, etc. : plusieurs chemins vers « le panneau catalogue choisi », distinct des panneaux posés.

---

## 8. Résumé exécutif dette

Le modèle 2D **fonctionne** mais est **dense** : une même idée (surface pan, obstacle, nord, panneau) a souvent **2–3 représentations** (live vs validé, state vs engine vs export). Toute évolution 3D doit imposer un **graphe de vérité** explicite plutôt que d’étendre les miroirs existants.
