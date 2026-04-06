# Invariants — modèle canonique Maison 3D (`canonical-house3d-model-v1`)

Liste explicite des règles que tout parseur / builder / viewer **doit** respecter.  
Complément : `canonical-house3d-model.md`, `canonical-house3d-model.json`, `canonicalHouse3DModel.ts`.

---

## Général

1. **Un document canonique a exactement un `schemaId`** reconnu (`canonical-house3d-model-v1` jusqu’à migration majeure).
2. **Toutes les positions géométriques du cœur** (`building`, `roof` hors placement, `annexes` géométrie) sont en **mètres** dans le **repère local bâtiment** ; **Z = 0** est la base locale officielle.
3. **Aucune coordonnée WGS84 ni altitude terrain** dans les sommets du cœur — uniquement dans `worldPlacement` si présent.
4. **Le viewer ne modifie jamais** un `CanonicalHouseDocument` (lecture seule ; caméra hors modèle).

## Bloc bâtiment

5. **`building.buildingId`** est non vide et stable dans la durée d’une étude (même politique que les ids 2D exportés).
6. **`building.baseZ`** est **0** par convention ; toute autre référence verticale passe par `heightModel`.
7. **`buildingFootprint` et `buildingOuterContour`** sont des polygones fermés planaires (X,Y) ; ils peuvent être identiques ou différenciés **sans ambiguïté documentée** en `metadata` ou `heightModel.conventions`.

## Bloc toiture

8. **Un `roofPatchId` est unique** dans tout le document.
9. **Toute `RoofTopologyEdge` a un `kind` explicite** (`RoofEdgeKind`) — `unknown_structural` est autorisé temporairement mais **doit** être réduit par le parseur ou un classifieur métier.
10. **Chaque arête topologique référence deux sommets existants** (`vertexIdA`, `vertexIdB` ∈ `roof.topology.vertices`).
11. **Chaque patch topologique** référence un cycle cohérent d’arêtes / sommets (invariant de graphe planaire ou surface orientable — validation future).
12. **`roof.geometry` est cohérent avec `roof.topology`** : chaque `RoofPatchGeometry.roofPatchId` existe dans `topology.patches`.
13. **`roof.geometry.roofEdges[].edgeId`** correspond à une arête de la topologie (même id).

## Hauteurs

14. **Toute cote Z métier significative** est soit une entrée `HeightQuantity`, soit dérivable explicitement depuis une `HeightQuantity` (pas de magie silencieuse).
15. **`heightModel.zBase` existe** et a `role === "z_base"` et `valueM === 0` et `provenance` documentée (`business_rule` ou `business_rule` + note).
16. **Deux `HeightQuantity` distinctes ne partagent pas le même `id`**.

## Annexes

17. **`layout_keepout` ≠ `physical_roof_obstacle`** : jamais la même entrée `annexes[]` ne mélange ces deux sémantiques.
18. **`shading_volume` est disjoint de `layout_keepout`** : un volume ombrant peut coïncider géométriquement avec une zone interdite, mais ce sont **deux entrées** si les deux sémantiques s’appliquent.
19. **Chaque annexe a un `family` discriminé** — pas de type « obstacle » générique sans famille.
20. **`attachedRoofPatchIds` est vide uniquement si** la sémantique métier l’autorise (ex. annexe au bâtiment entier) — sinon au moins un patch.

## PV (quand présent)

21. **Chaque `PvPanelInstance.roofPatchId` référence un patch existant** dans `roof.topology.patches` / `roof.geometry.roofPatches`.
22. **Un panneau posé n’existe pas sans rattachement de patch** (pas de flottement dans le vide canonique).
23. **`projection2dTraceId` est optionnel** mais, s’il est présent, doit permettre l’audit 2D ↔ 3D (lien vers trace d’export, pas vers `drawState`).

## Exclusions (anti-invariants)

24. **Aucun champ canonique ne stocke** `drawState`, `selectionBox`, `viewport`, `ghost slot`, `safe zone cache`.
25. **`e_placed_panels_flat` ne suffit pas** à reconstruire la géométrie PV canonique — invariant de **non-régression** : le parseur ne doit pas s’en servir comme seule source.

## Cohérence avec le dictionnaire 2D

26. **Les miroirs 2D** (`planes[]`, `roof.roofPans`, `placedPanels`) **ne sont pas des sources primaires** du canonique — seulement des contrôles de cohérence ou des entrées de secours documentées.
27. **Les brouillons 2D** (`activeContour`, `activeRidge`, …) **n’entrent pas** dans le document tant qu’ils ne sont pas commités dans le state persisté équivalent.

## Relations (résumé)

28. **Appartenance** : `roof.topology.roofId` est lié à un seul bâtiment via bindings (`roofToBuildingBindings` ou convention documentaire unique-bâtiment).
29. **Pas de cycles impossibles** dans les ids de groupe PV (à valider quand `pv` sera peuplé).

---

**Nombre d’invariants listés** : **29** (dont anti-invariants et exclusions).
