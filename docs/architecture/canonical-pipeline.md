# SolarNext — Canonical Pipeline (Official)

## 1. Objectif

Définir le **pipeline canonical officiel** SolarNext pour la 3D, la géométrie structurée, et les usages futurs **shading / rendu / export** — sans ambiguïté sur ce que « canonical » signifie.

Documents liés : `3d-world-convention.md`, `3d-convergence-plan.md`, `canonical3d/core/worldConvention.ts`.

---

## 2. Rôle du canonical

Le canonical **n’est pas** :

- un simple payload « pour le viewer » improvisé ;
- un cache visuel ou un snapshot d’UI ;
- un second moteur produit indépendant du runtime calpinage.

Le canonical **est** :

> La représentation **géométrique et technique structurée**, **stable** et **exploitable** du projet — toiture résolue en monde, pans / arêtes / faîtages, volumes (obstacles / extensions), surfaces panneaux 3D, **et** (optionnellement) références ou résultats de **shading 3D canonique** agrégés dans une scène (`SolarScene3D`).

Le module `frontend/src/modules/calpinage/canonical3d/` implémente ce pipeline **sans dépendre** du runtime CRM (`index.ts` : contrat explicite).

---

## 3. Frontières officielles

### A. Canonical Geometry

Relève du **canonical geometry** (types + builders dans `canonical3d/`) :

| Domaine | Exemples code |
|---------|----------------|
| Modèle toiture 3D | `RoofModel3D`, `RoofVertex3D`, `RoofEdge3D`, `RoofRidge3D`, `RoofPlanePatch3D` |
| Repère monde | `WorldReferenceFrame`, `upAxis`, unités `m` / `deg` (`RoofModelMetadata`) |
| Entrée 2D → toiture | `LegacyRoofGeometryInput` → `buildRoofModel3DFromLegacyGeometry` |
| Volumes | `buildRoofVolumes3D` + `BuildRoofVolumes3DInput` / `LegacyObstacleVolumeInput` / `LegacyExtensionVolumeInput` |
| Panneaux 3D | `PvPanelSurface3D` (coins monde, repères locaux, grilles d’échantillonnage, etc.) |
| Mapping image → horizontal monde | `imagePxToWorldHorizontalM`, `worldConvention.ts` |
| Agrégation scène | `buildSolarScene3D` : **assemble** roof + volumes + panneaux + qualité (pas de recalcul géométrique métier dans cette fonction) |

### B. Canonical Shading

Relève du **canonical shading** (couche **additive**, voir `types/near-shading-3d.ts`) :

| Élément | Rôle |
|---------|------|
| Entrées | `NearShadingSceneContext` (panneaux + volumes + params raycast), `NearShadingSolarDirectionInput` (direction vers soleil, monde) |
| Sorties | `NearShadingSeriesResult`, `NearShadingPanelResult`, `NearShadingSampleResult`, `QualityBlock` / `GeometryDiagnostic` par niveau |
| Métadonnées | Qualité, comptages, ratios, refus éventuels **structurés** dans les types |

**Distinction** : le **shading runtime CRM** (`CALPINAGE_STATE.shading`, near/far normalisé, DSM, etc.) est **hors** de ce document comme moteur source ; le canonical shading 3D est le **contrat raycast / scène** pour preuves 3D et injection dans `SolarScene3D` si fourni.

### C. Viewer

Le **viewer officiel** (`SolarScene3DViewer.tsx` + `solarSceneThreeGeometry.ts`) :

| Autorisé | Interdit |
|----------|----------|
| Lire `SolarScene3D` et types dérivés | Recalculer la géométrie métier |
| Tesseller / afficher (Three.js) | Recréer des volumes ou obstacles |
| Colorer à partir de `nearShadingSnapshot` **déjà présent** | Redeviner les panneaux ou leur pose |
| Contrôles caméra / grille / UX rendu | Recalculer le shading comme **vérité** produit |

---

## 4. Entrées officielles du canonical

Toutes les entrées ci-dessous sont des **DTO typés** ; les adaptateurs futurs mapperont `CALPINAGE_STATE` / JSON vers ces contrats.

### 4.1 Toiture (`buildRoofModel3DFromLegacyGeometry`)

**Source de vérité code** : `LegacyRoofGeometryInput` (`builder/legacyInput.ts`).

| Champ / groupe | Obligatoire | Optionnel / dégradable |
|----------------|-------------|-------------------------|
| `metersPerPixel` (> 0) | **Oui** | — |
| `northAngleDeg` | **Oui** (convention documentée) | — |
| `defaultHeightM` | **Oui** | — |
| `pans[]` (polygones px + ids) | **Oui** (sinon modèle vide / rejet selon builder) | — |
| `ridges`, `traits` | Non | **Recommandé** pour Z / faîtages ; absence = reconstruction dégradée / défauts hauteur |
| `extensions` | Non | Audit / futur ; non résolu dans le solveur principal actuel |
| `studyRef`, `createdAtIso` | Non | Traçabilité |

**Image** : origine haut-gauche, +x droite, +y bas (px) — aligné `legacyInput.ts`.

### 4.2 Volumes (`buildRoofVolumes3D`)

**Source** : `BuildRoofVolumes3DInput` + contexte optionnel `BuildRoofVolumes3DContext` (`volumes/volumeInput.ts`).

| Élément | Obligatoire | Notes |
|---------|-------------|--------|
| Listes `obstacles` / `extensions` | Peuvent être vides | Footprint `world` ou `image_px` + `metersPerPixel`, `northAngleDeg`, `baseElevationM` si image |
| `roofPlanePatches` (contexte) | Non | **Améliore** ancrage / extrusion pan ; sinon repli `vertical_world_z` + diagnostics |

### 4.3 Panneaux 3D

Produits par les builders panneaux du canonical (ex. contexte pan, quads monde) — entrées détaillées dans les modules `pvPanels/` ; dépendent d’un `RoofModel3D` / pans résolus.

### 4.4 Scène (`buildSolarScene3D`)

**Source** : `BuildSolarScene3DInput` (`scene/buildSolarScene3D.ts`).

| Champ | Obligatoire | Optionnel |
|-------|-------------|-----------|
| `roofModel` | **Oui** | — |
| `obstacleVolumes`, `extensionVolumes` | **Oui** (tableaux, peuvent être vides) | — |
| `volumesQuality` | **Oui** | — |
| `pvPanels` | **Oui** (tableau, peut être vide) | — |
| `solarDirections`, `solarSamplingKind`, `solarDescription` | Non | Contexte solaire pour scène / replay |
| `nearShadingSeries`, `nearShadingEngineId` | Non | Si absent : **pas** de `nearShadingSnapshot` sur la scène |
| `studyRef`, `integrationNotes`, `generator` | Non | Métadonnées |

**Données shading CRM pré-calculées** : ne sont **pas** requises pour produire une `SolarScene3D` valide géométriquement ; elles peuvent être **fusionnées** plus tard via adaptateur si le produit l’exige (hors périmètre de ce document).

---

## 5. Sorties officielles du canonical

### Garanties (si builders réussissent)

| Sortie | Description |
|--------|-------------|
| `RoofModel3D` | Sommets, arêtes, faîtages, patches planaires, obstacles / extensions **topologiques** (selon builder), `globalQuality` |
| Maillages volumes | `RoofObstacleVolume3D`, `RoofExtensionVolume3D` (sommets, faces, bornes) |
| `PvPanelSurface3D[]` | Surfaces panneau résolues pour raycast / scène |
| `SolarScene3D` | Agrégat : metadata + roof + volumes + panneaux + qualité volumes |

### Optionnelles / conditionnelles

| Sortie | Condition |
|--------|-----------|
| `solarContext` sur `SolarScene3D` | Si `solarDirections` fourni et non vide |
| `nearShadingSnapshot` | Si `nearShadingSeries` fourni |
| Richesse des diagnostics / quality | Selon complétude des entrées (traits, pans, volumes) |

### Non garanties par le seul canonical

- KPI shading **produit** CRM (near/far combiné écran) — autre pipeline.
- Image 2D rendue — hors canonical.

---

## 6. Doctrine de vérité

### Autoritaire

- Coordonnées **monde** des entités canonical (`Vector3` en m dans le repère `referenceFrame`).
- Topologie et géométrie **résolues** dans `RoofModel3D` et volumes une fois builders passés.
- Positions / normales panneaux dans `PvPanelSurface3D` telles que produites par le canonical.
- `QualityBlock` / diagnostics **émis par les builders** (statut pipeline géométrique).
- `NearShadingSeriesResult` **une fois calculé** par le moteur near canonical : autoritaire **pour la preuve 3D near**, pas pour remplacer seul le contrat CRM sans accord produit.

### Dérivé

- BufferGeometry Three.js, meshes, couleurs d’affichage.
- Agrégats **affichage** (`panelShadingSummaryById` dans `buildSolarScene3D` : dérivé de `seriesResult`).

### Fallback / dégradable

- Shading near **absent** sur `SolarScene3D` : **normal** ; géométrie toujours valide.
- Extrusion volume en `vertical_world_z` si pan non résolu : **documenté** dans les builders volumes.
- Hauteurs par défaut si sommets sans `heightM` : **dégradé** mais **tracé** via quality / diagnostics.

### Refusé (anti-patterns)

- Viewer qui **corrige** silencieusement les positions pour « mieux afficher ».
- Recalcul near shading dans le viewer pour **sourcer** un KPI business.
- Mélanger repère legacy preview (Y-up Three + `originPx`) et repère canonical **sans** passer par un adaptateur documenté.

### Hors canonical

- État UI pur, sélection, flags interaction.
- `CALPINAGE_STATE` brut **avant** mapping vers DTO — le runtime n’est pas le canonical ; le **résultat typé** des builders l’est.

---

## 7. Contrat Geometry → Shading

**Le shading canonical near a le droit de consommer** :

- `NearShadingSceneContext` : `PvPanelSurface3D[]`, volumes obstacle / extension, paramètres raycast.
- Directions soleil : `NearShadingSolarDirectionInput[]` (unitaires, monde).

**Il doit produire** (lorsqu’il est invoqué) :

- `NearShadingSeriesResult` (série temporelle / directions, résultats par panneau, qualité globale et par pas).

**Obligatoire pour un run near** : contexte scène cohérent + directions + params finis ; sinon le moteur doit **échouer proprement** ou retourner qualité dégradée **sans** inventer de géométrie.

**Si le shading near ne peut pas être calculé** :

- La **géométrie canonical** (`RoofModel3D`, volumes, panneaux) **reste valide** et exploitable.
- `buildSolarScene3D` peut être appelé **sans** `nearShadingSeries` : pas de `nearShadingSnapshot`.
- Le produit peut afficher « near 3D indisponible » tout en conservant toiture / volumes / viewer géométrique.

> **Crucial** : l’indisponibilité, le refus, le fallback ou la dégradation du **shading canonical** **n’invalident pas** la géométrie canonical.

---

## 8. Contrat Canonical → Viewer

**Le viewer a le droit de lire** :

- Tout champ **lecture** de `SolarScene3D` exposé pour le rendu (roof, volumes, panneaux, `nearShadingSnapshot` si présent, metadata utile à l’UI debug).

**Le viewer n’a pas le droit de** :

- Recalculer ou **recomposer** la géométrie métier (pans, obstacles, panneaux).
- Corriger silencieusement positions / normales.
- Changer d’unité ou d’axe **implicitement** (respecter `3d-world-convention.md` ; tessellation = copie des coords sauf convention documentée identité).

---

## 9. Contrat Produit

Le produit peut classer les données ainsi :

| Niveau | Exemple |
|--------|---------|
| **Fiable** | `RoofModel3D` + quality OK ; volumes avec diagnostics mineurs acceptés métier. |
| **Dégradé** | Hauteurs interpolées, extrusion repli Z, quality warnings présents mais scène utilisable. |
| **Incomplet** | Pans partiels, extensions non résolues dans le maillage principal (explicite dans metadata / reconstructionSource). |
| **Non calculé** | Near shading 3D non passé dans la scène ; shading CRM inchangé comme autre source. |
| **Fallback** | Paramètres raycast assouplis ou scène sans occlueurs si politique produit le permet — **à tracer** dans quality / logs. |

**Traçabilité** : `metadata.integrationNotes`, `studyRef`, `generator`, `QualityBlock`, diagnostics — exploitables pour logs et UI « état technique » sans mentir sur la complétude.

---

## 10. Risques si ce contrat n’est pas respecté

- **Canonical flou** : chaque équipe interprète différemment les mêmes types.
- **Double vérité** : viewer ou CRM recalculent une géométrie parallèle.
- **Viewer trop intelligent** : bugs impossibles à reproduire (corrections cachées).
- **Shading fantôme** : KPI mélangés entre CRM et near 3D sans frontière.
- **Chemins d’exécution incohérents** : même étude, résultats différents selon l’entrée (flag, ordre des builders).

---

## 11. Conclusion officielle

Le canonical SolarNext doit être :

- **structuré** (DTO + builders + scène) ;
- **lisible** (types + ce document) ;
- **déterministe** (mêmes entrées → mêmes sorties, modulo floats documentés) ;
- **dégradable proprement** (shading absent, quality explicite) ;
- **non magique** (pas de comportement implicite non typé) ;
- **compatible** viewer, shading canonical, et produit **via contrats explicites**.

Ce document est la **référence contractuelle** du pipeline canonical pour les prompts suivants (adaptateur live, intégration produit).
