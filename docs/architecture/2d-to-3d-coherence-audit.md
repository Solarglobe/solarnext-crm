# Audit — cohérence 2D → 3D (Calpinage / canonical3d)

**Date :** 2026-04-02  
**Statut :** factuel (code dépôt), complété par la couche `validate2DTo3DCoherence`.

---

## 1. Pipeline actuel réel (ordre d’exécution)

### 1.1 Entrée runtime calpinage → scène canonique d’entrée

| Étape | Fichier(s) | Rôle |
|--------|------------|------|
| Assemblage pans / obstacles / panneaux posés + monde | `frontend/src/modules/calpinage/canonical3d/adapters/buildCanonicalScene3DInput.ts` | Lit `CALPINAGE_STATE` (ou injections), appelle `prepareCanonicalPans3DFromCalpinageState`, `prepareCanonicalObstacles3DFromCalpinageState`, charge panneaux via `mapCalpinageRoofToLegacyRoofGeometryInput` + `prepareCanonicalPlacedPanelsFromCalpinageState`. |
| Contrat monde strict | `frontend/src/modules/calpinage/canonical3d/world/normalizeWorldConfig.ts` | `metersPerPixel`, `northAngleDeg`, `referenceFrame: LOCAL_IMAGE_ENU` — pas de valeurs inventées. |
| Validation scène entrée | `frontend/src/modules/calpinage/canonical3d/validation/validateCanonicalScene3DInput.ts` | Bloque scène invalide (pans, obstacles, panneaux, monde) avant builders noyau. |

### 1.2 Toiture 3D (contour / legacy 2D → `RoofModel3D`)

| Étape | Fichier(s) | Rôle |
|--------|------------|------|
| Carte état toit → entrée géométrie legacy | `frontend/src/modules/calpinage/integration/mapCalpinageToCanonicalNearShading.ts` → `mapCalpinageRoofToLegacyRoofGeometryInput` | Produit `LegacyRoofGeometryInput` (pans, échelle, traits / ridges). |
| Construction modèle | `frontend/src/modules/calpinage/canonical3d/builder/buildRoofModel3DFromLegacyGeometry.ts` | Pans → patches planaires, normales, métadonnées `RoofModel3D`. |

**Où le contour 2D devient 3D :** dans la chaîne `LegacyRoofGeometryInput` → `buildRoofModel3DFromLegacyGeometry` (polygones image / monde horizontal → sommets monde, plans).

### 1.3 Pans « runtime » → pans 3D canoniques (voie adaptateur)

| Fichier | Rôle |
|---------|------|
| `frontend/src/modules/calpinage/integration/prepareCanonicalPans3D.ts` | Façade vers `buildCanonicalPans3DFromRuntime`. |
| `frontend/src/modules/calpinage/canonical3d/adapters/buildCanonicalPans3DFromRuntime.ts` | Pans 2D état → `CanonicalPan3D` (Z via heightResolver, monde via `imagePxToWorldHorizontalM`). |

Cette voie alimente **`CanonicalScene3DInput`**, pas directement `SolarScene3D` (qui consomme `RoofModel3D` issu du legacy mapper).

### 1.4 Obstacles → volumes 3D

| Fichier | Rôle |
|---------|------|
| `frontend/src/modules/calpinage/canonical3d/adapters/buildCanonicalObstacles3DFromRuntime.ts` | Obstacles runtime → `CanonicalObstacle3D`. |
| `frontend/src/modules/calpinage/canonical3d/buildSolarScene3DFromCalpinageRuntime.ts` → `canonicalObstaclesToVolumeInput` | Conversion vers entrées `buildRoofVolumes3D`. |
| `frontend/src/modules/calpinage/canonical3d/volumes/buildRoofVolumes3D.ts` | Prismes / maillages : `RoofObstacleVolume3D` / `RoofExtensionVolume3D`. |

**Changement de référentiel :** empreintes monde + extrusion (`vertical_world_z`, `along_pan_normal`, etc.) documentée sur les types volume.

### 1.5 Panneaux posés → surfaces PV 3D

| Fichier | Rôle |
|---------|------|
| `frontend/src/modules/calpinage/canonical3d/pvPanels/buildPvPanels3D.ts` | `PvPanelPlacementInput` + `roofPlanePatches` → `PvPanelSurface3D` (quads, `attachment`, grille). |

### 1.6 Agrégation scène produit

| Fichier | Rôle |
|---------|------|
| `frontend/src/modules/calpinage/canonical3d/scene/buildSolarScene3D.ts` | Assemble `SolarScene3D` (toiture, volumes, panneaux, optionnel shading). |
| **Cohérence 2D→3D** | `frontend/src/modules/calpinage/canonical3d/validation/validate2DTo3DCoherence.ts` | Appelée **une fois** sur la scène finale ; résultat dans `scene.coherence`. |

### 1.7 Point d’entrée runtime → produit

| Fichier | Rôle |
|---------|------|
| `frontend/src/modules/calpinage/canonical3d/buildSolarScene3DFromCalpinageRuntime.ts` | `validateCanonicalScene3DInput` → `buildRoofModel3DFromLegacyGeometry` → `buildRoofVolumes3D` → `buildPvPanels3D` → `buildSolarScene3D`. Retourne aussi `coherence` en surface. |

---

## 2. Risques de désalignement (constat code)

| Risque | Où ça peut naître |
|--------|-------------------|
| Double source toiture | `RoofModel3D` vient du **legacy mapper** ; les pans « canoniques » de l’adaptateur sont une **autre** représentation pour la même étude — risque de divergence si l’un évolue sans l’autre. |
| Perte / filtrage silencieux | `buildCanonicalScene3DInput` options `stripInvalidItems` / warnings — éléments retirés mais traçables via diagnostics **scène entrée**, pas recopiés dans `SolarScene3D` sous forme d’historique. |
| Z incohérent | Résolution hauteur pans / obstacles : `heightResolver` et diagnostics `baseZUnreliable` côté adaptateurs — la cohérence **globale** post-build est désormais dans `validate2DTo3DCoherence` (volumes / panneaux). |
| Panneau hors pan | `buildPvPanels3D` peut produire `attachment.kind === plane_patch_not_found` si incohérence — **ERROR** en cohérence finale. |
| Monde partiel | Géré par `normalizeWorldConfig` + `validateCanonicalScene3DInput` ; scène sans `worldConfig` : **WARNING** `WORLD_CONFIG_ABSENT` en cohérence. |

---

## 3. Trous de contrat / zones implicites

- **Contour 2D brut** : n’est pas stocké tel quel dans `SolarScene3D` — seule la **toiture résolue** (`RoofModel3D`) est présente. Pas de relecture directe du polygone dessiné dans la cohérence finale sans étendre les entrées.
- **« Shadow volumes »** : dans ce dépôt, les volumes d’ombrage proche sont les **volumes obstacle/extension** (`obstacleVolumes` / `extensionVolumes`). Pas de couche séparée nommée « shadow mesh » hors near-shading série.
- **Near shading** : séries optionnelles sur `SolarScene3D` — hors périmètre de la cohérence géométrique 2D→3D structurante (sauf dépendance indirecte via panneaux).

---

## 4. Décisions retenues (implémentation)

| Décision | Détail |
|----------|--------|
| Point de vérité cohérence **après** assemblage | `validate2DTo3DCoherence` sur `SolarScene3D` complète, attachée par `buildSolarScene3D`. |
| Tolérances | `canonical3d/validation/coherenceConstants.ts` — pas de constantes magiques dans le validateur. |
| `isCoherent` | `true` s’il n’y a **aucune** issue `ERROR` (les `WARNING` ne bloquent pas). |

---

## 5. Fichiers clés (navigation)

- Cohérence : `frontend/src/modules/calpinage/canonical3d/validation/validate2DTo3DCoherence.ts`
- Types : `frontend/src/modules/calpinage/canonical3d/types/scene2d3dCoherence.ts`
- Scène : `frontend/src/modules/calpinage/canonical3d/types/solarScene3d.ts` (`coherence?`, `sourceTrace?`)
- Trace source runtime : `frontend/src/modules/calpinage/canonical3d/sourceTrace/buildScene2DSourceTrace.ts`
- Seuils fidélité : `frontend/src/modules/calpinage/canonical3d/validation/fidelityConstants.ts`

**Complément (Prompt 10-bis)** : `docs/architecture/2d-to-3d-fidelity-trace.md` — trace 2D, fidélité globale, `confidence`.
