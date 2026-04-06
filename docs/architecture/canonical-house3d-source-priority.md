# Hiérarchie officielle des sources — runtime calpinage → `CanonicalHouseDocument`

Ce document verrouille **quelle chaîne runtime compte comme vérité** pour le parseur unique  
`parseCalpinageStateToCanonicalHouse3D` (`frontend/src/modules/calpinage/canonical3d/parsing/parseCalpinageStateToCanonicalHouse3D.ts`).

Toute évolution de priorité doit modifier **ce fichier et le code du parseur** en même temps.

---

## 1. Topologie toit (liste des pans / patches)

| Priorité | Source | Nature | Condition d’usage |
|----------|--------|--------|-------------------|
| 1 | `validatedRoofData.pans` | Snapshot figé | `roofSurveyLocked === true` **et** `context.preferValidatedRoofSnapshot !== false` **et** tableau non vide |
| 2 | `state.pans` | Primaire live | Sinon, si non vide |
| 3 | `validatedRoofData.pans` | Fallback contrôlé | Si déverrouillé ou préférence snapshot désactivée mais snapshot encore non vide |
| — | `state.roof.roofPans` | **Miroir legacy** | **Jamais** utilisé comme liste primaire ; comparaison de longueur seulement → diagnostic si mismatch |

**Interdit comme vérité primaire :** toute recomposition de pans par solveur, `fitPlane`, unification de hauteurs, ou lecture « au feeling » depuis le canvas.

---

## 2. Arêtes et sommets toit (contours, faîtages, traits)

| Élément | Source | Nature |
|---------|--------|--------|
| Périmètres contour (arêtes `contour_perimeter`) | `state.contours[].points` | Primaire (filtré `roofRole !== chienAssis`) |
| Faîtages | `state.ridges[]` (`a`, `b`, `h` si présent) | Primaire |
| Traits structurels | `state.traits[]` | Primaire |
| Boucle boundary pan | Source XY = `polygon` si ≥3 sommets, sinon `points` (même règle que le contour du pan) | Primaire pour XY ; **Z uniquement si `h` explicite sur le même tableau source** |

---

## 3. Empreinte bâtiment (footprint)

| Source | Nature |
|--------|--------|
| Premier contour fermé utilisable parmi `state.contours` avec rôle `contour`, `roof` ou vide | Primaire |
| Pas de reconstruction si absent | → diagnostic bloquant `MISSING_BUILDING_FOOTPRINT` |

---

## 4. Hauteurs (quantités `HeightModelBlock`)

| Règle | Détail |
|-------|--------|
| **Lecture seule** | Champs présents sur l’objet : `h` sur points, `heightM` / conventions obstacles (`readExplicitHeightM`), `ridgeHeightRelM` extensions, `height` / `heightM` shadow volumes, etc. |
| **Interdit dans le parseur** | `fitPlane`, `getHeightAtXY`, anti-spike, unify, impose, ou toute estimation de Z non stockée |
| **Manquant** | Pas de valeur inventée : sommet sans `h` → pas de point dans `boundaryLoop3d` pour ce sommet ; patch marqué incomplet |

---

## 5. Obstacles et annexes

| Source | Nature |
|--------|--------|
| `state.obstacles[]` | Primaire ; famille via `isKeepoutNonShadingObstacle` + heuristiques documentées ; sinon ambiguë (compteur éligibilité) |
| `state.shadowVolumes[]` (`type === shadow_volume`) | Primaire |
| `state.roofExtensions[]` | Primaire (`ridgeHeightRelM`, contour) |

---

## 6. PV (panneaux)

| Source | Nature |
|--------|--------|
| `context.frozenPvBlocks` | **Seule** entrée géométrique PV du parseur (injectée par l’appelant) |
| `state.placedPanels` | **Miroir / legacy** : diagnostic `PLACED_PANELS_MIRROR_ONLY`, pas de géométrie PV dérivée |

---

## 7. Monde / échelle / GPS

| Champ | Source |
|-------|--------|
| `metersPerPixel` | `state.roof.scale.metersPerPixel` |
| Nord (deg) | `state.roof.roof.north.angleDeg` |
| GPS | `state.roof.gps` |
| Conversion px → m horizontal | `imagePxToWorldHorizontalM` (pont documenté, **pas** une hauteur) |
| `canonical3DWorldContract` | Présence seulement notée (`canonical3DWorldContractPresent`) |

---

## 8. Structures à ne pas traiter comme vérité métier

- Caches de pose type `__SAFE_ZONE_PH3__`, `drawState`, boîtes de sélection : **hors périmètre** (non lues par ce parseur).
- `geometry_json` : **non utilisé** dans la v1 du parseur (compatibilité éventuelle = évolution explicite future).

---

*Références : `canonical-house3d-model.md`, `canonical-house3d-invariants.md`, `2d-entity-dictionary.md`.*
