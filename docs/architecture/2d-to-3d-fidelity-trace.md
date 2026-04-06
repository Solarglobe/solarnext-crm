# Fidélité 2D brut → 3D — trace source et confiance (Prompt 10-bis)

## Couverture

| Couche | Rôle |
|--------|------|
| **`sourceTrace` sur `SolarScene3D`** | Référence légère : ids pans / obstacles / panneaux attendus, ids patches toiture legacy, contour 2D optionnel (`contourPx`), métriques (aire/bbox image, comptages). |
| **`validate2DTo3DCoherence`** | Cohérence **structurelle** (monde, pans, volumes, panneaux) **+ fidélité** (couverture ids, divergence double chemin toiture, emprise globale heuristique, dispersion panneaux). |
| **`coherence.confidence`** | Synthèse **non marketing** : lien 2D, niveau de traçabilité toiture, confiance géométrique, ratio de couverture source optionnel. |
| **`coherence.summary`** | Booléens + compteurs **dérivés des issues** (et présence de `sourceTrace`) : lecture rapide sans parcourir la liste complète. |
| **`coherence.sceneQualityGrade`** | Lettre **A–F** dérivée de `isCoherent`, `summary`, `confidence` — règles dans `coherenceDerive.ts` + seuils `coherenceGradeConstants.ts`. |

## `sourceTrace`

- **Pas** une copie de `CALPINAGE_STATE` : uniquement ce qui sert l’audit (voir `buildScene2DSourceTraceFromCalpinage`).
- Remplie automatiquement par **`buildSolarScene3DFromCalpinageRuntime`**.
- Pour les scènes construites sans runtime (tests, démo), peut être absente → warning `ROOF_SOURCE_TRACE_TOO_WEAK` et `confidence` dégradée.

## `confidence`

| Champ | Signification |
|--------|----------------|
| `source2DLinked` | Contour exploitable **ou** ids source + ids legacy présents. |
| `roofTraceabilityLevel` | `FULL` = contour + ids ; `PARTIAL` = ids seuls ; `LEGACY_ONLY` = ids patches attendus seulement ; `NONE` = pas de trace. |
| `geometryConfidence` | `HIGH` / `MEDIUM` / `LOW` selon erreurs, warnings, absence de trace, couverture source. |
| `sourceCoverageRatio` | Moyenne des taux de retrouvaille ids pans / obstacles / panneaux (0..1), si trace avec ids. |

## Ce que le système garantit

- Détection **explicite** des écarts source → scène (ids manquants, Jaccard pans, divergence legacy vs canonique).
- Signalement **honête** quand la scène est localement valide mais **globalement** suspecte (aire vs emprise, dispersion panneaux).
- **Pas** de correction automatique : diagnostics seulement.

## Ce qui n’est pas garanti

- Égalité millimétrique contour brut ↔ maillage 3D.
- Solveur de hauteur / topologie complète du polygone dessiné.
- Cas multi-surfaces complexes au-delà des heuristiques documentées dans `fidelityConstants.ts`.

**Point central d’évaluation** : `validate2DTo3DCoherence` dans  
`frontend/src/modules/calpinage/canonical3d/validation/validate2DTo3DCoherence.ts`.  
Les champs `summary` et `sceneQualityGrade` sont calculés dans le même flux, via **`buildCoherenceSummary`** et **`computeSceneQualityGrade`** (`validation/coherenceDerive.ts`).

Voir aussi : `docs/architecture/2d-to-3d-coherence-audit.md`.
