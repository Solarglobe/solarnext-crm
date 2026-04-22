# RAPPORT D'AUDIT — REPRÉSENTATION 3D DU CALPINAGE

**Date :** 18 avril 2026
**Mode :** AUDIT UNIQUEMENT — aucune modification de code
**Objectif demandé :** La 3D doit être l'extension stricte de la 2D. Mêmes pans, mêmes panneaux, mêmes interactions (poser, retirer, déplacer, remplir un pan, ajuster la hauteur). Aujourd'hui la représentation 3D n'est "pas bonne" et Phase 2 est cassée (faîtage/égout à plat).

Ce rapport répond à deux questions :
1. **Pourquoi la 3D est-elle fausse géométriquement ?** (le toit à plat, les hauteurs qui n'y sont pas)
2. **Pourquoi l'utilisateur ne peut-il pas faire en 3D ce qu'il fait en 2D ?** (pose, déplacement, remplissage, suppression)

Et se termine par **une liste priorisée de corrections** à réaliser, sans en exécuter aucune.

---

## PARTIE 0 — CARTOGRAPHIE DU PIPELINE 2D → 3D

### Source de vérité

Il n'y a **qu'une seule source de vérité** : `CALPINAGE_STATE` (runtime legacy Phase 2, alimenté par les bundles de `frontend/public/calpinage/`). La 3D (code moderne React `frontend/src/modules/calpinage/canonical3d/`) **lit** cet état mais n'en est pas propriétaire.

### Chaîne réelle exécutée (du clic jusqu'au pixel 3D)

```
CALPINAGE_STATE (window)
  → Inline3DViewerBridge.tsx (ligne 1018+) — bridge React qui monte le viewer 3D
  → getOrBuildOfficialSolarScene3DFromCalpinageRuntime()
      → resolveOfficialRoofTruthFromRuntime.ts
        → syncRoofPansMirrorFromPans()            (state.pans → roof.roofPans, MIROIR)
        → mapCalpinageRoofToLegacyRoofGeometryInput()
        → buildRoofModel3DFromLegacyGeometry()    (reconstruction géométrique)
            → resolveZForPanCorner()              (hiérarchie 7 niveaux — voir §1.2)
            → unifyLegacyPanSharedCornersZ()       (tolérance 6 px image)
            → imposeLegacySharedEdgePlanes()       (recalcul Z pour coplanarité)
      → deriveCanonicalPans3DFromRoofPlanePatches()
      → buildCanonicalPans3DFromRuntime() / buildCanonicalPlacedPanelsFromRuntime()
      → buildPvPanels3D()
  → SolarScene3D (objet final) → SolarScene3DViewer.tsx (Three.js / R3F)
```

### Points de sortie de route possibles

| Branche | Fichier | Déclencheur | Rendu |
|---|---|---|---|
| **Pipeline officiel** | `buildRoofModel3DFromLegacyGeometry.ts` | Par défaut | Toit reconstruit "au mieux" |
| **Emergency scene** | `emergency/buildEmergencySolarScene3DFromRuntime.ts` | Échec du pipeline principal | Pans 2D bruts, tilts par défaut — rendu très dégradé |
| **Fallback "maison minimale"** | `fallback/fallbackMinimalHouse3D.ts` | Aucun pan valide mais contour bâti présent | Toit **horizontal plat** à 5,5 m sur emprise du bâti |

L'utilisateur final ne sait **jamais** laquelle de ces trois branches a servi. C'est un premier problème invisible.

---

## PARTIE 1 — POURQUOI LE TOIT EST CASSÉ (GÉOMÉTRIE)

### 1.1 Le problème central : les hauteurs Z des sommets

Les pans dessinés en 2D sont des **polygones pixels sur l'image satellite**. Pour les placer en 3D il faut connaître la hauteur Z de chaque sommet. Cette hauteur n'est pas dans le dessin 2D : elle est déduite.

### 1.2 Hiérarchie de résolution des Z (fichier `builder/heightConstraints.ts`, fonction `resolveZForPanCorner`, ligne ~225)

| Priorité | Source | Confiance | Ligne |
|---|---|---|---|
| 1 | Cote explicite saisie sur le sommet du polygone (`heightM`) | high | L236 |
| 2 | Snap sur l'extrémité d'un faîtage (tolérance `PHASE2_IMAGE_SNAP_PX_FOR_HEIGHT` px) | high | L249 |
| 3 | Snap sur l'extrémité d'un trait structurant | high | L262 |
| 4 | Interpolation sur segment faîtage (tolérance `ON_SEGMENT_TOL_PX` px) | medium | L276 |
| 5 | Interpolation sur segment trait structurant | medium | L286 |
| 6 | Moyenne des hauteurs explicites du même pan | medium | L297 |
| 7 | **`input.defaultHeightM` (= 5,5 m codé en dur)** | low | L314 |

**Conséquence directe :** si l'utilisateur a dessiné ses pans mais n'a **ni cote explicite sur sommet, ni faîtage tracé, ni trait structurant** à proximité, **chaque sommet retombe sur le niveau 7 → Z = 5,5 m partout → toit plat horizontal à 5,5 m**. C'est exactement le symptôme "faîtage/égout à plat". Un diagnostic est émis (`HEIGHT_FALLBACK_DEFAULT_ON_CORNERS`, `buildRoofModel3DFromLegacyGeometry.ts:598`) mais il est stocké, pas affiché.

### 1.3 La pente saisie en 2D n'est pas respectée si la géométrie calculée la contredit

Fichiers : `buildCanonicalPans3DFromRuntime.ts:404`, `deriveCanonicalPans3DFromRoofPlanePatches.ts:116-122`.

Le pipeline calcule la pente géométrique 3D via la normale de Newell sur les sommets. Il ne conserve l'inclinaison 2D saisie par l'utilisateur **que si** `|pente_calculée − pente_saisie| ≤ 2,5°`. Même tolérance pour l'azimut (±15°). Au-delà, la pente utilisateur est ignorée silencieusement.

Comme les Z retombent souvent sur 5,5 m plat (§1.2), la pente calculée est ~0° et rejette la pente saisie (12°, 25°, 35°…). **Le pan devient plat même si l'utilisateur a écrit "30° / 180°".**

### 1.4 Les arêtes partagées sont recalculées (pas toujours pour le mieux)

Deux étapes modifient les Z après leur résolution initiale :

- `unifyLegacyPanSharedCornersZ.ts` — détecte les coins à moins de 6 px sur l'image et fusionne leurs Z par poids (faîtage > trait > explicite > défaut).
- `imposeLegacySharedEdgePlanes.ts` — recalcule les Z des sommets d'un pan pour qu'ils appartiennent au **plan** passant par l'arête partagée avec le voisin.

En mode "fidelity" (le mode produit par défaut, `buildRoofModel3DFromLegacyGeometry.ts:173`) les cotes explicites sont protégées et ces deux étapes ne corrigent pas ce qui vient de l'utilisateur. En mode "reconstruction", elles écrasent tout — y compris des cotes correctes. Aucun des deux modes n'est satisfaisant par défaut.

### 1.5 Anti-spike automatique

`buildRoofModel3DFromLegacyGeometry.ts:365-388`. Si `Z-range / diagonale_XY > 1,5` (pan "trop vertical") le builder aplatit le pan aux valeurs par défaut, sauf en mode fidelity où il garde la géométrie mais émet `PAN_SPIKE_DETECTED_FIDELITY_NO_CLAMP` (ligne 369). Ce seuil de 1,5 n'est pas configurable côté UI et n'est jamais expliqué à l'utilisateur.

### 1.6 `getHeightAtXY` (hauteurs terrain / MNT) est isolé

Une fonction `getHeightAtXY` existe côté runtime (utilisée par les adaptateurs d'obstacles) mais **elle n'est jamais appelée par `buildRoofModel3DFromLegacyGeometry`**. Autrement dit, si la 2D dispose d'un modèle numérique de terrain, la 3D toiture ne l'utilise pas. Bonne nouvelle : pas de "contamination terrain" (ce que la mémoire craignait). Mauvaise nouvelle : aucune aide automatique pour les Z.

### 1.7 Diagnostics qualité cachés

`roofReconstructionQuality.ts` produit un enum `TRUTHFUL | PARTIAL | FALLBACK | INCOHERENT`, `validate2DTo3DCoherence` émet des warnings Jaccard/aire/couverture, `pvBindingDiagnostics.ts` classe les panneaux `OK/PARTIAL/ORPHAN/REJECTED`. **Rien de tout cela n'est visible en UI pour l'utilisateur final.** Quand la 3D est fausse, rien n'indique pourquoi.

### 1.8 Cache par signature pouvant afficher un état périmé

`scene/officialSolarScene3DGateway.ts:69` — cache indexé par `sceneRuntimeStructuralSignature`. Si un événement de rebuild se perd (debounce 32 ms dans `emitOfficialRuntimeStructuralChange`), la 3D affiche **une ancienne scène** alors que la 2D a changé. Diagnostic `sceneSyncStatus = STALE` existe mais invisible.

### Synthèse Partie 1

| Symptôme | Cause racine | Fichier:ligne |
|---|---|---|
| Toit strictement plat à 5,5 m | Fallback niveau 7 de `resolveZForPanCorner` actif par défaut si pas de cote / faîtage / trait | `heightConstraints.ts:314` |
| Pente 2D ignorée | Gate ±2,5° contre géométrie 3D recalculée | `buildCanonicalPans3DFromRuntime.ts:404` |
| Azimut 2D ignoré | Gate ±15° contre normale horizontale calculée | `deriveCanonicalPans3DFromRoofPlanePatches.ts` |
| Pan "aplati" inattendu | Anti-spike Z/XY > 1,5 | `buildRoofModel3DFromLegacyGeometry.ts:365` |
| Arêtes communes déformées | `imposeLegacySharedEdgePlanes` recale un pan sur le plan du voisin | `imposeLegacySharedEdgePlanes.ts` |
| Affiché ≠ dessiné | Cache signature stale ou branche emergency/fallback silencieuse | `officialSolarScene3DGateway.ts:69`, `fallbackMinimalHouse3D.ts` |
| Pourquoi c'est faux ? Aucune réponse à l'écran | Diagnostics non exposés en UI | `roofReconstructionQuality.ts`, `pvBindingDiagnostics.ts` |

---

## PARTIE 2 — CE QUI N'EST PAS FAISABLE EN 3D (PARITÉ FONCTIONNELLE)

L'utilisateur veut que "3D = 2D augmentée". Voici ce qui manque.

### 2.1 Matrice action 2D → action 3D

| Action | 2D | 3D | Statut | Commentaire |
|---|---|---|---|---|
| Ajouter un panneau par clic | Oui (ghost → `addPanelAtCenter`) | Non | **Absent** | Aucune UI 3D "poser un panneau". Seul `PvLayout3dDragController` existe, et c'est un drag, pas une création. |
| Ajouter un panneau par glisser | Oui | Non | **Absent** | Idem. |
| Déplacer un panneau (drag) | Oui | Partiel / conditionnel | **Derrière feature flag** | `PvLayout3dDragController.tsx` existe, branché dans `Inline3DViewerBridge.tsx:1018` via `pvLayout3DActive = enablePvLayout3dFlag && pvLayoutPhase && mode3d`. `enablePvLayout3dFlag` vient d'un rollout (`pvLayout3dRollout.ts`) — **OFF par défaut en production**. |
| Retirer un panneau (Suppr / clic) | Oui (`removePanelAtIndex`) | Non | **Absent** | Aucun handler suppression en 3D. |
| Remplir un pan (auto-fill grille) | Oui (`computeAutofilledGrid`) | Non | **Absent** | Pas d'équivalent 3D. |
| Aperçu des emplacements valides (ghostSlots) | Oui | Non | **Absent** | `ghostSlots.js` n'a pas de pendant 3D. |
| Rotation du bloc (90°, libre) | Oui | Partiel | **Lecture seule côté 3D** | 2D→3D visible ; 3D→2D : rien. |
| Ajuster la hauteur d'un sommet de pan (Z) | Oui (édition numérique) | Oui (drag vertical) | **OK mais flag-dépendant** | `RoofVertexZDragController.tsx` commité via `handleRoofVertexHeightCommit` (bridge L537). `enableVertexZEditFlag` = ON par défaut (défaut = true dans `CalpinageApp.tsx:86`). |
| Ajuster un sommet en XY | Oui | Non | **Absent** | `enableVertexXYEditFlag` **défaut = false** (`CalpinageApp.tsx:87`). UI Phase B5 "proposée, non montée". |
| Ajuster la hauteur d'un faîtage | Oui | Non | **Absent** | `enableStructuralRidgeHeightEditFlag` **défaut = false** (`CalpinageApp.tsx:88`). |
| Undo / Redo | Oui | Boutons présents mais grisés | **Non câblé** | `SceneInspectionPanel3D.tsx:135,157` — attend `roofModelingHistory` prop, non fourni. Ctrl+Z fonctionne pour Z edit uniquement. |
| Caméra Plan ↔ 3D | — | Oui | OK | Toggle avec re-framing automatique. |

### 2.2 Verdict brut

Sur **11 actions 2D** :
- 1 fonctionne déjà bien en 3D (réglage Z au drag)
- 2 sont partielles et dépendent d'un rollout OFF par défaut (déplacer un panneau, Undo/Redo)
- **7 sont totalement absentes en 3D** (pose, suppression, remplissage auto, ghosts, XY vertex, faîtage height, rotation retour vers 2D)

Autrement dit, **en production, aujourd'hui, la 3D est en lecture seule** — l'utilisateur ne peut au mieux que regarder le toit reconstruit et, si la chance lui sourit, bouger un sommet en Z. Ce n'est pas "une extension de la 2D", c'est un aperçu.

### 2.3 Bidirectionnalité 3D → 2D

Quand l'édition 3D est autorisée (Z drag), elle écrit **directement** dans `CALPINAGE_STATE.pans[...].polygonPx[...].h` via `applyRoofVertexHeightEdit`. La 2D lit le même state, donc elle reflète immédiatement. **C'est correct.** Le souci n'est pas l'architecture bidirectionnelle — elle est saine. Le souci est que presque rien n'est câblé dans cette architecture.

### 2.4 Persistance

`applyRoofVertexHeightEdit` modifie le state en mémoire. La sauvegarde legacy (`saveCalpinageState`) doit être rafraîchie derrière. Cela fonctionne pour le drag Z (vérifié L768-834 du bridge), mais il n'existe pas de parcours équivalent pour XY / faîtage / pose PV 3D / suppression PV 3D. Même si on activait les flags, rien ne garantirait la persistance.

---

## PARTIE 3 — FEATURE FLAGS : L'EFFET DISSIMULATEUR

Les flags transforment un code "présent mais inactif" en "apparemment cassé". Récapitulatif de ce qui conditionne réellement la 3D :

| Flag | Contrôlé par | Défaut production | Ce qu'il active |
|---|---|---|---|
| `VITE_CALPINAGE_CANONICAL_3D` | env Vite + `window.__CALPINAGE_CANONICAL_3D__` | `off` | Montage du viewer canonique tout entier |
| `__CALPINAGE_3D_VERTEX_Z_EDIT__` | `VITE_CALPINAGE_3D_VERTEX_Z_EDIT` ou localStorage | **ON** | Drag Z sommet |
| `__CALPINAGE_3D_VERTEX_XY_EDIT__` | `VITE_CALPINAGE_3D_VERTEX_XY_EDIT` | **OFF** | Drag XY sommet (UI pas câblée même si ON) |
| `__CALPINAGE_3D_RIDGE_HEIGHT_EDIT__` | `VITE_CALPINAGE_3D_RIDGE_HEIGHT_EDIT` | **OFF** | Réglage hauteur faîtage |
| `__CALPINAGE_3D_PV_LAYOUT_MODE__` | `pvLayout3dRollout.ts` | **OFF (rollout progressif)** | Drag panneau PV en 3D |
| `__CALPINAGE_3D_PV_PLACE_PROBE__` | rollout dédié | **OFF** | Sonde de pose (dev) |
| `__CALPINAGE_3D_DEBUG__` | manuel | OFF | Panneau d'inspection |
| `__CALPINAGE_3D_AUTOPSY_COLORS__` | manuel | OFF | Couleurs debug géométrie |

**Conclusion flags :** le code d'édition 3D existe en grande partie, mais **les flags sont OFF**. Même si la géométrie était parfaite, l'utilisateur n'aurait presque rien à manipuler. Inversement, activer brutalement les flags n'aide pas : la pose/suppression/fill n'existent simplement pas en code.

---

## PARTIE 4 — DIAGNOSTIC DE SYNTHÈSE

Il y a **deux problèmes distincts** qui se masquent l'un l'autre :

**Problème A — Géométrie 3D fausse.**
La reconstruction retombe trop facilement sur des valeurs par défaut (5,5 m plat) parce que la saisie 2D ne fournit quasiment jamais les cotes explicites ni les faîtages/traits tracés que le builder attend. Les mécanismes censés rattraper (unify, impose-plane, anti-spike) soit ne font rien en mode fidelity, soit écrasent tout en mode reconstruction. Résultat : le toit est plat, la pente saisie est ignorée, et aucun message utilisateur n'indique que c'est un fallback.

**Problème B — Parité fonctionnelle 2D/3D absente.**
L'architecture est saine (state unique, 3D lit, 3D peut commiter) mais les actions de base (poser, retirer, remplir, supprimer un panneau en 3D) **n'ont jamais été codées**. Les éditions qui existent (Z vertex, drag PV) sont soit derrière des flags OFF, soit sans UI explicite (pas de bouton, seulement du drag). L'utilisateur ne peut donc pas "refaire en 3D ce qu'il fait en 2D" — pas parce que c'est cassé, mais parce que ça n'existe pas.

Les deux problèmes interagissent de façon perverse : si l'on branche la pose PV en 3D **avant** de corriger la géométrie Z, les panneaux seront posés sur un toit plat à 5,5 m — ils paraîtront placés n'importe comment. C'est pour cela que la liste de corrections doit être ordonnée.

---

## PARTIE 5 — LISTE DE CORRECTIONS À FAIRE (PRIORISÉE)

Ordre à respecter : **rien n'est utile côté interaction tant que la géométrie est fausse**, mais **rien ne se vérifiera tant qu'on n'expose pas les diagnostics**.

### Bloc 1 — Rendre visible ce qui se passe (avant tout)

1. **Exposer dans la barre latérale 3D** la valeur de `roofGeometrySource` (`OFFICIAL | FALLBACK_BUILDING_CONTOUR | EMERGENCY`) et de `roofReconstructionQuality` (`TRUTHFUL | PARTIAL | FALLBACK | INCOHERENT`).
   Fichier cible : `SceneInspectionPanel3D.tsx`. Source : `buildSolarScene3DFromCalpinageRuntimeCore.ts:35+`, `roofReconstructionQuality.ts`.
2. **Afficher un badge par pan** avec son niveau de confiance Z (high/medium/low/fallback) — infos déjà produites par `resolveZForPanCorner`, il suffit de les remonter.
3. **Avertir quand `sceneSyncStatus = STALE`** (cache 3D en retard sur 2D). Source : `officialSolarScene3DGateway.ts:94`.
4. **Logguer explicitement** en UI quelle branche a été prise : pipeline officiel, emergency, fallback maison plate.

Sans ces repères, toute correction ultérieure se débogue à l'aveugle.

### Bloc 2 — Corriger la géométrie du toit (cœur du problème "faîtage à plat")

5. **Définir un contrat "saisie Z minimale" côté 2D.** Deux choix possibles à arbitrer :
   a. Obliger l'utilisateur à saisir au moins une cote de faîtage + une cote d'égout par pan, OU
   b. Déduire automatiquement à partir de pente + azimut + un point de référence (un sommet à Z=0).
   Aujourd'hui, ni l'un ni l'autre n'est imposé, donc `resolveZForPanCorner` retombe au niveau 7 (5,5 m).
6. **Faire consommer la pente 2D comme donnée d'entrée et non de validation.** Aujourd'hui elle sert seulement à valider la pente calculée (gate ±2,5°). Elle devrait être utilisée **pour poser l'équation du plan** du pan quand les Z sont insuffisants, puis les sommets sont projetés sur ce plan. Fichiers : `buildCanonicalPans3DFromRuntime.ts:404`, `heightConstraints.ts`.
7. **Idem pour l'azimut** (gate ±15° aujourd'hui).
8. **Décider une politique unique** parmi `fidelity | hybrid | reconstruction` et la documenter. Aujourd'hui c'est "fidelity" par défaut (`buildRoofModel3DFromLegacyGeometry.ts:173`) ce qui protège les explicites mais ne corrige pas les incohérences. `hybrid` serait probablement un meilleur compromis par défaut.
9. **Rendre le seuil anti-spike configurable / exposé.** Actuellement codé en dur (`PAN_SPIKE_RATIO_THRESHOLD = 1.5`, `buildRoofModel3DFromLegacyGeometry.ts:111`). Un pan de véranda ou d'annexe basse peut être aplati silencieusement.
10. **Revoir les tolérances image dur-codées** (`LEGACY_SHARED_CORNER_CLUSTER_TOL_PX = 6`, `PHASE2_IMAGE_SNAP_PX_FOR_HEIGHT`, `ON_SEGMENT_TOL_PX`). Les rendre dépendantes du `metersPerPixel` courant, sinon les grandes toitures (faible MPP) et les petites annexes (fort MPP) ont des comportements incohérents.
11. **Faire tomber `defaultHeightM = 5.5`** du dernier recours (niveau 7). Tant qu'un sommet tombe dessus, le rendu est mensonger. L'alternative : refuser de construire le pan, remonter une erreur UI "pan X incomplet, saisir une cote".
12. **Supprimer ou clarifier le fallback "Building contour" silencieux** (`fallbackMinimalHouse3D.ts`). Soit on le garde avec un marqueur visuel clair (pavé gris "modèle minimal"), soit on bascule sur un message d'erreur explicite.

### Bloc 3 — Garantir la synchro 2D ↔ 3D permanente

13. **Invalider le cache scène à toute mutation de `state.pans`**, pas uniquement à l'event `CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE`. Réduire le debounce de 32 ms si l'UI ressent une latence. Fichier : `officialSolarScene3DGateway.ts`.
14. **Supprimer le miroir `roof.roofPans`** ou le sceller derrière `syncRoofPansMirrorFromPans` à chaque build. Aujourd'hui il peut diverger silencieusement de `state.pans`. Vérif cible : `calpinageRoofMirrorHasPansButStatePansEmpty`.
15. **Vérifier la persistance** : une édition Z réussie en 3D doit déclencher `saveCalpinageState` (pas juste mémoire). C'est fait pour Z drag, à cabler pareillement pour XY, faîtage, pose PV 3D, suppression PV 3D.

### Bloc 4 — Parité fonctionnelle : combler les trous côté panneaux

16. **Pose d'un panneau en 3D par clic toiture.** Existe en sonde (`__CALPINAGE_3D_PV_PLACE_PROBE__`). À transformer en chemin produit : clic sur un pan 3D → ghost 3D (à créer) → clic de confirmation → `addPanelAtCenter` côté moteur 2D (déjà existant).
17. **Suppression d'un panneau en 3D** : click + touche Suppr. Handler absent à écrire.
18. **Remplissage automatique d'un pan en 3D** : appeler `computeAutofilledGrid` depuis le viewer sur pan sélectionné.
19. **Ghost slots en 3D** : porter la logique `ghostSlots.js` en R3F (affichage d'emplacements candidats valides). Indispensable pour "remplir" visuellement.
20. **Activer progressivement `__CALPINAGE_3D_PV_LAYOUT_MODE__`** par défaut après que 16-19 sont fonctionnels.
21. **UI d'édition 3D** : boutons "Poser", "Remplir", "Supprimer", "Rotation" dans `SceneInspectionPanel3D.tsx`. Aujourd'hui l'utilisateur ne peut deviner qu'il peut draguer.

### Bloc 5 — Parité fonctionnelle : édition de la toiture elle-même

22. **Câbler l'UI d'édition XY des sommets** (Phase B5). Props déjà existantes dans `SolarScene3DViewer.tsx:249-252`, handler existant dans `applyRoofVertexXYEdit.ts`. Reste à afficher poignées + basculer `VITE_CALPINAGE_3D_VERTEX_XY_EDIT` à `true` par défaut.
23. **Câbler l'édition de hauteur de faîtage** (`__CALPINAGE_3D_RIDGE_HEIGHT_EDIT__`, actuellement OFF). Le controller `onStructuralRidgeLinePointerDown` existe, `SolarScene3DViewer.tsx:1950`.
24. **Raccorder `roofModelingHistory`** dans le bridge pour activer les boutons Undo/Redo grisés de `SceneInspectionPanel3D.tsx:135,157`. Ctrl+Z fonctionne déjà partiellement — le rendre général.

### Bloc 6 — Ménage et dette

25. **Retirer / archiver** `frontend/calpinage/phase3/phase3Viewer.js` s'il n'est plus utilisé — risque de confusion avec `canonical3d/`.
26. **Dédupliquer** `frontend/calpinage/` (racine) et `frontend/public/calpinage/` — la deuxième est la source de vérité CRM.
27. **Supprimer les TODOs du builder** qui signalent des conditions fallback (`HEIGHT_FALLBACK_DEFAULT_ON_CORNERS`, `PAN_SPIKE_DETECTED_FIDELITY_NO_CLAMP`) une fois le Bloc 2 traité.
28. **Écrire un test de non-régression** "scène 3D ≠ flat 5.5 m" qui échoue aujourd'hui pour tout pan sans cote explicite.

---

## PARTIE 6 — ORDRE RECOMMANDÉ D'EXÉCUTION

Parce que chaque bloc dépend du précédent :

1. **Semaine 1** : Bloc 1 (diagnostics visibles). Sans ça, on ne sait pas ce qu'on corrige.
2. **Semaines 2-3** : Bloc 2 (géométrie Z). Sans ça, tout panneau posé en 3D sera posé sur un toit plat mensonger.
3. **Semaine 4** : Bloc 3 (synchro / cache / persistance). Fondation stable pour toute édition 3D.
4. **Semaines 5-6** : Bloc 4 (parité panneaux). La demande principale de l'utilisateur.
5. **Semaine 7** : Bloc 5 (édition toiture 3D — XY, faîtage, undo/redo).
6. **Semaine 8** : Bloc 6 (ménage).

Aucun de ces blocs n'est trivial mais aucun n'est un chantier de plusieurs mois non plus. L'architecture sous-jacente est en place ; ce qui manque est **l'activation, la complétude fonctionnelle et l'exposition diagnostique**.

---

## ANNEXE — FICHIERS CLÉS À CONNAÎTRE

Géométrie :
- `frontend/src/modules/calpinage/canonical3d/builder/heightConstraints.ts`
- `frontend/src/modules/calpinage/canonical3d/builder/buildRoofModel3DFromLegacyGeometry.ts`
- `frontend/src/modules/calpinage/canonical3d/builder/unifyLegacyPanSharedCornersZ.ts`
- `frontend/src/modules/calpinage/canonical3d/builder/imposeLegacySharedEdgePlanes.ts`
- `frontend/src/modules/calpinage/canonical3d/adapters/buildCanonicalPans3DFromRuntime.ts`
- `frontend/src/modules/calpinage/canonical3d/adapters/deriveCanonicalPans3DFromRoofPlanePatches.ts`
- `frontend/src/modules/calpinage/canonical3d/fallback/fallbackMinimalHouse3D.ts`
- `frontend/src/modules/calpinage/canonical3d/emergency/buildEmergencySolarScene3DFromRuntime.ts`

Scène et sync :
- `frontend/src/modules/calpinage/canonical3d/scene/officialSolarScene3DGateway.ts`
- `frontend/src/modules/calpinage/canonical3d/scene/resolveOfficialRoofTruthFromRuntime.ts`
- `frontend/src/modules/calpinage/canonical3d/buildSolarScene3DFromCalpinageRuntimeCore.ts`

Viewer et interactions :
- `frontend/src/modules/calpinage/canonical3d/viewer/SolarScene3DViewer.tsx`
- `frontend/src/modules/calpinage/canonical3d/viewer/RoofVertexZDragController.tsx`
- `frontend/src/modules/calpinage/canonical3d/viewer/PvLayout3dDragController.tsx`
- `frontend/src/modules/calpinage/canonical3d/viewer/SceneInspectionPanel3D.tsx`

Panneaux PV :
- `frontend/src/modules/calpinage/canonical3d/pvPanels/buildPvPanels3D.ts`
- `frontend/src/modules/calpinage/canonical3d/adapters/buildCanonicalPlacedPanelsFromRuntime.ts`
- `frontend/src/modules/calpinage/canonical3d/pvPanels/pvBindingDiagnostics.ts`

Bridge et flags :
- `frontend/src/modules/calpinage/components/Inline3DViewerBridge.tsx`
- `frontend/src/modules/calpinage/CalpinageApp.tsx` (config flags L60-101)
- `frontend/src/modules/calpinage/canonical3d/featureFlags.ts`
- `frontend/src/modules/calpinage/runtime/pvLayout3dRollout.ts`

Legacy 2D (source de vérité) :
- `frontend/public/calpinage/engine/pvPlacementEngine.js`
- `frontend/public/calpinage/panelProjection.js`
- `frontend/public/calpinage/state/activePlacementBlock.js`
- `frontend/public/calpinage/ghostSlots.js`
- `frontend/src/modules/calpinage/legacy/calpinage.module.js` (monolithe principal)
