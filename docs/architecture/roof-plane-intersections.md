# Moteur officiel des intersections 3D entre pans toiture

## Module

- **Moteur** : `frontend/src/modules/calpinage/canonical3d/builders/computeRoofPlaneIntersections.ts`  
- **Types** : `frontend/src/modules/calpinage/canonical3d/model/roofIntersectionModel.ts`

**Entrées** : `CanonicalHouseDocument` + `RoofTopologyGraph` + `RoofPlaneSolutionSet` (`ComputeRoofPlaneIntersectionsInput`).

**Interdit** : `CALPINAGE_STATE`, `window`, relire le runtime calpinage brut ; pas de « raccord visuel » sans calcul de droite / segment.

---

## Entrées détaillées

| Champ | Statut |
|--------|--------|
| `document.roof.topology.roofId` | Obligatoire — contrôle de cohérence avec `topologyGraph.roofId` (warning si divergence) |
| `document.roof.topology` | Obligatoire indirect — positions XY alignées avec les sommets du graphe |
| `topologyGraph.edges` (`boundaryStatus`, `incidentPatchIds`, `officialKind`, extrémités) | Obligatoire — **seule** source de paires de pans voisins |
| `topologyGraph.vertices` (`positionXY` par `topologyVertexId`) | Obligatoire — extrémités 2D de l’arête partagée |
| `solutionSet.solutions[].planeEquation` | Obligatoire par pan pour un raccord calculé — sinon `unresolved_one_or_both_planes_missing` |
| `solutionSet` / `document.roof.geometry` | **Geometry mesh** ignorée |
| Runtime brut / `CALPINAGE_STATE` | **Refusé** |

Le moteur **n’invente pas de voisins** : uniquement les arêtes avec `boundaryStatus === "shared"` et au moins deux `incidentPatchIds`. Pour chaque paire distincte de pans sur cette arête, une entrée d’intersection est produite (cas non-manifold : plusieurs paires sur la même arête).

---

## Sortie : `RoofIntersectionSet`

Pour chaque paire `(leftPatchId, rightPatchId)` sur une arête partagée :

- `intersectionLine3D` : point d’ancrage + direction **unitaire** de la droite d’intersection des deux plans implicites `n·p + d = 0`.
- `sharedSegment3D` : segment 3D utile entre `segmentStart3D` et `segmentEnd3D`, obtenu en projetant sur cette droite les points 3D moyens `(x,y,(z1+z2)/2)` aux extrémités topologiques XY de l’arête (voir logique ci‑dessous).
- `gapDistanceM` : max des distances **en plan** entre chaque extrémité topologique `(xa,ya)`, `(xb,yb)` et la projection XY du point correspondant sur la droite (détecte vide / faux raccord en plan).
- `stepDistanceM` : max `|z1−z2|` sur les échantillons XY extrémités + milieu d’arête (marche entre plans).
- `hasOverlap` / `overlapDistanceM` : v1 — surtout plans quasi **confondus** (intersection dégénérée).
- `isClipped` : longueur 3D du segment &lt; `lengthM` de l’arête topologique − `segmentLengthSlackM` (couture plus courte que le bord attendu).
- `isConsistent` : pas de gap / step / overlap au‑delà des tolérances, pas de conflit numérique critique sur les plans.

Diagnostics globaux : compteurs `gapCount`, `stepCount`, `parallelPlaneCount`, `unresolvedNeighborPairCount`, `sewingLevel` (`clean` | `partial` | `ambiguous` | `invalid`), etc.

---

## Logique de calcul (v1)

1. **Topologie** : pour chaque arête `e` du graphe avec `boundaryStatus === "shared"`, lister les paires de `incidentPatchIds` (ids triés : `leftPatchId` &lt; `rightPatchId` lexicographiquement).
2. **Géométrie** : récupérer `eq1`, `eq2` depuis `solutionSet`. Si l’un manque → pas de droite, diagnostic explicite.
3. **Droite d’intersection** : `u = n1 × n2`. Si `‖u‖` &lt; `parallelCrossTolerance` → plans parallèles ou quasi confondus (diagnostic dédié).
4. **Point sur la droite** : résolution 2×2 en fixant la coordonnée correspondant à `argmax(|ux|,|uy|,|uz|)` à 0 (plan stable).
5. **Segment utile** : aux sommets topologiques `A_xy`, `B_xy` de l’arête, calculer `z1,z2` sur chaque plan ; former `qA = (xa,ya,(z1+z2)/2)` et `qB` analogue ; paramètres `tA = dot(qA − p0, û)`, `tB = dot(qB − p0, û)` avec `û` unitaire. Le segment est `p0 + t û` pour `t ∈ [min(tA,tB), max(tA,tB)]`.
6. **Gap** : comparer les projections XY de `p0 + tA û` et `p0 + tB û` à `A_xy` et `B_xy`.
7. **Step** : `maxStepAlongEdgeXY` sur A, B et milieu.

---

## Tolérances (défauts)

| Paramètre | Défaut | Rôle |
|-----------|--------|------|
| `xyAlignmentToleranceM` / `gapToleranceM` | 0,02 m | « Pas de vide » en plan : alignement droite ↔ arête attendue |
| `stepToleranceM` | 0,02 m | « Pas de marche » : écart Z entre plans sur l’arête |
| `parallelCrossTolerance` | 1e−6 | `‖n1×n2‖` : parallélisme |
| `segmentLengthSlackM` | 0,03 m | Segment 3D trop court vs `edge.lengthM` → `isClipped` |

---

## Cas supportés / limites v1

| Cas | Support v1 |
|-----|------------|
| Faîtage / arête partagée avec deux plans distincts | Oui (ligne + segment) |
| Noue / arêtier (types topologiques) | Oui comme **métadonnée** `officialEdgeKind` ; géométrie = même calcul |
| Pans non symétriques, pentes différentes | Oui |
| Raccord oblique (arête non alignée aux axes) | Oui (XY génériques) |
| Plans parallèles distincts | Diagnostic `unresolved_parallel_planes` |
| Plans quasi confondus | `unresolved_coincident_planes`, `hasOverlap` |
| Voisin topologique mais plan manquant | `unresolved_one_or_both_planes_missing` |
| Triangulation / mesh viewer / booléens complets | **Non** |
| Correction de relevé métier erroné | **Non** |

---

## Invariants

- Chaque intersection traitée est **traçable** à une arête du graphe (`topologyEdgeId`) et à une paire de pans déclarée voisine par ce graphe.
- Aucun voisin n’est inféré hors `incidentPatchIds`.
- Les plans utilisés sont **exclusivement** ceux du `RoofPlaneSolutionSet`.

---

## Matrice de validation

| Vérification | Critère |
|--------------|---------|
| Pans voisins détectés | Uniquement via arêtes `shared` du graphe |
| Ligne 3D d’intersection calculée | `intersectionLine3D != null` si plans sécants |
| Segment utile partagé | `sharedSegment3D` renseigné si résolu |
| Pas de gap (au sens défini) | `hasGap === false` et `gapDistanceM ≤ tol` |
| Pas de step | `hasStep === false` |
| Pas d’overlap (v1) | `hasOverlap === false` sauf cas confondus signalés |
| Cas incohérents diagnostiqués | Flags + `conflicts` + compteurs |
| Runtime brut absent | Pas d’import legacy calpinage |

---

## Références

- `roof-topology-graph.md`, `roof-plane-solver.md`, `canonical-house3d-model.md`
