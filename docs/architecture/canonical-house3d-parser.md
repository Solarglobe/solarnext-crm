# Parseur officiel CALPINAGE_STATE → `CanonicalHouseDocument`

## Rôle

**Un seul module** est autorisé à lire le runtime brut calpinage pour alimenter le moteur Maison 3D :

`frontend/src/modules/calpinage/canonical3d/parsing/parseCalpinageStateToCanonicalHouse3D.ts`

Export : `parseCalpinageStateToCanonicalHouse3D(state, context?)`  
Résultat : `CanonicalHouse3DParseResult` (`document`, `diagnostics`, `provenance`, `eligibility`, `sourcesUsed`, `sourcesIgnored`, …) — voir `canonicalHouse3DParseDiagnostics.ts`.

## Principes non négociables

1. **Lire, ne pas deviner** : pas de solveur toiture, pas de plan moyen, pas d’extrapolation de Z.
2. **Hauteurs** : uniquement champs **explicitement** présents sur le runtime (ex. `.h`, `heightM`, hauteurs shadow/extension). Aucun appel à `fitPlane`, `getHeightAtXY`, unify, impose, etc.
3. **Pur** : pas de `window`, pas de DOM, pas de mutation globale ; testable en Node / Vitest.
4. **Traçable** : provenance par familles (`building`, `roofTopology`, `roofGeometry`, `heights`, `annexes`, `pv`, `worldPlacement`).

## Entrées lues (v1)

| Chemin runtime | Usage |
|----------------|--------|
| `state.roof.scale.metersPerPixel` | Échelle ; bloquant si absent |
| `state.roof.roof.north.angleDeg` | Rotation nord (défaut 0) |
| `state.roof.gps` | GPS optionnel |
| `state.roof.canonical3DWorldContract` | Détection de présence uniquement |
| `state.contours` | Footprint bâtiment + arêtes contour topologie |
| `state.ridges` | Arêtes faîtage |
| `state.traits` | Arêtes structurelles |
| `state.pans` / `validatedRoofData.pans` | Patches toit (voir priorité) |
| `state.roof.roofPans` | Contrôle miroir (longueur) uniquement |
| `state.obstacles` | Annexes obstacles |
| `state.shadowVolumes` | Annexes volume d’ombrage |
| `state.roofExtensions` | Annexes extensions |
| `state.placedPanels` | Info diagnostic uniquement |
| `state.roofSurveyLocked` | Condition snapshot pans |
| `context.frozenPvBlocks` | Seule source PV géométrique |

## Entrées ignorées (v1)

- `drawState`, sélection UI, caches internes non listés ci-dessus.
- `geometry_json` : non consommé (évolution future documentée).
- Géométrie détaillée des **segments 3D** des arêtes toit : **non émise** en v1 (`roof.geometry.roofEdges` vide) ; diagnostic `ROOF_EDGE_SEGMENT_GEOMETRY_DEFERRED` — la topologie d’arêtes (`roof.topology.edges`) est présente pour un builder ultérieur.

## Hiérarchie des sources

Document dédié et normatif : **`canonical-house3d-source-priority.md`**.

## Diagnostics et éligibilité

- Liste structurée `diagnostics[]` (`code`, `severity`, `message`, `path?`).
- `eligibility` : `house3dBuildable`, `roof3dBuildable`, `obstacles3dBuildable`, `pv3dBuildable`, `reasons[]`.
- **« Buildable »** = données suffisamment complètes et saines pour enchaîner un **builder** fiable, pas « ça s’affiche ».

## Matrice décisionnelle (extrait)

| Élément runtime | Action parseur | Pourquoi |
|-----------------|----------------|----------|
| `contours[]` | Prend (topologie + footprint) | Source primaire |
| `ridges[]` | Prend | Primaire faîtage |
| `traits[]` | Prend | Primaire structure |
| `validatedRoofData.pans` | Prend si conditions snapshot | Snapshot figé |
| `pans[]` | Prend / fallback | Live ou secours |
| `roof.roofPans` | Ignore comme liste ; trace mismatch | Miroir legacy |
| `placedPanels` | Trace (info) | Export legacy, pas PV officiel |
| `context.frozenPvBlocks` | Prend si fourni | Seul canal PV géométrique |
| `fitPlane` / `getHeightAtXY` / unify | **Interdit** | Estimation Z |
| `imagePxToWorldHorizontalM` | Autorisé | Conversion **horizontale** seulement |

Table complète alignée sur `2d-entity-dictionary.md` / ambiguïtés.

## Tests et fixtures

- Fixtures JSON : `frontend/src/modules/calpinage/canonical3d/parsing/dev/*.json`
- Tests Vitest : `frontend/src/modules/calpinage/canonical3d/parsing/__tests__/`

## Fichiers liés

- Modèle : `canonicalHouse3DModel.ts`, `canonical-house3d-model.md`, `canonical-house3d-invariants.md`
- Dictionnaire 2D : `2d-entity-dictionary.md`, `2d-entity-ambiguities.md`
