# Structure toiture runtime → canonical3d (ridges / traits)

## Données côté calpinage (source réelle)

- **`CALPINAGE_STATE.ridges`** : segments faîtage / arêtier (`{ id, a, b, roofRole? }`, coordonnées **image px**).
- **`CALPINAGE_STATE.traits`** : lignes structurantes internes (même forme).
- Les **pans** restent portés par **`CALPINAGE_STATE.roof.roofPans`** (polygones). La séparation des pans est cette géométrie + les lignes qui les coupent / les bords partagés.

Aucune donnée n’est inventée : si les tableaux sont absents ou vides, le builder 3D ne reçoit pas de lignes structurantes.

## Contrat officiel dans la chaîne

Module unique : `frontend/src/modules/calpinage/integration/calpinageStructuralRoofFromRuntime.ts`.

- **`resolveCalpinageStructuralRoofForCanonicalChain(state, explicit)`**  
  - `explicit === undefined` → lecture de `state.ridges` / `state.traits`, filtre dégénérés (segment trop court, points invalides, `roofRole === "chienAssis"`).  
  - `explicit === null` → forcer l’absence de lignes (override).  
  - `explicit` objet → priorité sur les tableaux fournis.
- **`structuralRoofLineRawUsable`** : prédicat partagé avec `mapCalpinageToCanonicalNearShading` et `calpinageStateToLegacyRoofInput` (pas de double logique divergente).

Sortie : **`CalpinageStructuralRoofPayload`** `{ ridges, traits }` passée à  
`mapCalpinageRoofToLegacyRoofGeometryInput(roof, payload)` puis **`buildRoofModel3DFromLegacyGeometry`** (solveur inchangé).

## Transit dans les entrées scène

- **`buildCanonicalScene3DInput`** : résout le structural une fois, alimente `loadPanelsFromCalpinageState` / `mapCalpinageRoofToLegacyRoofGeometryInput`, et remplit **`diagnostics.structuralRoof`** (compteurs raw / kept / dropped, `source`).
- **`buildSolarScene3DFromCalpinageRuntime`** : même résolution que ci-dessus pour l’appel **`mapCalpinageRoofToLegacyRoofGeometryInput`** (correctif historique : ne plus passer `undefined`).
- **`validateCanonicalScene3DInput`** : propage les `diagnostics.warnings` de l’assembleur (codes `SCENE_ASSEMBLER_WARNING`), y compris les messages `STRUCTURAL_ROOF_*`.

## Mapper `roofPans` → legacy

`mapCalpinageRoofToLegacyRoofGeometryInput` propage désormais **`heightM`** si le sommet porte **`h`** ou **`heightM`** (données déjà présentes sur le runtime, pas de valeur inventée).

## Diagnostics utiles

| Message | Signification |
|--------|----------------|
| `STRUCTURAL_ROOF_MULTI_PAN_NO_LINES` | Au moins 2 pans dans le state mais aucune ridge/trait exploitable. |
| `STRUCTURAL_ROOF_ALL_REJECTED` | Entrées présentes mais aucune ligne ne passe la validation. |
| `STRUCTURAL_ROOF_DROPPED_RIDGES` / `TRAITS` | Entrées dégénérées filtrées (compteurs dans `diagnostics.structuralRoof`). |

## Ce que ça ne garantit pas

- Hauteurs finales PV, viewer produit, shading prod, édition 3D interactive.
- Cohérence géométrique avancée ridge ↔ pan (hors tolérances du solveur existant) : une ligne peut être ignorée si aucune arête 3D ne matche (`STRUCTURAL_LINE_NO_EDGE_MATCH` côté builder).
