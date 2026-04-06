# Liaison officielle toiture ↔ bâtiment (`bindRoofToBuilding`)

## Module

- **Implémentation** : `frontend/src/modules/calpinage/canonical3d/builders/bindRoofToBuilding.ts`
- **Types** : `frontend/src/modules/calpinage/canonical3d/model/roofBuildingBindingModel.ts`

**Entrées** : uniquement la chaîne canonique déjà construite :


| Entrée                 | Rôle                                                                                 |
| ---------------------- | ------------------------------------------------------------------------------------ |
| `BuildingShell3D`      | `bottomRing`, `topRing`, `wallFaces`, `baseZ`, `topZ` — haut de mur = `topZ`         |
| `RoofTopologyGraph`    | Arêtes typées (`officialKind`), `boundaryStatus` (`boundary` / `shared`), sommets XY |
| `RoofPlaneSolutionSet` | Plan par pan (`planeEquation`) — échantillonnage Z via `evaluateZOnRoofPlane`        |
| `RoofIntersectionSet`  | Contrôle transversal des coutures (aucune correction géométrique)                    |


**Interdit** : `CALPINAGE_STATE`, `window`, relire le runtime brut ; **aucune** modification du bâtiment, des plans, des intersections, ni snap silencieux non documenté.

**Non fait en v1** : extrusion des murs jusqu’au faîtage, volumes de pignon pleins, correction du relevé, rendu viewer.

---

## Sortie : `RoofBuildingBindingResult`

1. `**eaveBindings[]`** — chaque arête `boundary` avec `officialKind === "eave"` : rattachement au segment du `topRing`, segment 3D toit, `verticalOffsetM`, `outwardOverhangM`, diagnostics.
2. `**gableBindings[]**` — arêtes `gable` en frontière : mur, `minZOffsetFromWallTopM`, cohérence de fermeture.
3. `**freeRidgeBindings[]**` — arêtes `ridge` / `hip` / `valley` / `internal` en `boundary` (rives non typées eave/gable) : statut de support mur.
4. `**overhangs[]**` — une entrée par arête eave : distance de débord, intention heuristique, cohérence.
5. `**diagnostics**` — `roofAttachedToBuilding`, compteurs, `bindingConsistencyLevel`, erreurs / warnings, preuve structurelle, résumé des intersections.

---

## Logique de binding (écrite noir sur blanc)

### 1. Comment une arête toit est associée à un segment mur

- On considère uniquement les arêtes du graphe avec `boundaryStatus === "boundary"` (bord non partagé par deux pans).
- Pour chaque arête, on lit les positions XY des sommets topologiques `vertexTopologyIdA/B`.
- On évalue une **métrique de score** par mur candidat (segment du `topRing` + normale sortante issue de `wallFaces[segmentIndex]`) :
  - Si la direction de l’arête toit et celle du mur sont **quasi parallèles** (|cos θ| ≥ 0,995) : score = distance **perpendiculaire max** des trois échantillons (extrémités A, B, milieu) à la **droite** portée par le mur (plan XY). Tolérance d’acceptation : `wallParallelOffsetMaxM` (défaut **1,5 m**) — permet d’associer une gouttière débordante tout en restant parallèle au haut de mur.
  - Sinon : score = distance max point → **segment** mur (extrémités clampées). Tolérance : `wallSegmentXYToleranceM` (défaut **0,08 m**).
- Le mur retenu minimise le score. Si le score minimal dépasse la tolérance applicable, `**attachedWallSegmentId` reste `null`** (pas de rattachement forcé).
- **Ambiguïté** : si le deuxième meilleur score est dans la même tolérance et à moins de `wallMatchAmbiguityEpsilonM` du meilleur, le rattachement est refusé (`ambiguous`) et un warning est émis — **pas de choix arbitraire silencieux**.

### 2. Comment l’écart vertical est mesuré

- On choisit le plan du pan : premier `planeEquation` non nul parmi `incidentPatchIds` dans `RoofPlaneSolutionSet` (aucun recalcul de plan).
- `z_a = evaluateZOnRoofPlane(plan, x_a, y_a)`, idem `z_b`.
- `**verticalOffsetM = ((z_a + z_b) / 2) − shell.topZ`** (m). C’est l’écart moyen de l’arête toit par rapport au **plan horizontal du haut de mur**.

### 3. Alignement vs débord vs incohérence

- **Alignement Z** : `isSnappedToWallTop` si `|verticalOffsetM| ≤ zSnapToleranceM` (défaut 0,02 m).
- **Débord** : pour le mur retenu, on calcule les projections scalaires `(point − ancrage mur) · n_sortante` sur les trois échantillons (composantes XY de la normale sortante du mur).  
  - `**outwardOverhangM`** = plus grande de ces trois projections si elle est positive, sinon **0** (seule la saillie vers l’extérieur du mur compte pour la métrique « débord »).  
  - **Pénétration intérieure** : `minOutwardOverhang` (min des trois projections) très négatif (< −`wallSegmentXYToleranceM`) ⇒ incohérence (toit « à l’intérieur » du nu mur en plan).
- **Heuristique `isIntentional` (débord)** : `likely_intentional` si `outwardOverhangM ≥ intentionalOverhangThresholdM` (0,05 m) **et** Z snappé ; sinon `ambiguous` / `inconsistent_geometry` / `none` selon le cas (voir types).

### 4. Bâtiment imparfait / toiture imparfaite / les deux

- **Plan manquant ou Z non fini** : erreur `BINDING_EAVE_PLANE_MISSING` / `BINDING_EAVE_Z_INVALID`, compteur eave « flottante », pas de snap.
- **Mur introuvable dans la tolérance** : eave « non supportée », diagnostic explicite — **aucune** correction XY.
- **Z non aligné au haut de mur** : `misalignedEdgeCount`, `bindingConsistencyLevel` au minimum `partial`.
- **Intersections** : chaque entrée de `RoofIntersectionSet` est recopiée dans `intersectionCrossCheckSummary` ; `inconsistentIntersection > 0` dégrade le niveau de cohérence et `**roofAttachedToBuilding`** est faux.

---

## Niveaux `bindingConsistencyLevel`


| Niveau      | Conditions principales (v1)                                                            |
| ----------- | -------------------------------------------------------------------------------------- |
| `invalid`   | Erreurs bloquantes, ou murs absents, ou eaves « flottantes » (sans mur / plan)         |
| `partial`   | Écarts Z, ou intersections incohérentes, ou couture `partial` côté intersections       |
| `ambiguous` | Warning d’ambiguïté mur **ou** `sewingLevel === "ambiguous"` sur `RoofIntersectionSet` |
| `clean`     | Aucun des cas ci-dessus                                                                |


---

## Fixtures de développement

Répertoire : `frontend/src/modules/calpinage/canonical3d/builders/dev/`


| Fichier                       | Scénario                                            |
| ----------------------------- | --------------------------------------------------- |
| `binding-simple-aligned.json` | Rectangle, toit horizontal à `z = topZ`             |
| `binding-overhang-eave.json`  | Même cas avec gouttière déportée (parallèle au mur) |
| `binding-misaligned-z.json`   | Toit trop haut vs `topZ`                            |
| `binding-gable-flat.json`     | Deux arêtes `gable` sur pignon, toit plat           |


---

## Tests

`frontend/src/modules/calpinage/canonical3d/builders/__tests__/bindRoofToBuilding.test.ts`

---

## Matrice de validation (synthèse)


| Vérification                  | Indicateur                                                                  |
| ----------------------------- | --------------------------------------------------------------------------- |
| Eave alignée au mur (Z)       | `isSnappedToWallTop`, `verticalOffsetM`                                     |
| Pignon cohérent               | `isWallClosureGeometricallyConsistent`                                      |
| Débord détecté                | `outwardOverhangM`, `overhangs[]`, `structuralProof.overhangDetectionCount` |
| Arête flottante               | `floatingEdgeCount`, diagnostics `EAVE_UNSUPPORTED_`*                       |
| Pas de runtime brut           | Aucun import calpinage / `window`                                           |
| Pas de correction silencieuse | Rattachement refusé si hors tolérance ou ambigu                             |


---

## Références

- `canonical-house3d-model.md`, `canonical-house3d-invariants.md`
- `building-shell-3d.md`, `roof-topology-graph.md`, `roof-plane-solver.md`, `roof-plane-intersections.md`

