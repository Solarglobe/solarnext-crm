# Validation géométrique / topologique officielle — Maison 3D (Prompt 9)

## Rôle

Cette couche est la **vérité produit** pour distinguer :

- une maison qui **se rend** visuellement ;
- une maison dont la géométrie et la topologie sont **exploitables** de façon cohérente.

Elle **ne lit pas** `CALPINAGE_STATE`, `window`, ni l’état UI. Elle travaille uniquement sur les **artefacts canoniques** déjà produits par la chaîne 3D.

## Entrée officielle

Fonction : `validateCanonicalHouse3DGeometry`  
Fichier : `frontend/src/modules/calpinage/canonical3d/validation/validateCanonicalHouse3DGeometry.ts`

Paramètres attendus (résumé) :

| Entrée | Rôle |
|--------|------|
| `document` | `CanonicalHouseDocument` (footprint, annexes `roofAnnexes` si présentes) |
| `shellResult` | `BuildBuildingShell3DResult` |
| `topologyGraph` | `RoofTopologyGraph` |
| `solutionSet` | `RoofPlaneSolutionSet` |
| `intersectionSet` | `RoofIntersectionSet` |
| `bindingResult` | `RoofBuildingBindingResult` |
| `options?` | `maxPlaneResidualM`, `strictPlaneProvenance` |

## Sortie officielle

Type : `CanonicalHouse3DValidationReport`  
Schéma : `schemaId === "canonical-house-3d-validation-report-v1"`  
Fichier modèle : `canonicalHouse3DValidationModel.ts`

Champs globaux utiles :

- `globalValidity` : `true` si **aucun** diagnostic de sévérité `error`.
- `globalQualityLevel` : `clean` | `acceptable` | `partial` | `ambiguous` | `invalid`.
- `isBuildableForViewer` | `isBuildableForPremium3D` | `isBuildableForShading` | `isBuildableForPV` : **indicateurs produit** (non équivalents à « zéro warning »).
- `errorCount` / `warningCount` / `infoCount` : agrégés sur **tous** les blocs.
- Blocs : `buildingValidation`, `roofTopologyValidation`, `roofPlanesValidation`, `roofIntersectionsValidation`, `roofBuildingBindingValidation`, `roofAnnexesValidation`, `globalGeometryValidation`.

Chaque bloc expose `status`, compteurs et `diagnostics[]` avec `code`, `severity`, `message`, `entityIds`, `details`.

## Codes diagnostics

Liste stable : `canonicalHouse3DValidationCodes.ts` (`CanonicalHouse3DValidationCode`).  
Ne pas renommer sans migration côté QA / exports.

## Niveaux de qualité (`globalQualityLevel`)

Logique (ordre de priorité) :

1. **`invalid`** : au moins une erreur (`severity === "error"`) dans le rapport agrégé.
2. **`ambiguous`** : un des diagnostics **upstream** signale une ambiguïté structurelle :  
   `topologyGraph.diagnostics.topologyBuildabilityLevel === "ambiguous"` **ou**  
   `bindingResult.diagnostics.bindingConsistencyLevel === "ambiguous"` **ou**  
   `intersectionSet.diagnostics.sewingLevel === "ambiguous"`.
3. **`partial`** : coutures, binding ou topo en mode `partial`, ou plans avec patches partiels / fallback (via compteurs du `solutionSet`), ou topo `partial`.
4. **`acceptable`** : pas d’erreur, pas d’état partial/ambiguous ci-dessus, mais au moins un **warning**.
5. **`clean`** : pas d’erreur ni de warning.

Les messages **`info`** (ex. couche annexes absente, plans partiels informatifs) **ne dégradent pas** seuls le niveau jusqu’à `acceptable` ; ils enrichissent le diagnostic.

## Sévérités et « bloquant »

- **`error`** : contribue à `globalValidity === false` et force `globalQualityLevel === "invalid"`.
- **`warning`** : la maison peut rester « valide » au sens `globalValidity`, mais le niveau descend au moins à `acceptable`, ou reste `ambiguous` / `partial` selon les drapeaux upstream.
- **`info`** : traçabilité ; ne bloque pas `globalValidity`.

Les flags `isBuildableFor*` appliquent des règles **métier** supplémentaires (ex. ratio de pans résolus pour l’ombrage, exclusion de `ambiguous` pour le PV).

## Ce que la couche valide (par bloc)

- **Bâtiment** : footprint minimal, coque présente, fermeture latérale, diagnostics du builder, murs (longueur, hauteur), normales, cohérence anneaux / extrusion selon les données exposées par `shellResult`.
- **Topologie toit** : intégrité du graphe, pans non dégénérés, arêtes / voisinages, diagnostics du graphe.
- **Plans toit** : présence de solution, quasi-vertical, résidu vs tolérance (`maxPlaneResidualM`), sous-contrainte, conflit, fallback, cohérence sommets ↔ plan.
- **Intersections** : entrées d’intersection, gaps / steps, diagnostics agrégés du set (y compris `gapCount` / `stepCount`), niveau de couture.
- **Binding toit ↔ bâtiment** : attache, eaves, gables, rives, surplombs selon `bindingResult`.
- **Annexes** : si `roofAnnexes` absent → bloc `skipped` + info `ANNEX_LAYER_MISSING_OPTIONAL` ; sinon volumes, hôte, ambiguïtés, besoin de split topo, etc.
- **Global** : synthèse (incomplétude, ambiguïté, normales globales, cohérence d’ensemble limitée aux signaux disponibles).

## Ce que la couche ne valide pas (encore)

- Pas un moteur CAD complet : pas de preuve formelle d’étanchéité maillage, pas de tests B-rep exhaustifs.
- Pas de validation physique (charges, neige, vent).
- Pas de relecture des sources 2D brutes hors document canonique.
- Les seuils (résidu, ratio pans résolus pour shading) sont **configurables partiellement** ; un durcissement produit peut nécessiter des ajustements.

## Intégration produit

Exports publics : `frontend/src/modules/calpinage/canonical3d/index.ts` (section validation).  
Brancher le validateur **après** la construction des artefacts canoniques ; ne pas utiliser le viewer comme source de vérité.

## Tests

Fichier : `frontend/src/modules/calpinage/canonical3d/validation/__tests__/validateCanonicalHouse3DGeometry.test.ts`  
Commande : `npx vitest run src/modules/calpinage/canonical3d/validation/__tests__/validateCanonicalHouse3DGeometry.test.ts`
