# Solveur officiel des plans toiture

## Module

- **Solveur** : `frontend/src/modules/calpinage/canonical3d/builders/solveRoofPlanes.ts`  
- **Types** : `frontend/src/modules/calpinage/canonical3d/model/roofPlaneSolutionModel.ts`

**Entrées** : `SolveRoofPlanesInput` = `CanonicalHouseDocument` + `RoofTopologyGraph` + options (`residualToleranceM`, `allowSecondaryHeightProvenance`).

**Interdit** : `CALPINAGE_STATE`, `window`, et comme **source principale** : `fitPlane`, `getHeightAtXY`, `unify`, `impose`, `anti-spike` (non importés, non utilisés).

---

## Entrées détaillées

| Champ | Statut |
|--------|--------|
| `document.roof.topology` (patches, vertices, edges) | Obligatoire — positions XY et `heightQuantityId` par sommet |
| `document.heightModel` | Obligatoire — résolution Z via `quantities` + `zBase` |
| `topologyGraph` | Obligatoire — filtre pans `ok`, indices topologiques (types d’arête, voisinages, contraintes) |
| `document.roof.geometry` | **Ignoré** (pas de reprise mesh legacy) |
| `building` | **Ignoré** en v1 (liaisons déjà portées par le graphe / contraintes) |

**Refusé** : toute autre source de hauteur non traçable dans le canonique.

---

## Hiérarchie des contraintes

1. **Primaires** : hauteurs dont `provenance` ∈ { `user_input`, `business_rule` } — base du moindres carrés `z = a·x + b·y + c`.
2. **Secondaires** (si `allowSecondaryHeightProvenance !== false` et &lt; 3 primaires) : `solver`, `fallback`, `reconstruction` — **marquées** `isFallbackUsed`, `constraintTier: secondary`.
3. **Fallback legacy** : **non branché** dans ce module — réservé à migration / audit externe.

**Indices topologiques** : arêtes du graphe (eave, ridge, …) sont enregistrées dans `topologyHintsUsed` pour **traçabilité** ; elles **ne remplacent pas** les hauteurs en v1 (pas d’inference géométrique magique).

---

## Sortie : `RoofPlaneSolutionSet`

Par pan (`RoofPatchPlaneSolution`) :

- `planeEquation` : `n·p + d = 0`, `|n| = 1`, `n_z > 0`.
- `explicitZ` : `{ a, b, c }` avec `z = a·x + b·y + c`.
- `evaluateZOnRoofPlane(equation, x, y)` (export utilitaire).
- `solvedVertices3D` : coins du contour canonique avec Z **sur le plan** résolu.
- `supportConstraintsUsed` : sommets / quantités / provenance / tier.
- `resolutionMethod`, `resolutionConfidence`, `isFullyConstrained`, `isFallbackUsed`, `maxResidualM`.

---

## Logique mathématique (v1)

1. Pour chaque pan graphe `status === ok`, alignement avec le patch canonique (même nombre de sommets).
2. Échantillons `(x,y,z)` sur les sommets du contour ayant une hauteur résolue via `heightQuantityId` → `heightModel`.
3. Si ≥ 3 échantillons : système normal **moindres carrés** sur les coefficients `a,b,c`.
4. Contrôle **résidu max** sur les échantillons utilisés ; si &gt; `residualToleranceM` → **conflit**, pas de `solvedVertices3D`.
5. Plan **presque vertical** (`n_z` trop petit) → non supporté v1.
6. Empreinte XY dégénérée (aire ~0) → invalide.

---

## Cas supportés / limites v1

| Cas | Support |
|-----|---------|
| Pan plan horizontal (même Z coté) | Oui |
| Pan incliné avec ≥3 cotations cohérentes | Oui |
| Triangle / trapèze cotés | Oui |
| Ridge / eave en graphe | Indices seulement (`topologyHintsUsed`) |
| &lt; 3 hauteurs fiables (primaires seules si secondary interdit) | Non résolu (explicite) |
| Hauteurs contradictoires (résidu) | Conflit, non validé |
| Raccord 3D exact entre pans | **Non** |
| Intersection lignes 3D, couture volumique | **Non** |
| Obstacles / Velux sur plan | **Non** |

---

## Invariants

- Tout sommet dans `solvedVertices3D` vérifie `|n·p + d| ≈ 0` (à tolérance float).
- Aucun Z « inventé » sans plan : si pas de plan, `solvedVertices3D === null`.
- Chaque plan résolu est **justifiable** via `supportConstraintsUsed`.

---

## Matrice de validation

| Vérification | Critère |
|--------------|---------|
| Pan résolu mathématiquement | `planeEquation != null` et résidu OK |
| Normale propre | unitaire, `n_z > 0` |
| z(x,y) exploitable | `evaluateZOnRoofPlane` |
| Sommets sur le plan | `solvedVertices3D` cohérents |
| Contraintes métier | `supportConstraintsUsed` non vide si résolu |
| Pas de legacy principal | pas d’import fitPlane / getHeightAtXY |
| Ambiguïtés | `ambiguousPatchCount`, warnings graphe |

---

## Références

- `roof-topology-graph.md`, `canonical-house3d-model.md`, `canonical-house3d-parser.md`, `canonical-house3d-source-priority.md`
