# AUDIT COMPLET SYSTÈME CALPINAGE SOLARNEXT
## Phase 2 · Phase 3 · Moteur 3D · UX · Shading · Rendering · Workflow
**Date :** 16 mai 2026  
**Périmètre :** Frontend (82 900 lignes TS/TSX module calpinage) + Backend Express + Pipeline PDF  
**Référentiel cible :** SaaS premium niveau CAD / démonstration client haut de gamme

---

## TABLE DES MATIÈRES

1. [Architecture Globale](#1-architecture-globale)
2. [UX et Workflow Utilisateur](#2-ux-et-workflow-utilisateur)
3. [Rendu 3D (Three.js / R3F)](#3-rendu-3d-threejs--r3f)
4. [Workflow Métier Photovoltaïque](#4-workflow-métier-photovoltaïque)
5. [Performance](#5-performance)
6. [Shading (Ombrage)](#6-shading-ombrage)
7. [Géométrie et Topologie](#7-géométrie-et-topologie)
8. [Mobile](#8-mobile)
9. [Visual Polish](#9-visual-polish)
10. [Export JSON, Persistence, Cohérence Frontend/Backend](#10-export-json-persistence-cohérence-frontendbackend)
11. [Pipeline PDF](#11-pipeline-pdf)
12. [Tests](#12-tests)
13. [ROADMAP PRIORISÉE](#13-roadmap-priorisée)
14. [Propositions Simplification UX](#14-propositions-simplification-ux)
15. [Propositions Amélioration Visuelle Premium](#15-propositions-amélioration-visuelle-premium)
16. [Architecture Cible Long Terme](#16-architecture-cible-long-terme)

---

## 1. ARCHITECTURE GLOBALE

### 1.1 Vue d'ensemble structurelle

Le module calpinage repose sur **trois couches hétérogènes qui coexistent** sans unification :

```
┌─────────────────────────────────────────────────────────┐
│  CalpinageApp.tsx (orchestrateur React)                  │
│  ┌──────────────────┐  ┌────────────────────────────┐   │
│  │ calpinage.module  │  │  canonical3d/ (TypeScript) │   │
│  │ .js (22 637 L)   │  │  ~200 fichiers, flag OFF    │   │
│  │ IIFE, DOM, global│  │  en production              │   │
│  └──────────────────┘  └────────────────────────────┘   │
│  ┌──────────────────────────────────────────────────┐   │
│  │  Zustand store (bridge) + window.CALPINAGE_STATE  │   │
│  └──────────────────────────────────────────────────┘   │
└─────────────────────────────────────────────────────────┘
```

Le legacy IIFE (`calpinage.module.js`, 22 637 lignes) reste le moteur de vérité 2D. Le système TypeScript canonical3D (~200 fichiers) est le système cible — mais il est **désactivé en production** (`VITE_CALPINAGE_CANONICAL_3D=off` par défaut). Tout le pipeline 3D est dans le bundle mais jamais exécuté en production.

### 1.2 Problèmes d'architecture critiques

#### A. `window` comme bus de communication universel (~10 globals actifs)
```typescript
// CalpinageApp.tsx — déclaration inline ad hoc
type W = Window & { 
  __CALPINAGE_3D_VERTEX_XY_EDIT__: boolean
  __CALPINAGE_3D_RIDGE_HEIGHT_EDIT__: boolean
  __CALPINAGE_3D_PV_LAYOUT_MODE__: boolean
  __CALPINAGE_KONVA__: boolean
  __SOLARNEXT_GET_UI_SHADING_SNAPSHOT__: () => unknown  // exposé en PRODUCTION
  __CALPINAGE_ROOF_Z_TELEMETRY_PING__: () => unknown    // exposé en PRODUCTION
  ...
}
```
**Impact :** couplage invisible, non testable, non typé à la source. Les deux derniers sont des APIs de debug exposées en production.

#### B. Double sources de vérité — tableau de synthèse

| Donnée | Source 1 | Source 2 | Risque |
|--------|----------|----------|--------|
| État runtime calpinage | `window.CALPINAGE_STATE` | Store Zustand | Désync silencieuse |
| Pans de toiture | `state.pans` | `roof.roofPans` (miroir) | Divergence si sync échoue |
| Near shading | Legacy (`nearShadingCore.cjs`) | Canonical 3D TS (flag) | UI ≠ étude stockée |
| Bundles JS | `public/calpinage/` | `frontend/calpinage/` (racine) | Version indéterminée |
| Feature flags | `window.__CALPINAGE_*__` | `import.meta.env.VITE_*` | Conflits non détectables |
| Hash intégrité | FNV-1a 32 bits (frontend) | SHA-256 (backend) | Périmètres différents |
| Calcul kWc | Calculé UI | Revalidé backend | Divergence silencieuse |

#### C. `CalpinageApp.tsx` — orchestrateur trop responsable
- Gère lifecycle, feature flags, télémétrie, store bootstrap, globals de debug
- `retryRequestedRef / initInFlightRef / hasInitializedRef` : 3 refs mutuelles pour la concurrence d'init — fragile
- Dépendance d'ordre implicite `bootstrapCalpinageStore()` appelé APRÈS `initCalpinage` sans garantie type-system
- `console.error` non conditionné `DEV` à la ligne 186 — part en production

#### D. Feature flags zombies
- `__CALPINAGE_3D_VERTEX_XY_EDIT__` : OFF, UI "pas câblée même si ON"
- `__CALPINAGE_3D_RIDGE_HEIGHT_EDIT__` : OFF, controller existe sans UI
- `__CALPINAGE_3D_PV_LAYOUT_MODE__` : OFF en prod, drag controller présent
- `__CALPINAGE_CANONICAL_3D__` : OFF en prod, ~200 fichiers bundlés inutilement
- `window.__CALPINAGE_CANONICAL_3D__` : listé comme "à supprimer" dans ARCHITECTURE_REFONTE mais toujours supporté dans `featureFlags.ts`

#### E. Pipeline 3D canonical complet désactivé en production
~200 fichiers TypeScript du dossier `canonical3d/` sont dans le bundle final mais `VITE_CALPINAGE_CANONICAL_3D` est `off`. Charge de bundle inutile + risque de bit rot sur du code jamais exécuté. Le rapport d'autopsie de février 2025 + les steps du TECH_DEBT couvrent surtout le backend. Le cœur calpinage (schéma canonique, store Zustand cible, render2D React) reste non implémenté.

#### F. Branches emergency/fallback silencieuses
Trois branches de construction de scène coexistent (officielle, emergency, fallback maison plate) sans badge UI. L'utilisateur voit la même interface quelle que soit la branche active. Les diagnostics qualité produits (`roofReconstructionQuality`, `pvBindingDiagnostics`, `SceneSyncDiagnostics`, `validate2DTo3DCoherence`) ne remontent jamais en UI.

---

## 2. UX ET WORKFLOW UTILISATEUR

### 2.1 Anomalies critiques de l'interface

#### A. Violation des règles des Hooks React dans `ConfirmDialog`
```tsx
// ConfirmDialog.tsx — BUG CRITIQUE
if (!open) return null;
const submittedRef = useRef(false);  // ← hook après return conditionnel
```
Nombre d'appels de hooks variable selon la valeur de `open`. Cette violation fondamentale peut provoquer des comportements imprévisibles à l'usage intensif (éditions rapides).

#### B. Action de validation principale — échec silencieux possible
```tsx
// Phase2Actions.tsx
document.getElementById("btn-validate-roof")?.click();
// Si le bouton n'est pas dans le DOM → action ignorée sans retour utilisateur
```
L'action la plus critique du module (validation du contour toiture) peut échouer silencieusement à cause d'une race condition au montage.

#### C. Doublon de montage Phase3ChecklistPanel non documenté
`Phase3ChecklistBridge` et `Phase3Sidebar` montent tous deux `Phase3ChecklistPanel`. Si les deux sont actifs simultanément, la checklist est rendue deux fois avec deux instances React lisant les mêmes données `window`.

#### D. `Phase3Sidebar.tsx` tronqué sur disque
Le fichier est physiquement tronqué (22 369 octets, se termine sur `validateHintId=`). La `ZONE 5 — Outils` (DsmOverlayButton, DsmPdfExportButton) est absente du filesystem. Toute modification du fichier depuis le filesystem produirait un fichier incomplet.

### 2.2 Problèmes UX majeurs

#### E. Deux systèmes de toast actifs simultanément
`DsmPdfExportButton` dans Phase3Sidebar crée un toast `div` en dur (`z-index:99999`) au lieu d'utiliser le `ToastProvider` existant. Double système de notification dans le même composant parent.

#### F. `usePhase3ChecklistData` — bypass total de l'architecture
Bypasse le store Zustand en lisant directement `window.getPhase3ChecklistData()` avec un `setInterval(400ms)` permanent. Ce polling fonctionne en parallèle avec l'événement `"phase3:update"` — double rafraîchissement, même quand la sidebar est cachée.

#### G. Bouton "Supprimer" obstacle sans confirmation
Action destructive immédiate dans la sidebar. Un `ConfirmDialog` existe dans `/ui/` mais n'est pas utilisé ici.

#### H. Incohérence d'unité m/cm non communiquée
Pour les obstacles de type keepout, `planHeightM` s'affiche en centimètres. Pour les éléments ombrants, en mètres. Le label et l'unité changent silencieusement — risque d'erreur de saisie de deux ordres de grandeur.

#### I. `globalStatusLabel` — heuristique fragile sur le texte
```js
// Phase3Sidebar
h.includes("ratio") || h.includes("DC/AC")  // parsing de string pour déduire le status
```
Si un message est reformulé, le statut bascule silencieusement entre "Bloqué" et "Incomplet".

#### J. Autres problèmes UX identifiés
- `Phase2StateBlock` : items "Échelle auto" et "Nord auto" sans valeur réelle affichée
- `Phase3AutofillSection` : bouton "Confirmer" grisé sans explication
- `ConfirmDialog` : titre hardcodé "⚠️ Action importante", emoji non modulable, scale au hover
- `ToastProvider` : pas de bouton fermer (×), pas d'animation de sortie, incompatible mobile
- `Phase2PansBlock` : DOM legacy peuplé impérativement, réordonné par CSS nth-child (`order:10`) — fragile
- `DsmOverlayButton` dans Phase3Sidebar peut doubler `DsmOverlayBridge` dans la topbar legacy

### 2.3 Accessibilité

| Composant | Problème |
|-----------|----------|
| `ConfirmDialog` | Pas de focus trap, pas de focus automatique au montage |
| `Phase3Sidebar` | Chaine de fallbacks DOM `getElementById` pour changer l'outil actif |
| `ToastProvider` | Indismissable sans souris sur mobile (`onMouseEnter/Leave` seulement) |
| `Phase2ObstaclePanel` | Bouton "Supprimer" sans `aria-label` décrivant l'élément cible |
| Konva Stage | `listening=true` mais `pointer-events:none` — opaque pour les AT |

---

## 3. RENDU 3D (THREE.JS / R3F)

### 3.1 Qualité rendering — état actuel vs niveau premium

**Points positifs :**
- `meshStandardMaterial` PBR sur tous les maillages (metalness/roughness explicites)
- Ombres activées (`castShadow`/`receiveShadow`) avec biais centralisés
- `polygonOffset` correctement utilisé pour éviter le z-fighting
- Matériaux vitrage avec `depthWrite: false` correct
- Thème `SOLARNEXT_3D_PREMIUM_THEME` centralisé dans `viewerVisualTokens`
- Obstacles avec géométries de détail procédurales (briques, VMC, antenne)
- Grille PV avec busbars et glow émissif

**Manques critiques pour un niveau premium :**

#### A. Aucune instanciation des panneaux PV — problème de performance majeur
```tsx
// SolarScene3DViewer.tsx — anti-pattern
panelGeos.map((geo) => (
  <mesh key={geo.id}>
    <meshStandardMaterial roughness={0.3} metalness={0.05} ... /> // ← nouvelle instance
  </mesh>
))
```
Chaque panneau crée son propre draw call. Sur un toit dense (100+ panneaux), performance linéaire en N. `InstancedMesh` ou matériaux partagés via `useMemo` obligatoire pour un rendu premium.

#### B. Aucun postprocessing
Pas de FXAA/SMAA (antialiasing), pas de Bloom sur l'émissivité PV, pas de SSAO. Le rendu est techniquement propre mais flat — un logiciel PV premium (Suneye, Aurora Solar, PVsyst 3D) utilise systématiquement le Bloom pour les surfaces solaires.

#### C. Aucune IBL / environment map
Deux directional + hemisphère suffisent pour la lisibilité technique mais n'offrent pas la richesse d'un HDRI. Les matériaux métalliques (antenne, châssis) restent ternes.

#### D. Fuite mémoire GPU dans `DebugXYAlignmentOverlay`
```tsx
// DebugXYAlignmentOverlay.tsx
const redGeo = useMemo(() => new THREE.BufferGeometry(...), [scene]);
// ← AUCUN useEffect de cleanup → fuite mémoire GPU à chaque recalcul de scène
```

#### E. `console.warn` inconditionnel dans `DebugXYAlignmentOverlay`
```tsx
console.warn("[XY OVERLAY — CAS RÉEL]", verdictObj);  // ← pas de garde import.meta.env.DEV
```
Émis en production si `showXYAlignmentOverlay` est activé via `window.__CALPINAGE_3D_XY_OVERLAY__`.

#### F. Prop `_showCameraViewModeToggle` déclarée mais non implémentée
Le toggle UI caméra existe dans l'API du composant mais ne rend rien — feature zombie.

#### G. Géométries keepout hardcodées `null`
```typescript
keepoutHatch: null,       // ← délibérément absent
keepoutCornerMarks: null, // ← délibérément absent
```
Sans TODO, sans ticket. Les zones keepout n'ont aucune représentation visuelle dans la vue 3D.

#### H. `demoSolarScene3d.ts` importe des factories de test en production
```typescript
import { hardeningSceneFactories } from '../__tests__/hardening/hardeningSceneFactories';
// ← code de test bundlé en production
```

#### I. Aucune animation de transition caméra
Passage PLAN_2D ↔ SCENE_3D instantané. Un `lerp` de position caméra sur 300ms serait attendu en UX premium.

#### J. `SolarScene3DViewer.tsx` — 4 216 lignes
Le composant le plus gros de la codebase. Logique de picking (~80 lignes conditionnelles dans `onRoofMeshClick`) mélange 5 modes (inspect, panSelection3D, pvLayout3D, vertexZEdit, ridgeHeightEdit) sans machine d'états explicite.

#### K. `linewidth` ignoré par WebGL
```tsx
<lineBasicMaterial linewidth={3} /> // ← toujours 1px en WebGL
```
Toutes les lignes d'overlay seront à 1px quelle que soit la valeur. Utiliser `Line2` de `@react-three/drei` pour les lignes épaisses.

### 3.2 Autres problèmes de rendering

- Projection satellite sur les pans via `emissiveMap` — fonctionnel mais une `meshBasicMaterial` serait plus propre
- `useFrame` sans throttle dans `RoofTruthBadgesProjector` et `PvLayout3dScreenOverlayProjector` — `.project(camera)` + `getBoundingClientRect()` appelés à 60fps pour tous les pans
- Mode caméra PLAN_2D avec `PerspectiveCamera` (quasi-zénithale) au lieu d'orthographique vrai — biais de parallaxe présent
- `loggedOnce` module-level dans `featureFlags.ts` — état mutable global non réinitialisé entre suites de tests

---

## 4. WORKFLOW MÉTIER PHOTOVOLTAÏQUE

### 4.1 Bug fondamental : toiture rendue plate (Z=0)

```typescript
// heightInterpolator.ts
private static readonly RUNTIME_FALLBACK = { heightM: 0, reliable: false };
```
Si `getCalpinageRuntime()?.getHeightAtXY()` n'est pas disponible, tous les coins des pans reçoivent Z=0 → toiture entièrement plate. Aucun diagnostic n'interrompt le pipeline. Le rendu 3D affiche une toiture plate (au niveau de la mer) au lieu de la toiture réelle. C'est le bug documenté dans `project_calpinage_3d.md`.

### 4.2 Divergence grille de sampling near shading 4×4 vs 3×3 backend

```typescript
// buildPvPanels3D.ts — défaut frontend
const DEFAULT_SAMPLING = { nx: 4, ny: 4 }; // 16 points

// backend nearShadingCore.cjs
GRID_SIZE: 3  // 9 points
```
La divergence est documentée mais jamais corrigée. Le near shading frontend produit des valeurs différentes du backend pour chaque panneau.

### 4.3 `applyStructuralHeightEdit` — paramètre `runtime` ignoré

```typescript
export function applyStructuralHeightEdit(
  _runtime: unknown,   // ← underscore = délibérément ignoré
  edit: StructuralHeightEdit,
): ApplyStructuralHeightEditResult {
  window.__calpinageApplyStructuralHeightSelection(...)  // ← mutation directe window
```
Les éditions structurelles (contour/faîtage/trait) court-circuitent la chaîne normale. L'historique undo/redo est incomplet pour ces éditions.

### 4.4 `catalogModuleSelected = true` par défaut dans la checklist

Si la prop n'est pas fournie, le composant affiche "Sélectionné" même sans module catalogue. Masque un état invalide en production si un appelant oublie la prop.

### 4.5 7/11 actions 2D absentes en vue 3D

Selon le RAPPORT_AUDIT_CALPINAGE_3D (confirmé par les feature flags zombies) :
- Ajout/suppression obstacle : non synchronisé en 3D
- Déplacement obstacle : non synchronisé
- Resize obstacle : non synchronisé
- Edition contour bâtiment : non reflété
- Ajout/suppression keepout : non visible (keepoutHatch/Marks = null)
- Edition traits/mesures : non reflété

### 4.6 Plans quasi-verticaux non supportés

```typescript
// solveRoofPlanes.ts
"PLANE_NEAR_VERTICAL_UNSUPPORTED_V1"  // lucarnes verticales, pignons hauts, murs
```
Retour null, aucun panneau 3D généré, aucun message utilisateur.

### 4.7 Undo/redo hors store — non persisté

`roofModelingHistory.ts` maintient `undoStack/redoStack` comme variables de module JS (pas dans Zustand, pas persistées). Stacks non réinitialisés entre sessions si `CalpinageApp` est démonté/remonté. Fonctionnalité undo/redo présentée comme acquise mais architecturalement instable.

### 4.8 Validation métier

- Ratio DC/AC : bloquant pour onduleur CENTRAL, indicatif pour MICRO — comportement correct mais l'UI ne distingue pas clairement ces deux régimes
- `classifyCalpinageDataIntegrity.js` : **bug logique** — tout document `CALPINAGE_V2` est classifié `LEGACY` (condition `version === "CALPINAGE_V1"` pour `hasMeta` ne couvre jamais V2)
- `shadingValid` V2 ignoré par `classifyShading` — un shading invalide en V2 n'est pas signalé comme STALE

---

## 5. PERFORMANCE

### 5.1 Bundle Three.js non lazy-loadé — impact critique

`three@^0.183.2` + `@react-three/fiber` + `@react-three/drei` (~800KB–1.2MB) chargés dans le bundle principal pour 100% des utilisateurs CRM. Aucun `React.lazy()` dans `CalpinageApp.tsx`, aucun `manualChunks` dans `vite.config.ts`.

**Impact mesurable :** TTI (Time to Interactive) dégradé de plusieurs secondes pour les commerciaux/admins qui n'ouvrent jamais le module 3D.

### 5.2 Fichiers les plus gros — candidats à la décomposition

| Fichier | Lignes | Action |
|---------|--------|--------|
| `SolarScene3DViewer.tsx` | 4 216 | Décomposer en ~5 sous-composants |
| `Inline3DViewerBridge.tsx` | 1 108 | Extraire la logique d'état |
| `SceneInspectionPanel3D.tsx` | 996 | Extraire les sections |
| `buildRoofModel3DFromLegacyGeometry.ts` | 940 | Refactoriser par responsabilité |
| `parseCalpinageStateToCanonicalHouse3D.ts` | 1 017 | Découper en parseurs spécialisés |
| `calc.controller.js` (backend) | 1 867 | Découper en services injectables |

### 5.3 Absence de BVH pour le raycast shading

```typescript
// volumeRaycast.ts
// O(volumes × faces × triangles) par rayon — sans kd-tree ni octree
for (const vol of volumes) {
  for (const face of vol.faces) {
    for (const tri of fanTriangulate(face)) {
      rayTriangleIntersect(ray, tri);  // ← O(N) brute force
    }
  }
}
```
Pour 50 obstacles × 4000 vecteurs solaires × 200 panneaux × 16 points de grille = **6,4 milliards de tests** dans le pire cas. Un BVH réduirait à O(log N).

### 5.4 Pool PostgreSQL sans configuration

```javascript
export const pool = new Pool({ connectionString: getConnectionString() });
// max: 10 par défaut, statement_timeout absent
```
Sous charge concurrent, pool exhaustion possible sans monitoring.

### 5.5 Coexistence Puppeteer + Playwright en backend

~600MB de Chromium dupliqués dans le même processus backend. Risque de timeout au déploiement Railway.

### 5.6 Polling permanent 400ms

`usePhase3ChecklistData` — `setInterval(refresh, 400ms)` actif même quand la sidebar est cachée. Coexiste avec l'événement `"phase3:update"` qui fait la même chose.

### 5.7 `usePhase3Data` — re-render complet sur tout changement phase3

```typescript
const raw = useCalpinageStore((s) => s.phase3); // sélecteur sur tout l'objet
return useMemo(() => { ... }, [raw]);
// Si l'adapter recrée un nouvel objet phase3 à chaque event, useMemo recalcule systématiquement
```

### 5.8 Allocations à chaque raycast

`positionsFromVolumeVertices` alloue un tableau à chaque rayon × volume au lieu de pré-calculer les positions au moment de la construction de scène.

---

## 6. SHADING (OMBRAGE)

### 6.1 Near shading UI peut diverger du near étude stockée

Quand `VITE_CANONICAL_3D_NEAR_SHADING=true`, le near affiché en UI provient du moteur canonical 3D TypeScript (4×4 grid). Le near stocké dans l'étude et utilisé pour le PDF provient du moteur backend (`nearShadingCore.cjs`, 3×3 grid). Aucune alerte visible à l'utilisateur si les deux valeurs divergent.

**Risque métier :** un commercial vend une installation sur la base d'une perte near UI de 3%, alors que l'étude backend en calcule 8%. Sans réconciliation explicite, la divergence est invisible.

### 6.2 `window.nearShadingCore` — dépendance fragile

```javascript
// nearShadingWrapper.ts
const ENG = window.nearShadingCore;
if (!ENG) return { near: 0 }; // ← retourne ZÉRO si le script n'est pas chargé
```
Perte near = 0 (zéro) si le bundle shading n'est pas chargé — l'erreur la plus dangereuse car elle fait paraître le site sans ombrage.

### 6.3 `getAnnualSunVectors` — non garanti

```typescript
const sunVectors = calpinageRuntime.getAnnualSunVectors?.()
  ?? window.getAnnualSunVectors?.();
// Si les deux sont undefined → SKIPPED, near = null
```
Fallback silencieux : le near canonical n'est tout simplement pas calculé.

### 6.4 Pondération solaire approximative

`nearShadingHorizonWeighted.ts` pondère par `w = max(0, dz)` (cosinus de l'angle zénithal). La pondération exacte pour un panneau incliné serait `max(0, dot(dir, panelNormal))`. L'approximation est documentée mais introduit un biais systématique sur les pans à forte inclinaison.

### 6.5 Triangulation fan pour volumes concaves

`triangulateFace.ts` utilise une triangulation éventail depuis l'indice 0. Pour des obstacles polygonaux non convexes, la triangulation est incorrecte → des rayons solaires passent à travers des parties concaves du volume.

### 6.6 `VALID_CONFIDENCE`/`VALID_SOURCE` déclarés mais jamais utilisés pour valider

```javascript
// buildShadingExport.js
export const VALID_CONFIDENCE = ["HIGH", "MEDIUM", "LOW", "UNKNOWN"];
// ... mais jamais vérifiés sur la sortie effective
out.confidence = normalized.shadingQuality?.confidence ?? "UNKNOWN";
// ← peut être n'importe quelle valeur
```

### 6.7 Fallback near : 0 affiché sans alerte

Si le fallback se déclenche (`NO_ROOF_STATE`, `PERF_BUDGET_EXCEEDED`, etc.), `fallbackTriggered: true` dans l'objet interne mais aucune alerte produit visible. L'utilisateur voit 0% de perte near sans comprendre pourquoi.

---

## 7. GÉOMÉTRIE ET TOPOLOGIE

### 7.1 Centroïde arithmétique incorrect pour les polygones non convexes

```typescript
// geoEntity3D.ts
computeCentroidPx(pts: Point2D[]): Point2D {
  return { x: mean(pts.map(p => p.x)), y: mean(pts.map(p => p.y)) };
  // ← barycentre de SOMMETS, pas barycentre de SURFACE
}
```
Pour un obstacle en L ou un pan avec des indentations, la résolution de hauteur (`getBaseZWorldM`) est faite au mauvais point.

### 7.2 `metersPerPixel` non propagé dans les shadow_volumes

Dans `normalizeCalpinageGeometry3DReady`, le `mpp` n'est pas injecté dans chaque entité shadow_volume. La conversion pixels→mètres utilise `e.metersPerPixel ?? 1` — le volume d'ombrage est incorrect d'un facteur ~100 si `mpp ≈ 0.1 m/px`.

### 7.3 Convention de résolution Z incohérente dans `shellContourLocalRoofZ.ts`

Deux conventions coexistent dans le même fichier :
- `resolveRoofPlaneZAtXYFromPatches` : évalue Z au point query (x,y)
- `resolveShellContourVertexWorldXYAndZ` : évalue Z au point projeté sur le bord

Les appelants doivent choisir la bonne — risk de confusion.

### 7.4 Plans quasi-verticaux non supportés

```typescript
// solveRoofPlanes.ts
if (nz < EPS_Z_DENOM) return { kind: "PLANE_NEAR_VERTICAL_UNSUPPORTED_V1" };
```
Lucarnes verticales, pignons hauts, panneaux en façade — tous non supportés. Aucun message utilisateur.

### 7.5 Seuil de cluster Z trop petit

`FOOTPRINT_ON_EDGE_EPS2 = (1e-9)²` → tolérance de 1 nm pour des coordonnées en mètres. Erreur de représentation flottante fera échouer systématiquement ce test de bord.

### 7.6 Recherches linéaires sans cache dans le pipeline solveur

`solveRoofPlanes.ts` : `document.roof.topology.vertices.find(...)` à chaque résolution de hauteur → O(N) sans Map pré-construite.

### 7.7 Toit plat — axes arbitraires

Quand `tilt ≈ 0°`, `slopeAxisWorld` → NORTH et `azimuthDeg` → convention Sud. Ces fallbacks sont documentés mais peuvent induire des erreurs de placement si le moteur utilise ces axes comme référence d'orientation pour les panneaux.

---

## 8. MOBILE

### 8.1 Aucune adaptation mobile du viewer 3D

Le `SolarScene3DViewer` n'a aucune détection de breakpoint. Les `OrbitControls` gèrent le touch nativement mais sans optimisation multi-doigt. Le pinch-zoom n'a pas d'UX adaptée.

### 8.2 Overlay inspection 86% de largeur sur phone 380px

`width: "min(320px, 42vw)"` → 320px sur desktop mais **~160px** sur un phone 380px. Trop étroit pour être utilisable. Sur desktop 1280px, 42vw = 537px → dépasse le max de 320px donc cap à 320px. Fonctionnel desktop uniquement.

### 8.3 Badges RoofTruth à taille fixe

Tailles hardcodées (22px badge, 10px font) non adaptées au mobile. Trop petits pour être touchables.

### 8.4 `ToastProvider` sans dismiss sur mobile

`onMouseEnter/Leave` pour suspendre le timer — inexistant sur tactile. Les toasts ne sont pas dismissables manuellement sur mobile.

### 8.5 Aucun test Playwright sur viewport mobile

Les tests de régression visuelle existent en desktop uniquement. Le viewport mobile n'est pas couvert.

---

## 9. VISUAL POLISH

### 9.1 Deux espaces de noms CSS incohérents

`Phase2Sidebar.module.css` utilise `--sg-brand`, `--sg-text`, `--sg-border` (tokens SolarGlobe préfixés).
`Phase3Sidebar.module.css` utilise `--brand-accent`, `--text`, `--color-bg-page` (non préfixés).
Si les valeurs diffèrent en runtime, les deux sidebars adjacentes auront des couleurs légèrement différentes.

### 9.2 Border-radius incohérents

| Composant | Valeur utilisée |
|-----------|-----------------|
| Phase2Sidebar cards | `10px` |
| Phase3Sidebar boutons primaires | `10px` |
| Phase3Sidebar boutons secondaires | `8px` |
| ConfirmDialog card | `14px` |
| ConfirmDialog boutons | `12px` |
| Phase2ObstaclePanel | `var(--sg-radius-md, 12px)` / `var(--sg-radius-sm, 8px)` |

Aucune source de vérité pour le radius global.

### 9.3 Dark mode incomplet

Phase2Sidebar et Phase3Sidebar ont des sections dark mode complètes. **Absent sur :** `Phase2ObstaclePanel`, `ConfirmDialog`, `Toast`. Le `ConfirmDialog` a un fond dark hardcodé (`rgba(20,22,30,0.95)`) — invisible en light mode.

### 9.4 Couleur de succès non standard

```css
/* Toast.module.css */
.toastSuccess { border-left-color: #6366F1; } /* ← indigo brand, pas vert */
```
Convention success=vert non respectée. Confusion avec les toasts d'information.

### 9.5 Typo dans l'interface

`ShadingLegend3D.tsx` : "Resultat ombrage" (sans accent sur le é).

### 9.6 Scale hover sur ConfirmDialog

`.card:hover { transform: scale(1.02) }` — une fenêtre modale ne devrait pas bouger quand on la survole.

### 9.7 Éléments debug visibles si flags activés en production

- Toiture magenta `#ff00ff` si `window.__CALPINAGE_3D_AUTOPSY_COLORS__` (conditionné DEV mais variable window = activable)
- Overlay XY vert/rouge/cyan si `window.__CALPINAGE_3D_XY_OVERLAY__`
- `DebugStatsOverlay` (fond noir, texte monospace) si `showDebugOverlay`
- `DebugXYAlignmentOverlay.tsx` : `console.warn("[XY OVERLAY — CAS RÉEL]")` inconditionnel si activé

---

## 10. EXPORT JSON, PERSISTENCE, COHÉRENCE FRONTEND/BACKEND

### 10.1 Bug critique : `classifyCalpinageDataIntegrity` classe tout document V2 comme LEGACY

```javascript
// classifyCalpinageDataIntegrity.js
hasMeta: data?.calpinage_meta?.version === "CALPINAGE_V1"
// ← La condition ne couvre jamais CALPINAGE_V2
// → Tout document V2 = hasMeta:false = dataLevel:LEGACY
```
Conséquence : les études V2 sont traitées comme des données legacy partout où `classifyCalpinageDataIntegrity` est consommé — reload, validation, diagnostics.

### 10.2 `setCalpinageItem` sans try/catch QuotaExceeded

```typescript
// calpinageStorage.ts
export function setCalpinageItem(key, value) {
  localStorage.setItem(scopedKey, JSON.stringify(value));
  // ← pas de try/catch QuotaExceededError
}
```
En navigateur privé (quota réduit) ou stockage plein : sauvegarde silencieuse perdue.

### 10.3 Hash système incompatibles frontend/backend

Frontend : FNV-1a 32 bits sur `{map, scale, roof, gps, contoursBati, traits, mesures, ridges, planes, obstacles, image}`.
Backend : SHA-256 sur `{roofState, validatedRoofData, frozenBlocks, pvParams, panels, obstacles, gps}`.

Ces hashes couvrent des périmètres différents. Un changement de `traits` n'est pas détecté par le hash backend. Un changement de `validatedRoofData` n'est pas détecté par le hash frontend.

### 10.4 Calculs métier dupliqués frontend/backend sans synchronisation

`getOfficialGlobalShadingLossPct` et `officialShadingTruth.js` backend implémentent la même logique sans mécanisme de synchronisation. `pdfViewModel.mapper.js` duplique une partie de `financeService.js` — risque de drift financier entre rapport PDF et scénario calculé.

### 10.5 Timestamp `computedAt` synthétisé incorrectement

```javascript
out.computedAt = normalized.computedAt ?? new Date().toISOString();
// Si absent → timestamp d'export ≠ date du calcul réel
```

### 10.6 Absence de Zod dans la chaîne d'export shading

Aucune validation structurelle de l'export ni du ViewModel PDF. Un champ renommé crèche silencieusement une page PDF.

---

## 11. PIPELINE PDF

### 11.1 Deux runtimes PDF coexistent sans contrat clair

`PdfLegacyPort` (production via `StudySnapshotPdfPage`) et `FullReport` (potentiellement orphelin). Les pages P4 et P7 ont deux implémentations dans des dossiers différents sans source de vérité documentée.

### 11.2 `layout_snapshot` absent → P3b vide sans alerte

Si le calpinage n'a pas été validé et que le snapshot n'existe pas, la page P3b (présentation calpinage) est silencieusement vide dans le PDF. Aucun avertissement utilisateur.

### 11.3 Exception non catchée dans `useLegacyPdfEngine`

```typescript
// useLegacyPdfEngine.ts
const vm = buildLegacyPdfViewModel(fr); // ← lance Error si fullReport absent
// Pas de try/catch → erreur React non rendue
```

### 11.4 `renderToken` — risque de fuite

Deux chemins d'authentification pour le PDF (renderToken interne vs JWT CRM). Une fuite de `renderToken` permet l'accès sans JWT.

### 11.5 Engines legacy bindés via `window.API.bindEngineP*`

Si un engine n'est pas chargé, `?.()` avale l'erreur silencieusement — page PDF vide sans diagnostic.

---

## 12. TESTS

### 12.1 Forces

- 164 tests backend avec Node.js test runner (calpinage, shading, batterie, finance)
- 13 specs Playwright (stabilité, e2e, régression visuelle, performance avec seuils mesurés)
- Tests de hardening canoniques extensifs (physique, robustesse, régression snapshot)
- Tests unitaires complets sur les modules géométriques

### 12.2 Lacunes critiques

- **Aucun test unitaire des contrôleurs** (ni `calc.controller`, ni les contrôleurs de domaine)
- **Aucune mesure de couverture** (pas de c8/nyc/Istanbul configuré)
- **Tests d'intégration backend nécessitent une DB live** — fragile en CI
- **Aucun test Playwright sur viewport mobile**
- **`calpinage.module.js` non testable unitairement** (22 637 lignes, état global, couplage DOM)
- **Scripts de test manuels (~40 fichiers `test-*.js`)** dans `scripts/` non automatisés

---

## 13. ROADMAP PRIORISÉE

### 🔴 CRITIQUE — Blocage démo / risque data / bug production

| # | Problème | Fichier | Impact |
|---|----------|---------|--------|
| C1 | Bug Z=0 : toiture rendue plate si runtime legacy non monté | `heightInterpolator.ts` | Rendu 3D complètement incorrect |
| C2 | `classifyCalpinageDataIntegrity` classe tout V2 comme LEGACY | `classifyCalpinageDataIntegrity.js` | Études V2 retraitées en legacy partout |
| C3 | Violation règle des Hooks React dans `ConfirmDialog` (`useRef` après return conditionnel) | `ConfirmDialog.tsx` | Comportement imprévisible à l'usage intensif |
| C4 | Action validation toiture peut échouer silencieusement | `Phase2Actions.tsx` | L'action principale du module échoue sans retour |
| C5 | `Phase3Sidebar.tsx` tronqué sur disque | `Phase3Sidebar.tsx` | Fichier corrompu — Zone 5 absente |
| C6 | Fuite mémoire GPU : BufferGeometry non disposées | `DebugXYAlignmentOverlay.tsx` | Fuite progressive sur sessions longues |
| C7 | Near shading UI peut diverger du near étude sans alerte | `nearShadingOfficialSelection.ts` | Risque commercial (perte vendée différente de réelle) |
| C8 | `InstancedMesh` absent : N draw calls = N panneaux | `SolarScene3DViewer.tsx` | Performance critique 100+ panneaux |
| C9 | `demoSolarScene3d.ts` importe factories de test en prod | `demoSolarScene3d.ts` | Bundle pollué, code de test en production |
| C10 | `calc.controller.js` — 1867 lignes, 1 export, non testable | Backend | Point de défaillance unique moteur PV |

### 🟠 IMPORTANT — Qualité produit dégradée / dette visible

| # | Problème | Fichier | Impact |
|---|----------|---------|--------|
| I1 | Three.js non lazy-loadé (+800KB–1.2MB bundle initial) | `vite.config.ts` + `CalpinageApp.tsx` | TTI dégradé pour tous les utilisateurs |
| I2 | Aucune instanciation matériaux partagés | `SolarScene3DViewer.tsx` | Re-renders potentiellement coûteux |
| I3 | Doublon `Phase3ChecklistBridge` + `Phase3Sidebar` non documenté | `Phase3ChecklistBridge.tsx` | Double rendu possible |
| I4 | `usePhase3ChecklistData` bypass store + polling 400ms | `hooks/usePhase3ChecklistData.ts` | Triple rafraîchissement, anti-pattern architectural |
| I5 | Bouton Supprimer obstacle sans confirmation | `Phase2ObstaclePanel.tsx` | UX destructive sans garde-fou |
| I6 | Deux systèmes de toast actifs simultanément | `Phase3Sidebar.tsx` | Incohérence UX, z-index 99999 |
| I7 | `setCalpinageItem` sans try/catch QuotaExceeded | `calpinageStorage.ts` | Sauvegarde silencieusement perdue |
| I8 | Pool PostgreSQL sans configuration | `backend/db/pool.js` | Risque pool exhaustion sous charge |
| I9 | Coexistence Puppeteer + Playwright backend (~600MB) | `backend/package.json` | Timeout déploiement Railway |
| I10 | Triangulation fan pour faces concaves | `triangulateFace.ts` | Ombrage incorrect sur obstacles non convexes |
| I11 | Grille sampling 4×4 vs 3×3 backend (near shading) | `buildPvPanels3D.ts` | Divergence systématique UI / backend |
| I12 | Cache RBAC in-memory non distribué | `rbac.cache.js` | Incohérence permissions en multi-instance |
| I13 | `ConfirmDialog` : focus trap absent, focus auto absent | `ConfirmDialog.tsx` | Non-conformité WCAG 2.1 |
| I14 | Plans quasi-verticaux non supportés sans message | `solveRoofPlanes.ts` | Lucarnes/murs ignorés silencieusement |
| I15 | Undo/redo hors store, non persisté | `roofModelingHistory.ts` | Feature instable architecturalement |
| I16 | `pdfViewModel.mapper.js` duplique `financeService.js` | PDF pipeline | Drift financier PDF vs scénario |
| I17 | Aucun test de couverture mesuré | Config | Impossible de savoir ce qui est couvert |

### 🟡 POLISH — Finition / qualité SaaS premium

| # | Problème | Impact |
|---|----------|--------|
| P1 | Aucun postprocessing (FXAA, Bloom PV) | Rendu non premium vs Aurora Solar / Suneye |
| P2 | Aucune IBL / environment map | Matériaux métalliques ternes |
| P3 | Aucune animation de transition caméra | UX plate, non premium |
| P4 | Deux espaces de noms CSS (--sg-* vs non préfixés) | Incohérence couleurs potentielle |
| P5 | Border-radius et couleurs hardcodées sans tokens | Changement global impossible sans toucher 6 fichiers |
| P6 | Dark mode absent sur ConfirmDialog, ObstaclePanel, Toast | Mode sombre incomplet |
| P7 | `linewidth` sur lineBasicMaterial ignoré (toujours 1px) | Lignes overlay trop fines |
| P8 | Mobile : overlay inspection 42vw trop large sur phone | Inutilisable sur smartphone |
| P9 | Badges RoofTruth à taille fixe non adaptés mobile | Non touchables |
| P10 | Typo "Resultat ombrage" dans ShadingLegend3D | |
| P11 | `ConfirmDialog` scale au hover, titre hardcodé, emoji non modulable | Composant non réutilisable |
| P12 | `toastSuccess` en indigo brand (pas vert) | Convention sémantique incorrecte |
| P13 | Keepout sans représentation 3D (hatch/cornerMarks = null) | Zones non-pose invisibles en 3D |
| P14 | `_showCameraViewModeToggle` déclarée mais non implémentée | Feature zombie dans l'API |
| P15 | `loggedOnce` module-level mutable — fragile en tests | |
| P16 | `console.log/info` DEV-only non rationalisés (5 occurrences dans viewer) | Console polluée en dev |

---

## 14. PROPOSITIONS SIMPLIFICATION UX

### 14.1 Unifier les modes en une Timeline linéaire

Remplacer la dualité Phase2/Phase3 implicite (deux sidebars, deux bridges, deux stores partiels) par une Timeline à étapes explicites visible en permanence :

```
[1. Fond satellite] → [2. Contour] → [3. Topologie] → [4. Obstacles] → [5. Panneaux] → [6. Validation]
```

Chaque étape a un statut (✓ complété / ⚡ actif / ○ en attente). Le passage entre étapes est explicite, les actions destructives montrent un avertissement.

### 14.2 Panneau d'état unique (remplace les multi-toasts + statusLabel heuristique)

Un seul composant `StudyStatusBanner` en haut du module qui affiche :
- L'étape en cours
- Les blocages réels (pas d'heuristique sur les strings)
- La puissance installée et le near shading (live)

### 14.3 Mode "Quick Inspect" en survol

Sur hover d'un panneau ou d'un obstacle en vue 3D : popup contextuel minimal (puissance, inclinaison, ombrage estimé) sans ouvrir le panneau d'inspection complet.

### 14.4 Toolbar contextuelle positionnée

Remplacer la sidebar Phase3 figée par une toolbar contextuelle qui apparaît près de la sélection — pattern utilisé par Figma, AutoCAD Web, Aurora Solar.

### 14.5 Feedback immédiat sur les actions async

Toute action qui touche le moteur (recalcul shading, placement auto, validation) doit afficher un progress spinner dans le bouton lui-même + un toast de confirmation avec la valeur résultante.

---

## 15. PROPOSITIONS AMÉLIORATION VISUELLE PREMIUM

### 15.1 Postprocessing avec `@react-three/postprocessing`

```tsx
// Ajout minimaliste — 3 effets pour un rendu premium
<EffectComposer>
  <SMAA />                               // antialiasing vectoriel
  <Bloom                                 // glow sur les cellules PV au soleil
    intensity={0.3}
    luminanceThreshold={0.9}
    mipmapBlur
  />
  <Vignette offset={0.3} darkness={0.5} />  // focus visuel
</EffectComposer>
```

### 15.2 IBL depuis un HDRI préchargé

```tsx
<Environment
  files="/hdri/overcast_sky_1k.hdr"
  background={false}
  environmentIntensity={0.4}
/>
```
Apporte la richesse PBR aux matériaux métalliques (antenne, câbles, support).

### 15.3 Animation de transition caméra

```typescript
// CameraFramingRig.tsx — lerp sur 300ms dans useFrame
const lerpFactor = 1 - Math.pow(0.001, delta); // smooth framerate-independent
camera.position.lerp(targetPosition, lerpFactor);
controls.target.lerp(targetLookAt, lerpFactor);
```

### 15.4 `InstancedMesh` pour les panneaux PV

```tsx
// 1 draw call pour N panneaux
<instancedMesh
  ref={ref}
  args={[panelGeometry, sharedMaterial, panelCount]}
>
  {/* updateMatrix pour chaque instance via useLayoutEffect */}
</instancedMesh>
```

### 15.5 Shader de cellules PV procédural

Remplacer la grille canvas 2D (recalculée à chaque frame) par un fragment shader GLSL qui dessine les cellules, busbars et métallisation en une seule passe — suppression du `emissiveMap` dynamique.

### 15.6 Ground shadow receiving

Activer les ombres portées des panneaux sur le sol/toit avec `receiveShadow` sur le `GroundPlane`. Actuellement les ombres ne se projettent pas sur la texture satellite.

---

## 16. ARCHITECTURE CIBLE LONG TERME

### 16.1 Principe : supprimer le global bus window

```
ÉTAT ACTUEL :                          CIBLE :
window.CALPINAGE_STATE ──────────────► CalpinageStore (Zustand)
window.__CALPINAGE_3D_*__ ───────────► import.meta.env.VITE_* + config.ts
window.nearShadingCore ──────────────► NearShadingService (injectable)
window.getAnnualSunVectors ──────────► SunVectorService (importé)
window.pvPlacementEngine ────────────► PvPlacementEngine (injectable)
```

### 16.2 Séparation claire des couches

```
frontend/
├── modules/calpinage/
│   ├── store/          ← CalpinageStore Zustand (source de vérité unique)
│   ├── domain/         ← entités pures (RoofFace, Ridge, PVPanel, ShadingState)
│   ├── engine/         ← moteurs purs sans effets de bord (placement, géométrie)
│   ├── render2d/       ← React+Konva (remplace calpinage.module.js IIFE)
│   ├── render3d/       ← Three.js/R3F (déjà bien structuré dans canonical3d/)
│   ├── services/       ← NearShadingService, PvPlacementService, HeightService
│   └── export/         ← serialisation JSON + validation Zod
```

### 16.3 Schéma de données canonique (tel que décrit dans ARCHITECTURE_REFONTE)

Le modèle `RoofFace`, `Ridge`, `RoofVertex`, `PVPanel`, `ShadingState`, `ExportSnapshot` doit devenir le seul schéma persisté. La migration V2 actuelle est une migration de *métadonnées*, pas de données. La vraie migration vers ce modèle canonique reste à faire.

### 16.4 Backend : `CalcOrchestrator` injectable

```javascript
// Remplace calc.controller.js (1867 lignes)
class CalcOrchestrator {
  constructor(
    private pvgis: PvgisService,
    private shading: ShadingService,
    private finance: FinanceService,
    private battery: BatteryService,
  ) {}
  
  async calculate(context: CalcContext): Promise<CalcResult> { ... }
}
```

### 16.5 BVH pour le raycast shading

```typescript
// Remplace volumeRaycast.ts O(N) par O(log N)
import { MeshBVH } from 'three-mesh-bvh';
const bvh = new MeshBVH(obstaclesMergedGeometry);
// Précomputer une fois, raycaster N fois
```

### 16.6 Feature flags via Posthog ou LaunchDarkly

Supprimer les 10+ `window.__CALPINAGE_*__` et remplacer par un service de feature flags dédié avec:
- Activation par organisation (activation progressive)
- Kill switch sans redéploiement
- Dashboard de suivi activation

### 16.7 Near shading : source unique

Unifier le calcul near shading en un seul moteur accessible des deux côtés :
1. Compiler le moteur canonical 3D TypeScript vers un package Node.js
2. Utiliser le même code frontend et backend (via Web Worker côté client)
3. Supprimer `nearShadingCore.cjs` legacy et la dualité de calcul

---

## ANNEXE : Métriques du projet

| Métrique | Valeur |
|----------|--------|
| Lignes totales module calpinage (TS/TSX) | 82 900 |
| Fichiers module calpinage | ~500 |
| Lignes `calpinage.module.js` legacy | 22 637 |
| Lignes `SolarScene3DViewer.tsx` | 4 216 |
| Lignes `calc.controller.js` backend | 1 867 |
| Tests backend | 164 fichiers |
| Tests Playwright | 13 specs |
| Globals `window.*` actifs | ~10 |
| Feature flags actifs (window + env) | ~7 |
| Branches emergency/fallback sans UI | 3 |
| Diagnostics qualité produits mais non affichés | 5 types |
| Steps TECH_DEBT (mai 2026) | 13 |
| Lignes `any` TypeScript documentées | 42 |

---

*Audit réalisé le 16 mai 2026. Aucun code modifié. Audit seul.*
