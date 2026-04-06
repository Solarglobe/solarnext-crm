# Coque bâtiment 3D — builder officiel

## Module

`frontend/src/modules/calpinage/canonical3d/builders/buildBuildingShell3D.ts`  
Types : `frontend/src/modules/calpinage/canonical3d/model/buildingShell3DModel.ts`

**Entrée** : `CanonicalHouseDocument` (+ `zWallTop` / `wallHeightM` optionnels en surcharge).  
**Sortie** : `BuildBuildingShell3DResult` → `shell: BuildingShell3D | null`, `diagnostics`.

**Interdit** : lecture `CALPINAGE_STATE`, `window`, legacy canvas.

---

## Entrées

| Champ | Obligatoire | Rôle |
|--------|-------------|------|
| `document` | oui | Document canonique House3D |
| `document.building.buildingFootprint` | oui | Polygone fermé (XY, m) — seule source contour coque |
| `document.building.baseZ` | oui | Toujours `0` (convention modèle) |
| Une hauteur | oui | `input.zWallTop` **ou** `input.wallHeightM` **ou** `building.wallHeightM` |
| `input.zWallTop` | non | Z absolu haut mur (m), prioritaire |
| `input.wallHeightM` | non | Surcharge hauteur extrusion |

**Ignoré** : `roof`, `annexes`, `pv`, `worldPlacement`, `building.buildingOuterContour`.

**Refusé** : toute autre source que le canonique pour la géométrie bâti.

---

## Sorties (`BuildingShell3D`)

- **bottomRing** : sommets / segments au `baseZ`
- **topRing** : mêmes XY, `z = topZ`
- **wallFaces** : un quadrilatère vertical par arête du contour (normale sortante)
- **provenance** : traçabilité source footprint / hauteur

---

## Règles géométriques

1. **Extrusion verticale pure** : pas de déformation XY entre bas et haut.
2. **Bijection** : chaque sommet bas ↔ sommet haut même `(x,y)`.
3. **Un mur par segment** du contour fermé (après nettoyage des dégénérés).
4. **Winding** : aire signée XY ; si horaire (CW), inversion interne + warning — normales sortantes alignées avec `(dy,-dx)` pour CCW vu de `+Z`.
5. **Dégénérescence** : `< 3` sommets après nettoyage, aire ~0, arête nulle, hauteur ≤ 0, hauteur absente → **erreurs**, `shell = null`.

---

## « Fermé » (v1)

**`isClosedLateralShell`** : bande latérale continue — une face mur par arête, boucle fermée.  
**Ce n’est pas** un volume massif fermé (pas de dalle sol ni plancher toit dans ce builder).

---

## Ce que le builder **ne fait pas** (v1)

- Toiture, pignons, débords, lucarnes, ouvertures
- Raccord toit ↔ murs
- Matériaux, shading, triangulation render avancée
- Correction métier silencieuse du footprint
- Dépendance à la toiture pour exister

---

## Invariants

- `bottomVertexCount === topVertexCount === n` sommets sur anneau
- `wallCount === n` si valide
- `heightUsed === topZ - baseZ`
- Chaque `wallFaces[i].polygon[k]` : même `x,y` en bas qu’en haut pour paires `(b0,t0)`, `(b1,t1)`

---

## Matrice de validation

| Vérification | Critère |
|--------------|---------|
| Footprint exploitable | `isValid` et `bottomVertexCount ≥ 3` |
| Extrusion verticale pure | tests : `z` bas constant, `z` haut constant, XY identiques bas/haut |
| Un mur par segment utile | `wallCount === bottomVertexCount` |
| Fermeture latérale | `isClosedLateralShell` |
| Normales cohérentes | `normalsConsistent` |
| Segments dégénérés | `degenerateSegmentCount` + erreurs si arête nulle résiduelle |
| Sans toiture | builder n’importe pas `roof` |
| Sans runtime brut | pas de `CALPINAGE_STATE` |

---

## Références

- `canonical-house3d-model.md`, `canonical-house3d-invariants.md`
- `canonical-house3d-parser.md`, `canonical-house3d-local-to-world.md`
- `2d-entity-dictionary.md`, `2d-entity-ambiguities.md`
