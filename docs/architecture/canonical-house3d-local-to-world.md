# Local bâtiment → monde / scène viewer (adaptateur officiel)

## 1. Module unique

**Fichier** : `frontend/src/modules/calpinage/canonical3d/adapters/adaptCanonicalHouseLocalToWorldScene.ts`  
**Entrée** : `CanonicalHouseDocument` + `AdaptCanonicalHouseWorldContext` (paramètres monde autorisés, optionnels).  
**Sortie** : `AdaptCanonicalHouseLocalToWorldSceneResult` (`scene`, `diagnostics`, `transformProvenance`, …).

**Interdit** : relire `CALPINAGE_STATE`, re-parser, recalculer toit / plans / hauteurs, modifier le canonique.

**Types scène** : `frontend/src/modules/calpinage/canonical3d/model/canonicalHouseWorldModel.ts`  
Alias consommateur : `House3DWorldSceneInput` = `CanonicalHouseWorldDocument`.

---

## 2. Convention locale (métier)

Définie dans `canonical-house3d-model.md` :

- **X, Y** : plan horizontal local bâtiment (m).  
- **Z** : hauteur métier locale, **Z = 0** = base officielle.  
- Pas d’ellipsoïde, pas de « monde géographique » dans les sommets du cœur.

---

## 3. Convention monde / scène (officielle projet)

Alignée sur **`docs/architecture/3d-world-convention.md`**, `canonical3d/core/worldConvention.ts`, `canonical3d/world/unifiedWorldFrame.ts` :

| Axe | Rôle |
|-----|------|
| **+X** | Horizontal 1 (Est local après rotation nord dans la chaîne image→monde) |
| **+Y** | Horizontal 2 (Nord local) |
| **+Z** | Vertical (haut) |
| **Unité** | mètre |
| **Viewer Three.js officiel** | `worldMetersToThreeJsPosition` = **identité** sur `(x, y, z)` |

---

## 4. Transformation officielle local → monde

### 4.1 Chaîne numérique (géométrie maison / toit / annexes / PV)

1. **Alignement local → monde**  
   Pour les documents produits par le parseur officiel avec `worldPlacement.imageSpaceOriginPolicy === "imagePxToWorldHorizontalM"`, les coordonnées **(x, y)** du canonique sont **déjà** dans le plan horizontal **ENU** (m), avec **nord** pris en compte au parseur.  
   L’adaptateur applique donc :

   `scene_xyz = local_xyz` (identité numérique), **sans** ré-appliquer `northAngleDeg` sur les sommets.

2. **Option `sceneOriginMode: footprint_centroid_xy_to_origin`**  
   Soustraction du **centroid XY** de `building.buildingFootprint` sur toutes les positions (même chaîne pour Phase 2 et Phase 3).

3. **Option `sceneTranslationM`**  
   Translation finale `(tx, ty, tz)` — **convenance viewer / orchestration**, tracée dans les diagnostics et `transformProvenance`.

### 4.2 Satellite / fond image

- Utilise **uniquement** `worldPlacement.metersPerPixel`, `northAngleDeg`, et **`context.satelliteImageExtentsPx`** (injecté par l’orchestrateur si disponible — pas dans le cœur canonique obligatoire).  
- Coins du plan : `imagePxToWorldHorizontalM` sur `(0,0)`, `(W,0)`, `(W,H)`, `(0,H)` puis **même** chaîne centroid + translation que la géométrie métier.  
- **Z** du plan : `satelliteZOffsetM` (défaut **-0.02 m**), purement visuel.

La **géométrie métier** n’est jamais « corrigée » par le satellite.

### 4.3 Winding

Aucune inversion silencieuse des polygones : politique **`pass_through_from_canonical`**.

---

## 5. Phase 2 / Phase 3

Une **seule** sortie `CanonicalHouseWorldDocument` :

- **Phase 2** : `building`, `roof`, `annexes`, `satelliteBackdrop?`, `gpsContext?`.  
- **Phase 3** : mêmes blocs + `pv` si présent sur le canonique (même transformations).

---

## 6. Diagnostics (exemples)

| Code | Gravité | Sens |
|------|---------|------|
| `LOCAL_WORLD_NUMERIC_IDENTITY` | info | Policy parseur connue, identité sommets |
| `LOCAL_WORLD_ASSUMED_IDENTITY_UNDOCUMENTED_POLICY` | warning | Policy ≠ attendue — vérifier chaîne |
| `METERS_PER_PIXEL_MISSING` | warning | Satellite impossible |
| `NORTH_ANGLE_ASSUMED_ZERO` | info | Métadonnée défaut |
| `SATELLITE_PLACEMENT_UNAVAILABLE` | info | Pas d’extents / mpp |
| `SATELLITE_BACKDROP_EMITTED` | info | Plan fond émis |
| `SCENE_ORIGIN_FOOTPRINT_CENTROID` | info | Recentrage actif |
| `SCENE_ORIGIN_EXPLICIT_TRANSLATION` | info | Translation scène |
| `WINDING_UNMODIFIED_PASS_THROUGH` | info | Pas de retournement anneaux |
| `ANNEX_HEIGHT_*_UNRESOLVED` | warning | Anneaux annexes partiels |
| `ROOF_EDGE_SEGMENTS_EMPTY_IN_CANONICAL` | info | Parseur v1 sans arêtes 3D |

`worldTransformValid` : `true` s’il n’y a **aucun** diagnostic `blocking` (réservé aux extensions futures).

---

## 7. Exclusions

- Pas de lecture runtime calpinage.  
- Pas de matériaux, caméra, surbrillance (viewer).  
- Pas de mutation du `CanonicalHouseDocument` d’entrée.

---

## 8. Références croisées

- `canonical-house3d-parser.md`, `canonical-house3d-source-priority.md`  
- `canonical-house3d-local-vs-world-responsibilities.md`  
- `2d-entity-dictionary.md`, `2d-entity-ambiguities.md`
