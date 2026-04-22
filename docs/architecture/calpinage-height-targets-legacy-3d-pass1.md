# Pass 1 — Cartographie des cibles hauteur (legacy ↔ 3D)

**Statut** : inventaire de référence pour l’édition hauteur « source structurelle » en 3D.  
**Périmètre** : ce qui est éditable en 2D, comment ça alimente les `pans` et la 3D, et **identifiants stables** recommandés pour un futur pick 3D (aucune implémentation de pick dans ce document).

---

## 1. Où vivent les hauteurs « métier » dans le runtime

Les hauteurs explicites (cotes en m) pour reconstruire la toiture sont portées par **trois familles** de géométrie 2D image (`CALPINAGE_STATE`), en plus des sommets des polygones de `pans` :

| Famille | Chemin state | Champ `h` (m) |
|--------|----------------|---------------|
| **Contour bâti** | `contours[].points[]` | `points[j].h` |
| **Faîtage / ligne de faîtage** | `ridges[]` | `ridge.a.h`, `ridge.b.h` (extrémités du segment) |
| **Trait** (rupture / ligne interne) | `traits[]` | `trait.a.h`, `trait.b.h` |

**Filtre métier** : partout où le legacy sélectionne ou modifie ces entités, les entrées avec `roofRole === "chienAssis"` sont **exclues** (même tableau filtré que `hitTestHeightPoints`, `getHeightForSelection`, `applyHeightToSelectedPoints`).

**Réf. code** : `frontend/src/modules/calpinage/legacy/calpinage.module.js` — fonctions `hitTestHeightPoints`, `getHeightForSelection`, `applyHeightToSelectedPoints`, `getImgPtForHeightSelection`, `structuralPointTargetForHeightSel` (zone ~5995–6175).

**Résolveur canonique (lecture)** : `frontend/src/modules/calpinage/core/heightResolver.ts` — ordre de priorité P1 (vertex explicites contour / ridge / trait) documenté en tête du fichier ; cohérent avec l’idée que la **structure** porte la vérité des cotes avant dérivation des pans.

---

## 2. Modèle de sélection 2D (tuple officiel)

Le mode **hauteur** en 2D ne sélectionne pas un `panId` : il sélectionne un **point source** parmi contour / faîtage / trait.

**Forme du hit** (retour de `hitTestHeightPoints`, stocké dans `selectedHeightPoint` / `selectedHeightPoints`) :

```ts
type LegacyStructuralHeightSelection = {
  type: "contour" | "ridge" | "trait";
  /** Index dans le tableau **filtré** (sans chienAssis) */
  index: number;
  /** Pour contour : index du point dans `contours[index].points`. Pour ridge/trait : 0 = extrémité `a`, 1 = extrémité `b` */
  pointIndex: number;
};
```

**Écriture** : une seule fonction autorise la mutation des `h` sur ces points : `applyHeightToSelectedPoints(value, optionalSels?)`, puis enchaîne `computePansFromGeometry()`, `ensurePanPointsWithHeights()`, recalcul physiques pans, rendu, `saveCalpinageState()`.

**Important — stabilité des index** : `index` n’est **pas** l’index dans `CALPINAGE_STATE.contours` brut, mais dans **`(contours || []).filter(c => c.roofRole !== "chienAssis")`**. Si une entrée chienAssis est insérée ou retirée, les index **filtés** peuvent glisser. Tout identifiant « stable » pour le produit devra soit :

- **reproduire exactement** cette règle de filtrage partout (2D, 3D, tests), soit  
- **préférer des IDs d’entité** quand ils existent sur les objets persistés (voir §5).

**Réf. code** : même zone `calpinage.module.js` (~6020–6151).

---

## 3. Projection sur les `pans` et sur la géométrie 3D

### 3.1 Chaîne structure → pans

Après modification des `h` structurels, **`computePansFromGeometry()`** (cœur `computePansFromGeometryCore`) recalcule entièrement les polygones `CALPINAGE_STATE.pans` à partir des contours, traits, faîtages, etc. Les sommets de pan sont donc **dérivés** ; leurs `h` / hauteurs effectives sont alignés avec la physique toiture (via le graphe legacy).

**Réf. code** : `calpinage.module.js` — `computePansFromGeometry` / `computePansFromGeometryCore` (~8501+).

### 3.2 Chaîne pans → scène 3D affichée

Le viewer 3D actuel (`SolarScene3DViewer`) manipule surtout des **patches toiture** (`RoofPlanePatch3D`, `panId`) et des **sommets de patch** (`vertexIndexInPatch` / coins du maillage `roof_tessellation`).

**Contrat pick 3D existant** (`ScenePickHit`) :

- `roof_vertex` : `{ kind: "roof_vertex", roofPlanePatchId, vertexIndexInPatch }`  
  → ancré dans la **vue dérivée pan**, pas dans la sélection structurelle `contour` / `ridge` / `trait`.

**Réf. code** : `frontend/src/modules/calpinage/canonical3d/viewer/inspection/sceneInspectionTypes.ts` ; pick sommets `pickRoofVertexModelingPick.ts`.

### 3.3 Pont 3D → même chaîne que le mode hauteur 2D (aujourd’hui)

Pour un commit **hauteur** depuis la 3D sur un **sommet de pan**, le legacy expose `commitRoofVertexHeightLike2D(panId, vertexIndex, heightM)` (`window.__calpinageCommitRoofVertexHeightLike2D`) :

1. Lit le sommet `(x,y)` image du polygone pan.
2. Appelle `resolveStructuralHeightSelectionNearImagePoint(imgPt, maxDistImg)` avec tolérance **48 px image** par défaut (`HEIGHT_EDIT_EPS_IMG` ailleurs pour la proximité).
3. Si un point structurel est trouvé → `applyHeightToSelectedPoints` sur la sélection **structurelle** (même effet que le 2D).
4. Si **aucun** point structurel assez proche → code `NO_STRUCTURAL_HIT` : le flux TypeScript (`applyRoofVertexHeightEdit`) peut encore modifier **`pans[]` directement**, **sans** mettre à jour `contours` / `ridges` / `traits` — divergence possible entre « cotes structure » et « sommets pan » jusqu’à une resynchro manuelle ou un `computePansFromGeometry` côté utilisateur.

**Réf. code** : `calpinage.module.js` (~6052–6241), expositions `window.__calpinageCommitRoofVertexHeightLike2D`.

---

## 4. Correspondance géométrique (résumé)

| Concept utilisateur | Édition 2D (source de vérité) | Dérivé `pans` | Représentation 3D actuelle (affichage / pick) |
|--------------------|-------------------------------|---------------|-----------------------------------------------|
| Point de **contour bâti** | `contours[i].points[j].h` (indices filtrés) | Recalculé dans `pans` | Coin de patch **si** coïncidant avec sommet pan après compute ; sinon pas de sommet dédié « contour » en 3D |
| Extrémité **faîtage** | `ridges[i].a|b.h` | Influence decoupe / sommets pans | Souvent proche d’une arête ou d’un sommet de pan ; **pas** d’objet `ScenePickHit` dédié « ridge » |
| Extrémité **trait** | `traits[i].a|b.h` | Idem | Idem |
| Sommet **pan** (polygone) | Indirect (via compute ou `points[].h` sur pan) | `pans[].polygonPx` / équivalent | `roof_vertex` + `roofPlanePatchId` + `vertexIndexInPatch` |

**Lecture clé** : la 3D « officielle » pour le modelage interactif est aujourd’hui indexée **pan + sommet de pan**, alors que la vérité **cote** peut être sur une entité **structurelle** différente. Le pont `commitRoofVertexHeightLike2D` **réaligne** pan → point structurel **par proximité 2D**, pas par identité stable 3D.

---

## 5. Identifiants stables recommandés pour un futur pick 3D (sans implémentation)

Objectif : pouvoir désigner **sans ambiguïté** le même point que `applyHeightToSelectedPoints` modifierait, pour un commit 3D direct ou pour surligner la bonne cible.

### 5.1 Identifiant minimal aligné legacy (recommandé phase 1)

Reprenir **exactement** le tuple legacy :

`StructuralHeightRef = { type: "contour" | "ridge" | "trait"; index: number; pointIndex: number }`

avec la convention **`index` = position dans les tableaux filtrés `roofRole !== "chienAssis"`** pour `contours`, `ridges`, `traits` respectivement.

**Validation** : pour appliquer une hauteur, résoudre le point mutable via la même logique que `structuralPointTargetForHeightSel(sel)` (accès au bon `points[j]` ou `a`/`b`).

**Limite** : fragilité si l’ordre des entrées filtrées change (ajout/suppression d’éléments hors chienAssis).

### 5.2 Identifiant renforcé (recommandé dès que les données le permettent)

Si les entités persistées portent un **`id` stable** (souvent le cas pour `ridges` / `traits` dans les exports ; à vérifier pan par pan pour `contours`) :

`StructuralHeightRefById = { type: "contour" | "ridge" | "trait"; entityId: string; endpoint: "pointIndex" pour contour (number) | "a" | "b" pour segments }`

**Avantage** : robustesse aux réordonnancements de tableaux.  
**Prérequis** : inventaire JSON réel (études) + règle de résolution si `id` absent (fallback sur tuple indexé).

### 5.3 Ancrage spatial (complément, pas substitut)

Pour le **placement** du marqueur 3D ou le snap : coordonnées image `(xPx, yPx)` du point (`getImgPtForHeightSelection`) + tolérance — utile pour **affichage** et tests de cohérence, insuffisant seul comme identifiant durable si le dessin bouge.

---

## 6. Constantes / tolérances à réutiliser

| Paramètre | Valeur / rôle | Réf. |
|-----------|----------------|------|
| Proximité pan → structure (commit comme 2D) | **48 px** image dans `commitRoofVertexHeightLike2D` | `calpinage.module.js` ~6204 |
| `resolveStructuralHeightSelectionNearImagePoint` défaut | `HEIGHT_EDIT_EPS_IMG` si non passé | ~6057–6058 |
| Hit-test 2D comparaison | Distance **écran** pour `hitTestHeightPoints` ; meilleur sous seuil initial 20 px puis logique `check` | ~6024–6036 |

Tout pick 3D futur devra préciser s’il convertit d’abord le clic en **(x,y) image** puis réutilise `resolveStructuralHeightSelectionNearImagePoint`, ou s’il projette en monde puis reconvertit — dans tous les cas, **aligner les tolérances** avec ce document pour éviter les divergences 2D/3D.

---

## 7. Fichiers de référence (liste courte)

| Sujet | Fichier |
|-------|---------|
| Sélection / écriture `h` legacy | `frontend/src/modules/calpinage/legacy/calpinage.module.js` |
| Résolution hauteur P1–P4 | `frontend/src/modules/calpinage/core/heightResolver.ts` |
| Adaptateur state → entrée géométrie legacy 3D | `frontend/src/modules/calpinage/adapter/calpinageStateToLegacyRoofInput.ts` |
| Types pick / inspection 3D | `frontend/src/modules/calpinage/canonical3d/viewer/inspection/sceneInspectionTypes.ts` |
| Pick sommets pan (modélisation) | `frontend/src/modules/calpinage/canonical3d/viewer/inspection/pickRoofVertexModelingPick.ts` |

---

## 8. Suite logique (hors Pass 1)

- Pass 2 : brancher un commit test **par type** (ex. uniquement `ridge`) en réutilisant `applyHeightToSelectedPoints` depuis le chemin 3D avec `StructuralHeightRef` résolu de manière déterministe.  
- Tests : fixtures avec et sans `chienAssis` pour valider que les index filtrés restent alignés entre 2D et identifiants proposés.

---

## Pass 2 (livré) — faîtage uniquement

- **Legacy** : `window.__calpinageApplyStructuralRidgeHeightSelection(sel, heightM)` avec `sel.type === "ridge"` → `applyHeightToSelectedPoints` (voir `calpinage.module.js`).
- **Runtime TS** : `structuralRidgeHeightSelection.ts`, `applyStructuralRidgeHeightEdit.ts`.
- **Validation** : `validateCalpinageRuntimeAfterRoofEdit` avec `validateSlopeOnAllPans: true` et `scopePanGeometryErrorsToEditedPanId: false` après édition faîtage.
- **Viewer** : clic sur les `LineSegments` faîtage (si `__CALPINAGE_3D_RIDGE_HEIGHT_EDIT__` / `localStorage` `calpinage_3d_ridge_h=1` / `VITE_CALPINAGE_3D_RIDGE_HEIGHT_EDIT`), résolution image → `resolveNearestStructuralRidgeSelectionFromImagePx`, panneau latéral `StructuralRidgeHeightEditBlock`.
- **Rollback échec validation** : snapshot JSON complet du runtime dans `Inline3DViewerBridge` (pas seulement `pans`).
