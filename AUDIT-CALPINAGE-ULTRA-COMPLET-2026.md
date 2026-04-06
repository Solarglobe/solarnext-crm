# AUDIT ULTRA-COMPLET — MODULE CALPINAGE SOLARNEXT CRM
### Analyse technique & UX — Phases 2 et 3 — Mars 2026
> **Règle : Aucune correction effectuée. Observation, analyse, recommandations uniquement.**

---

## SOMMAIRE

1. [Vue d'ensemble de l'architecture](#1-vue-densemble-de-larchitecture)
2. [Phase 2 — Dessin & Géométrie](#2-phase-2--dessin--géométrie)
   - 2.1 [CanvasEngine](#21-canvasengine)
   - 2.2 [Viewport](#22-viewport)
   - 2.3 [HitTest](#23-hittest)
   - 2.4 [InteractionManager & Snap](#24-interactionmanager--snap)
   - 2.5 [DrawPolygon — Outil de dessin des pans](#25-drawpolygon--outil-de-dessin-des-pans)
   - 2.6 [Obstacles (cercle & rectangle)](#26-obstacles-cercle--rectangle)
   - 2.7 [Calibration](#27-calibration)
   - 2.8 [Outil Nord](#28-outil-nord)
   - 2.9 [État des pans (panState)](#29-état-des-pans-panstate)
   - 2.10 [Spec UX vs Implémentation réelle](#210-spec-ux-vs-implémentation-réelle)
3. [Phase 3 — Placement PV & Blocs](#3-phase-3--placement-pv--blocs)
   - 3.1 [Architecture blocs (activePlacementBlock)](#31-architecture-blocs-activeplacementblock)
   - 3.2 [pvPlacementEngine](#32-pvplacementengine)
   - 3.3 [Ghost Slots — LE PROBLÈME GRAND TOIT](#33-ghost-slots--le-problème-grand-toit)
   - 3.4 [Comportement DP2 — Interaction canvas](#34-comportement-dp2--interaction-canvas)
   - 3.5 [CalpinageStore — État & Historique](#35-calpinagestore--état--historique)
4. [Phase 3D — Viewer Three.js](#4-phase-3d--viewer-threejs)
5. [Ombrage](#5-ombrage)
   - 5.1 [Modèle solaire (solarPosition.js)](#51-modèle-solaire-solarpositionjs)
   - 5.2 [Ombrage proche (nearShadingCore.cjs)](#52-ombrage-proche-nearshadingcorecjs)
   - 5.3 [Ombrage lointain (horizonMaskEngine.js)](#53-ombrage-lointain-horizonmaskengineJs)
   - 5.4 [shadingEngine.js — Pipeline principal](#54-shadingEnginejs--pipeline-principal)
6. [Catalogue PV](#6-catalogue-pv)
7. [Phase3ChecklistPanel](#7-phase3checklistpanel)
8. [CalpinageApp — Bootstrap & Init](#8-calpinageapp--bootstrap--init)
9. [Problèmes transversaux](#9-problèmes-transversaux)
10. [Synthèse & Priorisation](#10-synthèse--priorisation)

---

## 1. VUE D'ENSEMBLE DE L'ARCHITECTURE

### Ce qui est bien

L'architecture générale est cohérente et bien découpée :

- **Séparation moteur / UI** : `pvPlacementEngine.js` ne touche pas au DOM, `calpinage-dp2-behavior.js` gère uniquement les interactions canvas. C'est propre.
- **Fonctions pures isolées** : `buildProjectionContext()` est explicitement documentée comme fonction pure sans effet de bord. Idem `computeSunPosition()`.
- **Module store avec undo/redo** : L'implémentation du `CalpinageStore` avec un système d'historique limité (50 états) est solide et testable.
- **TypeScript progressif** : Les fichiers critiques (types, panState, calibration, north, drawPolygon, viewport, hitTest) sont en TypeScript. Les moteurs legacy sont en JS vanilla.
- **Tests présents** : Présence de tests unitaires dans `shading/__tests__/`, `__tests__/calpinage-*.test.js`, etc.

### Ce qui interroge

- **Dualité JS vanilla / TypeScript** : Les couches UI de haut niveau sont en React + TS, mais les moteurs de placement (pvPlacementEngine, ghostSlots, activePlacementBlock, dp2-behavior) sont en IIFE JS vanilla avec globals `window.*`. Ce mélange crée une dette technique réelle.
- **Globals window proliférants** : `window.CALPINAGE_STATE`, `window.CALPINAGE_IS_MANIPULATING`, `window.recomputeAllPlacementBlocksFromRules`, `window.computeAnnualShadingLoss`, `window.GhostSlots`, `window.computeProjectedPanelRect`, `window.ActivePlacementBlock`, `window.__CALPINAGE_PV_STRICT__`, `window.__SHADING_SOLAR_POSITION__`, `window.__SHADING_HORIZON_MASK_SAMPLER__`. Au moins **12 globals window** identifiées. Cela rend le test difficile, le hot-reload imprévisible, et une double-init catastrophique.
- **Duplication de `pointInPolygon`** : La même fonction ray-casting est réimplémentée en **7 fichiers distincts** (hitTest.ts, drawPolygon.ts, obstacles.ts, ghostSlots.js, pvPlacementEngine.js, nearShadingCore.cjs, shadingEngine.js). Violation DRY systématique. Une divergence de comportement entre implémentations est possible.

---

## 2. PHASE 2 — DESSIN & GÉOMÉTRIE

### 2.1 CanvasEngine

**Fichier** : `smartpitch/calpinage/canvas/canvasEngine.ts`

**Ce qui est bien :**
- Gestion correcte du devicePixelRatio (DPR) : canvas physique × DPR, style CSS en px logiques. Résolution Retina correcte.
- `getBoundingClientRect()` sur le container (pas sur le canvas lui-même) évite le bug classique 300×150px.
- `setTransform(dpr, 0, 0, dpr, 0, 0)` est appliqué après resize, ce qui évite d'avoir à compenser le DPR à chaque draw.
- Guard `_destroyed` pour éviter les opérations après cleanup.

**Problèmes identifiés :**
- **Pas de ResizeObserver interne** : La documentation dit "Pas de listener interne — le module appelle resize()". C'est un choix délibéré mais cela signifie que si le container change de taille sans que le module appelant ne déclenche `resize()`, le canvas sera désynchronisé (par exemple après un redimensionnement de panel sidebar).
- **`destroy()` pose le canvas à `null as unknown as HTMLCanvasElement`** : Contournement de TypeScript typiquement risqué. Une opération post-destroy qui ne vérifie pas `_destroyed` lèvera une erreur peu claire.
- **Pas de garde anti-boucle sur `resize()`** : Si appelé de manière répétée (ex. dans un RAF ou un observer non debounced), pas de vérification de changement de taille.

---

### 2.2 Viewport

**Fichier** : `smartpitch/calpinage/canvas/viewport.ts`

**Ce qui est bien :**
- Coordonnées monde Y-inversé (standard pour canvas 2D : haut = 0 écran = y monde positif). Cohérent avec la physique de toiture.
- `zoom()` centré sur le point souris : le point monde sous le curseur reste fixe pendant le zoom. C'est le comportement attendu et correct.
- Implémentation propre, sans état inutile.

**Problèmes identifiés :**
- **Aucun zoom min/max** : `scale` peut descendre à 0 (division par zéro dans `screenToWorld`) ou monter à l'infini. Pas de garde-fou. Un zoom excessif peut rendre l'UI inutilisable.
- **Pas de "fit to bounds"** : Aucune méthode pour recentrer la vue sur le contenu. Si l'utilisateur se perd, il n'y a pas de "reset view" natif dans ce module.
- **Dérive infinie de l'offset** : `pan()` additionne sans limite. Sur des sessions longues, l'offset peut dépasser les valeurs sûres pour le canvas (pas de clamp).
- **Pas de rotation de viewport** : Le viewport est purement translation + scale. Pas de rotation (ce n'est pas forcément un problème, mais à noter).

---

### 2.3 HitTest

**Fichier** : `smartpitch/calpinage/canvas/hitTest.ts`

**Ce qui est bien :**
- `hitPoint` utilise `tolMeters = 0.15m` : tolérance en espace monde, pas en pixels. C'est correct car indépendant du zoom.
- `hitPolygon` : algorithme ray-casting classique, robuste.
- Cas dégénéré `yj === yi` bien géré (ligne horizontale ignorée).

**Problèmes identifiés :**
- **Tolérance fixe en mètres pour hitPoint (0.15m)** : À un zoom très faible (toiture entière visible sur petite fenêtre), 0.15m peut représenter < 1px → impossible de cliquer. À un zoom très élevé, 0.15m peut être trop grand. La tolérance devrait être exprimée en pixels et convertie en mètres via l'échelle viewport.
- **`hitPolygon` ne teste que l'intérieur** : Pas de test sur les arêtes (bordure). Un clic sur la bordure extérieure d'un pan fin sera raté. Pour les pans très étroits, cela peut être problématique.
- **Pas de hit-test sur les segments** (arêtes de polygone) : On ne peut pas cliquer sur un segment pour l'inspecter ou ajouter un sommet.

---

### 2.4 InteractionManager & Snap

**Fichier** : `smartpitch/calpinage/canvas/interaction.ts`

**Problème MAJEUR — SNAPPING DÉSACTIVÉ** :
```js
const SNAPPING_ENABLED = false;
```
Le snap à la grille est **complètement désactivé par défaut**. La fonction `snap(value, step=0.5)` existe mais n'est jamais appelée. C'est une feature critique pour la précision du dessin qui est silencieusement absente.

**Autres problèmes :**
- **Pas de snap configurale** : Même si on activait `SNAPPING_ENABLED`, le step est hardcodé à 0.5m. Pas d'UI pour choisir le pas (0.1m, 0.25m, 0.5m, 1m).
- **Déplacement de polygone sans historique** : Le déplacement d'un polygone ou d'un point mute directement le tableau `this.points` / `this.polygons`. Pas d'intégration avec le store undo/redo.
- **dragStartWorld mis à jour à chaque move** : Le drag calcule le delta depuis le dernier move (pas depuis le start). C'est correct pour un drag fluide mais rend impossible la détection d'un "undo to drag start" simple.
- **Pas de détection de clic vs drag** : Pas de seuil de distance pour distinguer un clic d'un glissement dans InteractionManager (contrairement à drawPolygon.ts qui gère `CLICK_DRAG_THRESHOLD_PX = 4`).

---

### 2.5 DrawPolygon — Outil de dessin des pans

**Fichier** : `calpinage/tools/drawPolygon.ts`

C'est le fichier le plus riche de la Phase 2. Analyse approfondie :

**Ce qui est bien :**
- Séparation nette dessin en cours / édition existante / hover.
- `clampToImage()` : les points ne sortent pas de l'image. Correct.
- `CLICK_DRAG_THRESHOLD_PX = 4` : distinction clic / drag bien gérée.
- Curseur contextuel : crosshair pendant le dessin, pointer sur vertex, default sinon.
- `snapToVertex()` : snap aux sommets des pans existants, avec exclusion du sommet en cours de drag.

**Problèmes identifiés :**

**Snap magnétique — analyse fine :**
- Le snap (`SNAP_TOLERANCE_PX = 6`) n'est appliqué que lors du **drag d'un sommet existant** (dans `onMouseMove` si `dragging`). Pendant le dessin d'un nouveau pan (ajout de points), le snap vers les sommets existants n'est **pas appliqué**.
- Pas de snap aux **arêtes** des pans existants (snap edge-to-edge).
- Pas de snap aux **milieux** de segments.
- Pas de snap **orthogonal** (horizontal / vertical, à 45°, à 90° d'une arête existante).
- Les points snapés ne sont pas "liés" : si le pan A est modifié, le pan B qui avait un sommet au même endroit ne se met pas à jour. Pas de graph de connectivité réel.

**Dessin de polygone :**
- **Délai de 200ms sur l'ajout de point** : `addPointTimeoutId = setTimeout(..., 200)`. Ce délai existe pour éviter le conflit avec le double-clic, mais il crée un lag perceptible à l'ajout de chaque point.
- **Race condition potentielle** : Si l'utilisateur fait un single-click suivi immédiatement d'un double-click avant les 200ms, le point s'ajoute ET le polygone se ferme.
- **Pas de prévisualisation de fermeture** : Quand la souris passe près du premier point du polygone en cours de dessin, aucun feedback visuel indiquant que le prochain clic fermera le polygone. Ce feedback est présent dans des outils comme QGIS, Solteo, etc.
- **Fermeture uniquement par double-clic** : Pas d'option de fermeture par retour sur le premier point (clic sur le point d'origine).
- **Pas d'annulation de point en cours** : Pas de touche Escape ou Backspace pour annuler le dernier point ajouté pendant le dessin.

**Édition des pans existants :**
- **Pas de suppression de sommet** : Impossible de supprimer un sommet (ex. clic droit → supprimer, ou sélection + Delete).
- **Pas d'ajout de sommet sur une arête** : Impossible d'insérer un sommet au milieu d'un segment d'un pan existant (edge-split). Pour ajouter un angle intermédiaire, l'utilisateur doit redessiner entièrement.
- **Pas de déplacement de pan entier** : L'InteractionManager peut déplacer un polygone entier, mais drawPolygon.ts ne l'intègre pas. Seuls les sommets individuels sont déplaçables.
- **Pas de suppression de pan** : Le code de drawPolygon.ts n'expose pas de mécanisme pour supprimer un pan entier (peut être géré ailleurs dans l'UI).

**Rendu :**
- La couleur des pans actifs vs inactifs est `rgba(201, 164, 73, X)` — toujours la même teinte dorée, seule l'opacité change. Difficile de distinguer plusieurs pans non sélectionnés sur une toiture complexe.
- Les sommets des pans non actifs sont **non affichés**. Correct (réduction surcharge), mais lors du snap il serait utile de voir les sommets des pans adjacents.
- **Pas de label/numéro sur les pans** dessinés directement sur le canvas.

---

### 2.6 Obstacles (cercle & rectangle)

**Fichier** : `smartpitch/calpinage/canvas/obstacles.ts`

**Ce qui est bien :**
- Séparation préview (pointillé, no fill) vs posé (plein + fill).
- Hit-test avec tolérance pixel (8px) pour les bords. Correct pour la sélection sur arête.
- `distToSegment` implémenté correctement avec `t = clamp(0,1)`.
- Priorité au dernier dessiné dans `hitTestObstacles` (itération inverse). Cohérent avec l'ordre de rendu.

**Problèmes identifiés :**
- **Seulement 2 types** : cercle et rectangle. Pas de **polygone libre** comme obstacle. Pourtant, les cheminées, lucarnes, velux, châssis de toit ont souvent des formes quelconques.
- **Pas de hauteur d'obstacle** : Le commentaire dit "Prévoir extensibilité future (hauteur) sans l'implémenter." Mais la hauteur est critique pour le calcul d'ombrage proche. Les obstacles sans hauteur ne peuvent pas générer d'ombre.
- **Pas de label/nom sur les obstacles** : Un obstacle posé n'a pas de libellé affiché sur le canvas.
- **Rectangle non rotatif** : Le rectangle est toujours axis-aligned. Un velux ou un châssis positionné en diagonale ne peut pas être représenté correctement.
- **`_hitTestOneWithScale` est défini mais jamais utilisé** (wrapper inutile de hitTestOne) : dead code.
- **Duplication de `pointInPolygon`** : Re-implémentée dans obstacles.ts alors qu'elle existe dans hitTest.ts (même package).

---

### 2.7 Calibration

**Fichier** : `calpinage/tools/calibrationTool.ts`

**Ce qui est bien :**
- `MIN_PIXEL_DISTANCE = 5` : garde contre division par quasi-zéro.
- Calcul `metersPerPixel = meters / pixelDistance` : correct et simple.
- Stockage des deux points A et B de calibration : traçabilité possible.

**Problèmes identifiés :**
- **Calibration à 1 seule mesure** : L'erreur de placement des deux points impacte directement toute la précision. Un système de double calibration ou de calibration multi-points serait plus robuste.
- **Pas de vérification de cohérence avec la source d'image** : Si l'image est une capture Google Maps, la résolution native est connue. Aucune cross-validation.
- **Pas de détection de calibration aberrante** : Une valeur `metersPerPixel` de 0.0001 ou 100 n'est pas rejetée. Pas de plage de cohérence (ex. refus si < 0.001m/px ou > 1m/px pour une toiture résidentielle).
- **Outil "Mesure" mentionné dans le header mais non vérifié ici** : L'outil de vérification de cohérence existe dans le code mais n'est pas exposé clairement dans l'UI d'après la spec.
- **Pas de persistance de la calibration entre sessions** : Si l'utilisateur recharge, la calibration est perdue (dépend du store caller).

---

### 2.8 Outil Nord

**Fichier** : `calpinage/tools/northTool.ts`

**Ce qui est bien :**
- Mode auto-google : `northAngleDeg = -bearingDeg` est mathématiquement correct (sens de rotation inversé).
- Mode manuel disponible.
- Formule de référence documentée : `azimutReelDeg = panAngleImageDeg + northAngleDeg`.
- `normalizeAngleDegForDisplay` correctement implémenté.

**Problèmes identifiés :**
- **Pas de vérification du bearing Google** : Si la valeur `bearingDeg` fournie est `null`, `undefined` ou `NaN`, l'angle Nord sera incorrect sans erreur visible.
- **Accumulation d'erreur azimutale** : La formule `azimutReelDeg = panAngleImageDeg + northAngleDeg` est une simple addition. Si `northAngleDeg` est imprécis (mode manuel), tous les azimuts de tous les pans héritent de l'erreur.
- **Pas de flèche Nord interactive sur le canvas** : Le module définit l'angle mais ne gère pas le rendu de l'indicateur Nord visible sur la carte (géré ailleurs, peut-être dans `NorthArrowOverlay.ts` — non audité mais présent).
- **Mode manuel sans feedback de précision** : L'utilisateur règle l'angle par slider mais n'a pas de référence pour savoir s'il est correct (pas de nord magnétique GPS, pas de comparaison avec les ombres).

---

### 2.9 État des pans (panState)

**Fichier** : `calpinage/state/panState.ts`

**Ce qui est bien :**
- `Point2D.h` optionnel : les hauteurs peuvent être définies progressivement.
- `Point2DConstraints` (lock, minH, maxH) : extensible.
- `PanPhysical` : slope et orientation calculées ou manuelles, bien typées.
- Champ `traitIds`, `ridgeIds` : préparé pour la détection de pans adjacents.

**Problèmes identifiés :**
- **`panState` est un objet singleton mutable global** : `export const panState = { pans: [], ... }`. Toute mutation directe (ex. `panState.pans.push(...)`) contourne le store undo/redo. Risque de désynchronisation.
- **Rétrocompatibilité fragile** : `polygon?: { x: number; y: number }[]` comme legacy est conservé. Si les deux existent (`points` et `polygon`), quelle priorité ? Le commentaire dit "peut être dérivé de .polygon via ensurePansHavePoints" mais ce n'est pas typesafe.
- **Pas de validation de géométrie dans le type** : `Polygon` est juste `Point[]`. Rien n'empêche un polygone auto-intersectant d'être stocké.
- **`activePanId` et `activePoint` sont dans le même état** mais `activePoint` est une sélection plus fine. Si `activePanId` change, `activePoint` devrait être réinitialisé automatiquement. Ce n'est pas garanti.
- **Pas d'ID de version / hash** : Impossible de détecter si un pan a été modifié depuis la dernière sauvegarde sans comparer toutes les coordonnées.

---

### 2.10 Spec UX vs Implémentation réelle

Comparaison entre `ux-interactions-calpinage-2d.md` et le code réel :

| Fonctionnalité UX spec | Implémenté ? | Commentaire |
|---|---|---|
| Séparation zone carte / menu gauche | ✅ | Architecture définie |
| 3 états pan : non-sélectionné / sélectionné / actif-édition | ⚠️ | `activePanId` + `activePoint` mais pas de troisième état "édition" explicite |
| Sommet partagé distinct visuellement | ❌ | Non implémenté — les sommets sont indépendants |
| Indicateur état cohérence du pan | ❌ | Non visible dans le code audité |
| Slider pour hauteur | ❌ | Non visible dans le code audité |
| Contrôles incrémentaux +/- hauteur | ❌ | Non visible dans le code audité |
| Verrouillage de pan | ⚠️ | `lock` dans `Point2DConstraints` défini mais UI inconnue |
| Validation explicite du pan | ❌ | Non visible dans le code audité |
| Indication pente/orientation sur carte | ⚠️ | `northTool.ts` + overlay prévu, mais pas de flèche de pente sur chaque pan |
| Snap vertex-to-vertex pendant dessin | ❌ | Snap seulement lors du drag, pas lors de l'ajout de point |
| Preview fermeture polygone | ❌ | Non implémenté |
| Annulation dernier point (Escape) | ❌ | Non implémenté |

---

## 3. PHASE 3 — PLACEMENT PV & BLOCS

### 3.1 Architecture blocs (activePlacementBlock)

**Fichier** : `calpinage/state/activePlacementBlock.js`

**Concept :**
- Un seul bloc "actif" à la fois (éditable). Les autres blocs sont "figés".
- Le bloc actif peut être re-sélectionné via `setActiveBlock(blockId)`.
- Manipulation (déplacement/rotation) via `manipulationTransform` sans modifier les données réelles jusqu'au `commitManipulation()`.

**Ce qui est bien :**
- La séparation bloc-actif / blocs-figés est claire.
- Le commit de manipulation (commit puis recompute) évite les états intermédiaires corrompus.
- `crypto.randomUUID()` avec fallback pour les IDs : robuste.
- `getBlockCenter` calculé comme centroïde des centres de panneaux.

**Problèmes identifiés :**
- **Singleton global** : `activeBlock` et `frozenBlocks` sont des variables de module partagées. Pas thread-safe (peu important en JS single-thread), mais une double-init ou un HMR peut corrompre l'état.
- **Pas de limite de blocs** : Théoriquement illimité. Sur un grand toit avec des centaines de blocs, la validation `collectOtherPanelPolysForValidation` (quadratique) peut devenir lente.
- **`ensureSingleActiveBlock`** : Quand un nouveau bloc est activé, l'ancien est automatiquement figé et ajouté à `frozenBlocks`. Mais si l'ancien bloc actif était invalide, il est figé tel quel (état invalide).

---

### 3.2 pvPlacementEngine

**Fichier** : `calpinage/engine/pvPlacementEngine.js`

**Ce qui est bien :**
- `buildProjectionContext()` documentée comme **pure** — vérifiée, pas d'accès global.
- Validation complète `validatePanelPolygon` : obstacles + autres panneaux + keepout faîtage/trait.
- Gestion du mode `__CALPINAGE_PV_STRICT__` pour le dev.
- Guard `window.CALPINAGE_IS_MANIPULATING` : pendant une manipulation, les recomputes sont bloqués — correct pour éviter les conflits.
- Duplication de pointInPolygon, distancePointToSegment, etc. — mais au moins ils sont locaux au module.

**Problèmes identifiés :**
- **Dépendance aux globals** : `getAPB()`, `getComputeProjectedPanelRect()` — ces fonctions cherchent dans `global.XXX` puis `window.XXX`. Fragile, non testable sans mocking window.
- **Pas de snap de panneau à la grille** : La position finale d'un panneau est calculée depuis un centre en pixels flottants. Pas de quantification à l'espacement déclaré.
- **`recomputeBlock` bloqué si `CALPINAGE_IS_MANIPULATING`** : C'est correct fonctionnellement, mais si la manipulation se termine sans déclencher un recompute (bug de pointerup), les projections restent invalides.
- **`collectOtherPanelPolysForValidation`** : Pour chaque panneau à valider, elle itère tous les blocs figés + le bloc actif. Complexité O(N_panels × N_blocs × N_panels_par_bloc). Sur un gros projet, cela peut bloquer le thread UI.
- **Pas de batch recompute debounced** : Chaque modification déclenche un recompute immédiat. Pas de RAF ou setTimeout pour regrouper les updates.

---

### 3.3 Ghost Slots — LE PROBLÈME GRAND TOIT

**Fichier** : `calpinage/ghostSlots.js`

**Concept :**
Les ghost slots sont les emplacements fantômes proposés autour du dernier panneau posé. L'utilisateur voit des "zones transparentes" cliquables pour poser le prochain panneau.

**Ce qui est bien :**
- Les 4 directions (haut, bas, gauche, droite) sont calculées depuis les axes réels du pan (slopeAxis, perpAxis). Correct pour les pans inclinés.
- Validation complète avant de proposer un slot (inside polygon + margin + no ridge crossing + no obstacle + no panel overlap).
- Un slot invalide n'apparaît pas du tout. Règle métier respectée.
- Les espacements X et Y sont correctement convertis cm → pixels via metersPerPixel.

**PROBLÈME MAJEUR — Grand toit, pose panneau par panneau :**

Le système impose de poser les panneaux **un par un**, en cliquant successivement sur chaque ghost slot. Pour un toit de 200m² avec 60 panneaux, c'est 60 clics obligatoires, sans compter les erreurs et corrections.

**Impact :** Sur un TOIT IMMENSE (entrepôt, bâtiment industriel, grande maison), la pose est linéaire = O(N clics) pour N panneaux. Il n'existe aucun mode de remplissage automatique.

**Lacunes spécifiques :**
- **Pas de "fill zone"** : Sélectionner une zone rectangulaire ou le pan entier et demander un remplissage auto.
- **Pas de "duplicate bloc"** : Copier-coller un bloc entier avec décalage.
- **Pas de "array/repeat"** : Créer N×M panneaux en une fois.
- **Pas de drag-to-place** : Glisser pour étendre le bloc (comme dans PVsyst ou Archelios).
- **Ghost slots limités à 4 directions** : Pas de slot en diagonale (certains modules permettent la pose en quinconce).
- **Ghost slots ne se propagent pas** : On voit les slots du dernier panneau actif, pas de preview de toute la rangée possible.

---

### 3.4 Comportement DP2 — Interaction canvas

**Fichier** : `calpinage/tools/calpinage-dp2-behavior.js`

**Ce qui est bien :**
- Séparation claire entre mode `panels` (pose) et `select` (sélection/déplacement).
- Hit-test sur `projection.points` uniquement — cohérent avec le moteur de placement.
- `setPointerCapture` pour le drag et la rotation — capture correcte même si le pointeur sort du canvas.
- Le handle de rotation (cercle doré #C39847, 8px, en haut du bbox bloc) est visuellement distinct.
- Guard `CALPINAGE_STATE.currentPhase === "PV_LAYOUT"` : désactive les interactions en Phase 3. (Note : la vérification semble inversée — `if (phase === "PV_LAYOUT") return` désactive au lieu d'activer).

**Problèmes identifiés :**
- **Rotation libre sans snap angulaire** : La rotation du bloc est libre (en radians). Pas de snap à 90°, 45°, 180°. Un utilisateur qui veut aligner parfaitement un bloc devra utiliser une valeur numérique dans un champ si disponible.
- **Pas de feedback d'angle pendant la rotation** : Aucun affichage de l'angle en cours (ex. "15.3°") pendant le glissement du handle.
- **Pas de multi-sélection** : Un seul panneau sélectionnable à la fois (`getEffectiveSelectedRefs` retourne au plus un). Impossible de sélectionner plusieurs panneaux pour les supprimer/modifier ensemble.
- **`state.blockRotation` et `state.blockManipulation` sont des propriétés ajoutées dynamiquement sur un objet `state` passé en option** : Pas de typage, pas de valeur initiale garantie.
- **`window.__CALPINAGE_ROTATE_HITTEST`** : Exposé sur window pour usage externe. Pattern fragile.
- **Délégation `window.recomputeAllPlacementBlocksFromRules`** après commit de manipulation : dépendance sur une fonction globale non typée.
- **La condition "PV_LAYOUT"** mérite une vérification : si `currentPhase === "PV_LAYOUT"` bloque les outils, cela signifie que pendant la phase de layout PV, aucune interaction n'est possible ? Ou c'est l'inverse ? La logique est potentiellement inversée.

---

### 3.5 CalpinageStore — État & Historique

**Fichier** : `smartpitch/calpinage/store/calpinageStore.ts`

**Ce qui est bien :**
- Pattern store observable (pub/sub) clair.
- Undo/redo avec limite HISTORY_LIMIT = 50. Limite mémoire contrôlée.
- Invalide le redo stack à chaque nouveau setState. Comportement correct.
- `deepClone` systématique : l'état est immutable (pas de reference sharing).
- `updatedAt` mis à jour à chaque setState et undo/redo.

**Problèmes identifiés :**
- **`deepClone` à chaque opération** : `getState()`, `setState()`, `undo()`, `redo()` font tous un `deepClone`. Pour un état avec 50+ blocs, chacun avec 10+ panneaux, c'est potentiellement plusieurs MB clonés par interaction. Pas de mesure de performance.
- **Singleton** : `export const calpinageStore = new CalpinageStore()`. Si deux instances de CalpinageApp existent (ex. comparaison multi-onglets), elles partagent le même store. Race condition.
- **Listeners non asynchrones** : `emit()` appelle tous les listeners synchroniquement dans la boucle. Un listener lent bloquera tous les autres.
- **Pas de persistence automatique** : Le store ne sauvegarde rien. La persistence est à la charge du caller. Si le caller oublie de sauvegarder, les données sont perdues à la fermeture.
- **HISTORY_LIMIT = 50 états** : Avec un deepClone complet à chaque état, 50 états d'un grand projet = potentiellement 50 × 5MB = 250MB en mémoire. Pas de compression.
- **`meta.action` documenté mais ignoré** : `void meta;` — le label d'action pour le debugging est accepté mais jamais utilisé. Opportunité de logging manquée.

---

## 4. PHASE 3D — VIEWER THREE.JS

**Fichier** : `calpinage/phase3/phase3Viewer.js`

### Ce qui est bien

- Centrage automatique sur le modèle via `Box3` + `getSize/getCenter`.
- `computeVertexNormals()` pour l'éclairage correct des toits.
- ResizeObserver si disponible, fallback `window.resize`. Adaptation responsive.
- `dispose()` propre : géométries, matériaux, renderer, listeners.
- `setVisible()` pour montrer/cacher sans recréer.
- `devicePixelRatio` clampé à 2 : évite une sur-résolution coûteuse.
- `alpha: false` pour le renderer : légèrement plus performant que alpha:true.

### Problèmes identifiés

**Architecture :**
- **Boucle `requestAnimationFrame` infinie** : `animate()` tourne même quand le viewer est caché (`setVisible(false)` cache le DOM mais ne stoppe pas la boucle). Gaspillage CPU/GPU constant.
- **Pas de "dirty flag"** : Le renderer re-rendu à chaque frame même si rien n'a changé (pas d'interaction, pas d'animation). Devrait être "on-demand" : render seulement après interaction.
- **Événements mouse sur `global` (window)** : `global.addEventListener("mousemove", onPointerMove)` et `global.addEventListener("mouseup", onPointerUp)`. Si le viewer est dans une iframe ou si plusieurs viewers existent, tous captent tous les events.
- **Un seul `THREE` global** : `var THREE = global.THREE` — Three.js doit être chargé en tant que script global. Pas de module ES import. Incompatible avec le bundling moderne (sauf configuration spécifique).

**Fonctionnalités manquantes :**
- **Pas de touch/tactile** : `mousedown/mousemove/mouseup` uniquement. Sur tablette = inutilisable.
- **Pas de pan (déplacement de la cible)** : Seuls rotation (bouton gauche) et zoom (molette) sont disponibles. Pas de déplacement de la cible (bouton droit ou Ctrl+drag). Pour un grand modèle, impossible de se positionner précisément.
- **Pas de zoom clavier** : +/- ou Ctrl+scroll non gérés.
- **Pas de panneaux PV dans la vue 3D** : Seuls les murs et la toiture sont affichés. Les panneaux posés en Phase 2 ne sont pas représentés en 3D. C'est une limitation majeure pour la visualisation client.
- **Fond fixe noir** (`0x111111`) : Pas de ciel, pas d'environnement HDR, pas de sol. L'aspect est très sobre / "démo technique".
- **Pas d'ombres Three.js** : `renderer.shadowMap.enabled` n'est pas activé. Pas d'ombres portées. Le résultat visuel est plat.
- **Pas de wireframe toggle** : Pas de mode "fil de fer" pour voir la structure.
- **Matériaux basiques** : `roughness: 0.9, metalness: 0` pour les murs et `roughness: 0.85` pour les toits. Pas de textures. Rendu peu réaliste.

**Géométrie :**
- **Swap Y/Z dans `threeVerts`** : `threeVerts.push(verts[vi], verts[vi + 2], verts[vi + 1])` — permutation Y↔Z pour passer du repère toiture (Z=hauteur) au repère Three.js (Y=haut). C'est documenté implicitement mais un commentaire explicite manque. Une erreur ici corromprait tout le modèle 3D.
- **`ExtrudeGeometry` pour les murs** : Les murs sont extrudes depuis un contour 2D. Si le contour n'est pas un polygone valide (auto-intersectant), la géométrie sera corrompue sans erreur explicite.
- **Pas de LOD** : Un seul niveau de détail. Pour un modèle complexe (copropriété, bâtiment industriel), pas d'adaptation de complexité au zoom.

---

## 5. OMBRAGE

### 5.1 Modèle solaire (solarPosition.js)

**Ce qui est bien :**
- Basé sur NOAA / Meeus : référence scientifique solide.
- Calcul en UTC, pas en heure locale : évite les erreurs DST.
- `clamp(-1, 1)` avant `Math.acos` : pas de NaN sur les cas limites.
- Correction azimut `sin(ha) > 0` pour le quadrant correct.

**Problèmes identifiés :**
- **`timezone` accepté mais ignoré** : Le paramètre est dans la signature mais le commentaire dit explicitement "accepté mais ignoré (pas de conversion)". Si un appelant passe une date en heure locale en pensant que la timezone sera prise en compte, les positions solaires seront fausses de plusieurs heures (erreur pouvant atteindre 2h en été).
- **Pas de correction de réfraction atmosphérique** : L'élévation calculée est géométrique, pas apparente. À l'horizon, la réfraction ajoute ~0.57°, ce qui peut décaler le lever/coucher du soleil de plusieurs minutes et affecter les calculs d'ombrage à faible élévation.
- **Modèle simplifié NOAA** : Précision de ~1° en azimut/élévation. Pour les calculs énergétiques PV, c'est acceptable, mais pas au niveau de SPA (Solar Position Algorithm, NREL) qui donne <0.0003° d'erreur.
- **Pas de test de plage de latitude** : Le clamp `Math.max(-90, Math.min(90, latDeg))` puis `if (lat !== latDeg) return null` rejet des valeurs hors plage. Mais une latitude de 89.9° (proche pôle) n'est pas rejetée alors que le modèle n'est pas optimisé pour les zones polaires.

---

### 5.2 Ombrage proche (nearShadingCore.cjs)

**Ce qui est bien :**
- Grille configurable N×N (défaut 5×5 = 25 points) par panneau. Supérieur au shadingEngine.js (3×3 = 9 points).
- `resolveMetersPerPixel` avec fallback sûr à 1.
- `centroid` calculé pour les obstacles circulaires.

**Problèmes identifiés :**
- **Raycast planaire Z=0** : Toute la géométrie est supposée au niveau z=0 (toit plat). Pour un pan incliné à 30°, un panneau en haut du pan est physiquement plus haut qu'un panneau en bas. L'ombrage entre panneaux de rangs différents sur un pan incliné est donc incorrectement calculé. Le raycast suppose que tous les panneaux sont à la même altitude.
- **Pas de prise en compte de l'inclinaison du panneau** : Le vecteur normal du panneau n'est pas utilisé pour calculer le cosinus d'incidence. Le shading est calculé en projection au sol, pas sur la surface inclinée réelle du panneau.
- **Grille bounding box, pas surface réelle** : `samplePanelPoints` génère une grille sur le bounding box du polygone, puis filtre les points hors polygone. Pour un panneau fortement déformé (pan très incliné), le bounding box est large et de nombreux points peuvent être hors polygone réel → sous-échantillonnage.

---

### 5.3 Ombrage lointain (horizonMaskEngine.js)

**Ce qui est bien :**
- Architecture simple : comparaison élévation solaire vs élévation horizon.
- Pondération par échantillon (blocked/total).

**Problèmes identifiés :**
- **Pas d'interpolation angulaire** : `index = Math.floor(a / azimuthStepDeg)` — discrétisation sans interpolation. Entre deux mesures horizon, la transition est en créneau. Si `azimuthStepDeg = 10°`, un obstacle à 185° d'azimuth est ignoré si le soleil est à 184°.
- **Pas de pondération par flux** : Chaque sample compte pour 1, qu'il soit à fort ou faible rayonnement. Un sample à midi (fort rayonnement) compte autant qu'un sample à 7h du matin (faible). Devrait être pondéré par l'énergie incidente (cos(angle zénithal)).
- **Attaché à `window.computeHorizonFarLoss`** : Pattern global. Si une deuxième instance charge le script, elle écrase la première.
- **Pas de validation du masque horizon** : Pas de vérification que `elevations.length` correspond à `360 / azimuthStepDeg`.

---

### 5.4 shadingEngine.js — Pipeline principal

**Ce qui est bien :**
- Combinaison ombrage proche + lointain en un pipeline.
- `isSunBlockedByHorizonMaskSafe` pour le far shading avant le near shading : correct (skip near si déjà bloqué).
- `computeAnnualShadingLoss` retourne des `panelStats` par panneau : granularité utile.
- La formule `annualLossPercent = 100 * (1 - totalWeightFarNear / totalWeightBaseline)` est cohérente avec le backend (documenté).

**Problèmes identifiés :**
- **`annualLossKWh` est toujours `undefined`** : Le champ existe dans le retour mais n'est jamais calculé. Pour afficher une perte en kWh, il faudrait connaître la puissance installée, ce qui n'est pas dans ce module. Mais le champ vide peut induire en erreur.
- **stepMinutes = 30 fixe** : 365 jours × 24h × 2 samples = 17520 samples maximum. En pratique après filtrage élévation < 5°, environ 4000-6000 samples annuels. C'est raisonnable mais pas configurable par défaut dans l'UI.
- **`CIRCLE_SEGMENTS = 16` pour circleToPolygon** : Un cercle discrétisé en 16 segments. Pour une petite cheminée ronde, c'est suffisant. Pour un grand obstacle circulaire (cuve, tour), les erreurs angulaires peuvent affecter le calcul d'ombrage.
- **`normalizeObstacles` — type detection fragile** : `shape = (o.shape || o.meta?.type || o.type || o.shapeMeta?.originalType || "")`. Si aucun de ces champs n'est présent mais que `points` existe, il passe dans le fallback. Cela peut accepter des obstacles malformés.
- **Pas de cache des vecteurs solaires** : `generateAnnualSamples` est appelée à chaque `computeAnnualShadingLoss`. Les 5000+ positions solaires sont recalculées à chaque appel même si lat/lon/année n'ont pas changé.

---

## 6. CATALOGUE PV

**Fichier** : `src/api/pvCatalogApi.ts`

### Ce qui est bien

- Types complets pour panneaux, onduleurs, batteries : `PvPanel`, `PvInverter`, `PvBattery`.
- `togglePanelActive`, `toggleInverterActive`, `toggleBatteryActive` : actions claires.
- Filtrage par `family` sur les onduleurs : `listInverters("CENTRAL" | "MICRO")`.

### Problème — Ordre du catalogue

**Problème signalé : l'ordre du catalogue est défini par l'insertion DB, pas par l'usage ou la sélection.**

- **Pas de champ `sort_order`** : L'API ne définit aucun champ de tri explicite. L'ordre de `listPanels()` dépend de la DB (probablement `created_at ASC` ou `id ASC`).
- **Pas de tri côté client** : Aucune logique de tri visible dans l'API (par marque, puissance, nom, usage fréquent).
- **Pas de "favoris" ou "récemment utilisés"** : Pour un installateur qui utilise toujours le même panneau, il doit scroller jusqu'à trouver son produit favori à chaque nouveau projet.
- **Pas de recherche dans le catalogue** : Pas de paramètre `q=` ou `name=` dans l'API. Pour un grand catalogue (50+ modèles), il faut scroller.

### Autres lacunes catalogue

- **Pas de pagination** : `listPanels()` retourne **tous** les panneaux actifs. Sur un grand catalogue, une seule requête peut retourner des centaines d'éléments.
- **`warranty_product_years`, `warranty_performance_years`** sont optionnels : pour la génération de devis, l'absence de ces champs peut être problématique.
- **`temp_coeff_pct_per_deg`** optionnel : coefficient de température non obligatoire alors qu'il est critique pour le calcul de production par temps chaud.
- **`voc_v`, `isc_a`, `vmp_v`, `imp_a`** optionnels : données électriques non requises. Pour le dimensionnement chaîne, ces données sont indispensables. L'onduleur ne peut pas être validé sans elles.
- **Pas de donnée de courbe I-V** : Le modèle est simplifié (1 point Vmpp/Impp). Pas de modèle 5-paramètres pour la simulation précise.
- **Pas de fichier datasheet attaché** : Le catalogue ne stocke pas les PDFs fiches techniques des panneaux.

---

## 7. PHASE3CHECKLISTPANEL

**Fichier** : `src/modules/calpinage/Phase3ChecklistPanel.tsx`

### Ce qui est bien

- Distinction CENTRAL vs MICRO pour le ratio AC/DC : correct métier.
- `validationOk` bloquant sur `ratio >= 0.8` pour CENTRAL uniquement.
- Icônes d'état SVG inline : pas de dépendance externe.

### Problèmes identifiés

**Vérifications manquantes dans la checklist :**
- ❌ **Ombrage non vérifié** : La checklist ne bloque pas si l'ombrage annuel est > X%.
- ❌ **Orientation non vérifiée** : Pas d'alerte si tous les panneaux sont orientés au Nord (orientation défavorable).
- ❌ **Inclinaison non vérifiée** : Pas d'alerte pour une pente trop forte (risque glissement) ou trop faible (encrassement).
- ❌ **Distance au faîtage non vérifiée** : Les normes DTU/locales imposent des distances minimales au faîtage et à l'égout. Non vérifié.
- ❌ **Charge structurelle non vérifiée** : Pas de calcul de charge (kg/m²) ni alerte si la densité de pose est excessive.
- ❌ **MPPT non vérifié** : Pour un onduleur multi-MPPT, la répartition des strings par MPPT n'est pas vérifiée.
- ❌ **Chaîne (string) sizing non vérifié** : Nb panneaux / string, tension Voc à froid, tension Vmp → compatibilité avec les MPPT de l'onduleur.
- ❌ **Production estimée absente** : La checklist affiche le ratio mais pas la production annuelle estimée (kWh/an, kWh/kWc) pour validation.

**Logique checklist :**
- `validationOk` est calculé mais son impact sur le workflow (bloquer la validation, afficher un bouton) n'est pas visible dans ce composant (géré par le parent).
- **Ratio > 1.4 → warning (pas error)** : Un onduleur surdimensionné est un warning, pas une erreur. C'est discutable — un ratio de 2.0 peut être un vrai problème.

---

## 8. CALPINAGEAPP — BOOTSTRAP & INIT

**Fichier** : `src/modules/calpinage/CalpinageApp.tsx`

### Ce qui est bien

- Guards contre les double-inits (`initInFlightRef`, `hasInitializedRef`).
- `retryRequestedRef` pour les inits concurrentes : pattern robuste.
- `cancelledRef` pour éviter les setState après unmount.
- `resetCalpinageDepsCache` sur retry : évite les caches corrompus.

### Problèmes identifiés

- **`initCalpinage` en module JS legacy** : L'entrée principale du calpinage est une fonction JS vanilla sans types. Toute la complexité de l'initialisation est dans ce fichier non audité.
- **`queueMicrotask(() => runInit(true))`** en cas d'absence de container : si le container n'existe jamais, cela peut créer une boucle infinie (limité par `isRetry` unique — une seule tentative).
- **`setLoading(true)` au début, `setLoading(false)` à la fin** : Si l'init est rapide, un flash de loading screen peut apparaître. Pas de délai minimum (ex. 300ms) pour éviter le flash.
- **`onValidateRef`** pattern : utilisation de `useRef` pour éviter de re-créer le callback d'init. Correct mais ajoute de la complexité.
- **Pas de timeout sur l'init** : Si `ensureCalpinageDeps()` ne se résout jamais (réseau coupé, Google Maps non chargé), l'utilisateur reste bloqué sur le spinner indéfiniment. Pas de timeout ou de message d'erreur différé.

---

## 9. PROBLÈMES TRANSVERSAUX

### 9.1 Duplication de `pointInPolygon`

**Implémentée dans au moins 7 fichiers :**
1. `hitTest.ts`
2. `drawPolygon.ts`
3. `obstacles.ts`
4. `ghostSlots.js`
5. `pvPlacementEngine.js`
6. `nearShadingCore.cjs`
7. `shadingEngine.js`
8. `calpinage-dp2-behavior.js`

Toutes les implémentations utilisent l'algorithme ray-casting avec le même cas dégénéré `yi === yj` ignoré. Elles semblent identiques, mais une divergence future est probable. Une seule implémentation dans un module partagé est nécessaire.

### 9.2 Variables globales window

Liste exhaustive des globals utilisées :
- `window.CALPINAGE_STATE` — état global du calpinage
- `window.CALPINAGE_IS_MANIPULATING` — flag de manipulation en cours
- `window.recomputeAllPlacementBlocksFromRules` — callback global
- `window.computeAnnualShadingLoss` — moteur ombrage
- `window.getAnnualSunVectors` — vecteurs solaires
- `window.getSunPositionAt` — position solaire
- `window.GhostSlots` / `window.computeGhostSlots` — moteur ghost slots
- `window.computeProjectedPanelRect` — projection panneau
- `window.ActivePlacementBlock` — moteur bloc actif
- `window.Phase3Viewer` / `window.initPhase3Viewer` — viewer 3D
- `window.computeHorizonFarLoss` — ombrage lointain
- `window.__CALPINAGE_PV_STRICT__` — flag dev
- `window.__SHADING_SOLAR_POSITION__` — module solaire
- `window.__SHADING_HORIZON_MASK_SAMPLER__` — module horizon
- `window.__CALPINAGE_ROTATE_HITTEST` — API test rotation

**Au moins 15 globals identifiées.** Risque de collision avec d'autres bibliothèques, HMR cassé, tests unitaires impossibles sans mocking complet de window.

### 9.3 Pas de gestion d'erreur unifiée

Chaque module gère ses erreurs différemment :
- `validateAndApplyCalibration` retourne `{ ok: false, error: string }`.
- `createBlock` retourne `{ block: null, success: false, reason: string }`.
- `hitTestObstacles` retourne `null`.
- `computeAnnualShadingLoss` retourne `null` pour les coords invalides.

Pas de type d'erreur unifié, pas de error boundary au niveau du moteur.

### 9.4 Pas de mode hors-ligne / offline

Le calpinage dépend de Google Maps pour la capture satellite. Si Maps n'est pas disponible, `ensureCalpinageDeps()` peut échouer. Pas de mode dégradé avec image uploadée manuellement (bien qu'un `DocumentUploader.tsx` existe dans les composants).

---

## 10. SYNTHÈSE & PRIORISATION

### Critique — Bloquant ou très impactant (à traiter en priorité)

| # | Sujet | Impact |
|---|---|---|
| C1 | **Grand toit : pose panneau par panneau sans fill** | Productivité installateur ×10 si correction |
| C2 | **Snapping grille désactivé** (SNAPPING_ENABLED = false) | Précision du dessin dégradée |
| C3 | **Boucle RAF 3D infinie même viewer caché** | Gaspillage CPU permanent |
| C4 | **15+ globals window** : impossible à tester, HMR fragile | Dette technique majeure |
| C5 | **timezone ignoré dans solarPosition.js** | Erreurs silencieuses d'heures |
| C6 | **Ombrage suppose z=0 (toit plat)** pour tous les panneaux | Inexactitude pour toits inclinés |

### Important — Significatif

| # | Sujet |
|---|---|
| I1 | Snap magnétique partiel (seulement sur drag, pas sur ajout de point ; pas de snap arête) |
| I2 | Points de pans non liés (pas de connectivité réelle) |
| I3 | Pas de feedback angle pendant rotation de bloc |
| I4 | Catalogue sans ordre utilisateur, sans recherche, sans favoris |
| I5 | `annualLossKWh` jamais calculé (undefined) |
| I6 | Pas de cache des vecteurs solaires annuels |
| I7 | Validation de panneau quadratique (O(N²)) sans debounce |
| I8 | Absence de panneaux PV dans la vue 3D |
| I9 | `deepClone` systématique dans le store : risque perf sur grands projets |
| I10 | Pas d'interpolation angulaire dans horizonMaskEngine |
| I11 | Tolérance hitPoint en mètres, pas en pixels (dépend du zoom) |

### Améliorations UX / Confort

| # | Sujet |
|---|---|
| U1 | Preview de fermeture polygone sur premier point |
| U2 | Annulation dernier point par Escape ou Backspace |
| U3 | Ajout de sommet sur arête existante (edge-split) |
| U4 | Suppression de sommet (sélection + Delete) |
| U5 | Pan entier déplaçable (sans recréer) |
| U6 | Obstacles polygone libre + rotation de rectangle |
| U7 | Touch support pour le viewer 3D |
| U8 | Zoom min/max dans le Viewport |
| U9 | Fit-to-view automatique |
| U10 | Feedback visuel : sommets partagés distincts |
| U11 | Checklist Phase 3 : vérifications ombrage, orientation, DTU |
| U12 | Timeout init CalpinageApp si dépendances non disponibles |

### Ce qui fonctionne bien et ne doit pas être touché

- Architecture moteur / UI bien séparée
- `buildProjectionContext()` pure et documentée
- `validatePanelPolygon` : logique correcte et complète
- Ghost slots avec validation stricte
- `CalpinageStore` undo/redo : solide
- Modèle solaire NOAA : référence correcte
- Types TypeScript des pans et du projet : bien définis
- DPR et resize dans CanvasEngine : correct
- Zoom centré sur curseur dans Viewport : correct
- `computeVertexNormals` et `Box3` centrage auto dans phase3Viewer

---

*Audit réalisé par analyse statique du code source. Aucune correction effectuée. Date : Mars 2026.*
