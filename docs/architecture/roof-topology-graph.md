# Graphe topologique toiture officiel

## Module

- **Builder** : `frontend/src/modules/calpinage/canonical3d/builders/buildRoofTopology.ts`  
  - `buildRoofTopology(document)` et `buildRoofTopologyGraph(document)` (équivalent).
- **Types** : `frontend/src/modules/calpinage/canonical3d/model/roofTopologyModel.ts`

**Entrée unique** : `CanonicalHouseDocument` — en pratique `document.roof.topology` (+ `roofToBuildingBindings` pour contraintes).  
**Interdit** : `CALPINAGE_STATE`, `window`, legacy.

**Non fait en v1** : solveur de plan, intersections 3D complètes, raccords parfaits, extrusion volumique toit, matériaux, viewer, correction de relevé.

---

## Entrées (obligatoires / optionnelles / ignorées)

| Élément | Statut |
|---------|--------|
| `roof.topology.vertices` | Obligatoire (références des arêtes / patches) |
| `roof.topology.edges` | Obligatoire (segments + `RoofEdgeKind` + trace) |
| `roof.topology.patches` | Obligatoire (au moins 0 — graphe vide possible) |
| `roof.topology.roofToBuildingBindings` | Optionnel — contraintes `roof_to_building` |
| `roof.geometry` | **Ignoré** (pas de plans 3D) |
| `building`, `annexes`, `pv` | **Ignorés** pour le graphe toit |

**Toléré / fallback** : fusion d’arêtes canoniques multiples ayant la même géométrie 2D (voir ci-dessous).

---

## Sortie : `RoofTopologyGraph`

- **vertices** : sommets topologiques (`tv-*`), fusion par position XY **quantifiée** (1e-6 m).
- **edges** : arêtes **uniques** par paire de sommets topologiques ; `sourceCanonicalEdgeIds` liste les arêtes fusionnées.
- **patches** : un nœud par pan, anneau en IDs topologiques, `neighbors` explicites le long des arêtes **partagées**.
- **structuralConstraints** : faîtages / traits / liaisons bâtiment.
- **diagnostics** : compteurs + `topologyBuildabilityLevel`.

---

## Fusion géométrique (même arête physique, plusieurs IDs)

1. Clé position : `round(x*1e6),round(y*1e6)`.
2. Sommets canoniques au même point → **un** `topologyVertexId` (`tv-{idCanoniqueLexPlusPetit}`).
3. Arêtes canoniques entre mêmes sommets topologiques → **une** arête graphe ; kinds fusionnés.

Diagnostic : `VERTEX_CLUSTER_MERGE`, `EDGE_KIND_MERGE_AMBIGUOUS` si plusieurs kinds mènent à des types officiels différents.

---

## Typage officiel (`RoofTopologyOfficialEdgeKind`)

Dérivé de `RoofEdgeKind` (canonique parseur) :

| `RoofEdgeKind` (canonique) | Officiel |
|----------------------------|----------|
| `ridge` | `ridge` |
| `valley` | `valley` |
| `hip` | `hip` |
| `eave` | `eave` |
| `gable`, `rake` | `gable` |
| `internal_structural`, `unknown_structural`, `wall_plate` | `internal` |
| `contour_perimeter` | `eave` (rive / périmètre bâti — lecture « bas ») |

**Fusion** : parmi les kinds sources, on applique une **précédence** (ridge > valley > hip > internal_structural > eave > gable/rake > wall_plate > unknown > contour_perimeter).  
Si plusieurs **types officiels** distincts subsistent après mapping → `kindMergeAmbiguous: true`.

**Traçabilité** : `typingRuleId: "canonical-to-official-v1+merge-precedence-v1"`.

---

## Voisinage

- Deux pans sont **voisins** s’ils partagent une arête graphe avec `boundaryStatus === "shared"` (≥ 2 patches incidents).
- Relation : `adjacent_along_edge` + `sharedTopologyEdgeId`.
- Si `kindMergeAmbiguous` sur cette arête → `ambiguity: kind_conflict_on_shared_edge`.

---

## Arêtes flottantes (`isFloatingStructural`)

Arête sans incidence sur aucun contour de pan, mais dont au moins une source est `ridge`, `internal_structural`, `valley` ou `hip` — segment structurant du relevé pas encore « cousu » au maillage des pans dans le canonique.

---

## Invariants

- `topologyEdgeCount` ≤ nombre d’arêtes canoniques (égal si aucune fusion).
- Chaque pan `ok` a `boundaryTopologyEdgeIds.length === boundaryTopologyVertexIds.length` (anneau fermé).
- Arête partagée : **une** entrée dans `edges`, `incidentPatchIds.length ≥ 2`.

---

## Matrice de validation

| Vérification | Indicateur |
|--------------|------------|
| Pans exploitables | `degeneratePatchCount === 0` |
| Arêtes uniques géométriques | `topologyEdgeCount`, fusion explicite |
| Voisinages explicites | `neighborRelationCount` |
| Frontière détectée | `boundaryEdgeCount` |
| Partagées | `sharedEdgeCount` |
| Typage produit | `edges[].officialKind` |
| Ambiguïtés | `ambiguousEdgeCount`, warnings |
| Sans runtime brut | pas d’import calpinage |
| Sans solveur plan | `roof.geometry` ignoré |

---

## Références

- `canonical-house3d-model.md`, `canonical-house3d-parser.md`, `canonical-house3d-source-priority.md`
- `building-shell-3d.md`, `2d-entity-dictionary.md`, `2d-entity-ambiguities.md`
