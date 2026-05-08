# ARCHITECTURE REFONTE CALPINAGE — Document de Décision
## SolarNext · Niveau CTO/Architecte Logiciel
**Version** : 1.0 · **Date** : 2026-05-08 · **Statut** : AUDIT UNIQUEMENT — aucun code modifié

---

## RÉSUMÉ EXÉCUTIF

Le module calpinage contient une bombe d'entropie : `calpinage.module.js` = **22 637 lignes**,  
un état global sur `window.CALPINAGE_STATE`, et un pipeline 3D complet (canonical3d, ~200 fichiers TS)  
désactivé par défaut en production. La bonne nouvelle : les **types cibles existent déjà** dans  
`canonical3d/types/` — ils sont corrects et complets. La refonte consiste à élever ces contrats  
au rang de source de vérité et à détruire le tas legacy proprement.

---

## SECTION 1 — MODÈLE DE DONNÉES CANONIQUE CIBLE

### Principes

| Principe | Règle |
|---|---|
| **Immuabilité** | Tous les objets du modèle sont `readonly` en TypeScript |
| **Unité unique** | Mètres (distances), degrés (angles), secondes (temps) |
| **Repère unique** | ENU local (X Est, Y Nord, Z Up) — déjà défini dans `WorldReferenceFrame` |
| **Identité stable** | Chaque entité a un `id: StableEntityId` (string UUID ou hash déterministe) |
| **Provenance** | Chaque entité a un `provenance: GeometryProvenance` — source de reconstruction |
| **Pas de position dupliquée** | Un panneau a UNE position monde — pas de px+world en parallèle |

---

### 1.1 `CalpinageStudyRef` — Référence étude (clé de scoping)

```typescript
interface CalpinageStudyRef {
  readonly studyId: string;        // ID CRM étude (obligatoire)
  readonly versionId: string;      // ID version snapshot (obligatoire)
  readonly leadRef?: string;       // Référence lead (affichage seul)
}
```
**Persisté** : oui (clé de scoping localStorage + futur serveur)
**Invariant** : `studyId` et `versionId` toujours présents pour toute donnée scopée

---

### 1.2 `WorldTransform` — Repère image ↔ monde

```typescript
interface WorldTransform {
  readonly metersPerPixel: number;         // m/px — source : API lead ou saisie manuelle
  readonly northAngleDeg: number;          // rotation image vs Nord géographique (deg CW depuis Nord)
  readonly captureWidthPx: number;         // largeur image de capture (px naturels)
  readonly captureHeightPx: number;        // hauteur image de capture (px naturels)
  readonly gpsOriginLat?: number;          // latitude WGS84 du centre image (optionnel)
  readonly gpsOriginLon?: number;          // longitude WGS84 du centre image (optionnel)
  readonly schemaVersion: 1;
}
```
**Persisté** : oui  
**Source** : API cadastre/satellite → lead → saisie manuelle (priorité décroissante)  
**Validation** : `metersPerPixel > 0`, `northAngleDeg ∈ [0, 360[`, `captureWidthPx > 0`  
**Invariant** : WorldTransform est immuable après confirmation Phase 1. Toute modification invalide la géométrie.

---

### 1.3 `CaptureImage` — Image satellite de référence

```typescript
interface CaptureImage {
  readonly dataUrl: string;                // base64 image (PNG/JPEG)
  readonly widthPx: number;               // px naturels (pas CSS)
  readonly heightPx: number;              // px naturels
  readonly source: "satellite" | "manual_upload" | "placeholder";
  readonly capturedAtIso?: string;        // date de capture si connue
}
```
**Persisté** : oui (localStorage, future API blob)  
**Dérivé** : non — c'est la source primaire de Phase 1  
**Ne jamais persister** : canvas HTML, ObjectURL, blob temporaire — uniquement dataUrl stable

---

### 1.4 `RoofContour` — Contour bâtiment 2D

```typescript
interface RoofContour {
  readonly vertices: ReadonlyArray<{ readonly xPx: number; readonly yPx: number }>;
  readonly isClosed: boolean;
  readonly sourcePhase: "phase1" | "imported";
}
```
**Persisté** : oui (coordonnées image px)  
**Repère** : image px (origine coin haut-gauche, Y vers le bas)  
**Invariant** : ≥ 3 sommets pour un contour valide

---

### 1.5 `RoofFace` (= Pan) — Face planaire de toiture

Ce type **remplace** l'objet `pan` du legacy (`panId`, `vertices`, `ridgeId`, etc.).

```typescript
interface RoofFace {
  readonly id: StableEntityId;                    // UUID stable
  readonly vertexIds: ReadonlyArray<StableEntityId>; // cycle CCW vu depuis ciel
  // Géométrie 2D (persistée)
  readonly polygon2DPx: ReadonlyArray<{ xPx: number; yPx: number }>;
  // Hauteurs (persistées si saisies manuellement)
  readonly vertexHeightsByVertexId: Readonly<Record<StableEntityId, number>>; // m au-dessus sol
  // Géométrie 3D (dérivée — calculée, non persistée)
  readonly derived3D?: RoofFaceDerived3D;
  // Méta-données métier
  readonly label?: string;                        // "Pan 1", "Pan Nord", etc.
  readonly isLocked: boolean;                     // vrai = géométrie confirmée
  readonly provenance: "drawn" | "imported" | "auto_detected";
}

interface RoofFaceDerived3D {
  readonly cornersWorld: ReadonlyArray<Vector3>;  // ENU
  readonly normal: Vector3;                       // normale unitaire sortante
  readonly tiltDeg: number;                       // inclinaison vs horizontal
  readonly azimuthDeg: number;                    // 0=Nord, 90=Est
  readonly areaM2: number;
  readonly planeEquation: PlaneEquation;
  readonly localFrame: LocalFrame3D;
}
```
**Persisté** : `polygon2DPx`, `vertexHeightsByVertexId`, `label`, `isLocked`, `provenance`  
**Dérivé** : `derived3D` — recalculé à la demande depuis `polygon2DPx` + `WorldTransform` + hauteurs  
**Invariant** : un panneau posé sur ce pan DOIT référencer l'id de ce pan — pas de flottant orphelin

---

### 1.6 `Ridge` — Ligne structurante (faîtage, noue, rive)

```typescript
interface Ridge {
  readonly id: StableEntityId;
  readonly kind: "ridge" | "valley" | "hip" | "eave" | "rake";
  readonly vertexIds: ReadonlyArray<StableEntityId>;  // au moins 2
  readonly heightAtVerticesM: Readonly<Record<StableEntityId, number>>;
  readonly constrainedFaceIds: ReadonlyArray<StableEntityId>; // pans contraints
}
```
**Persisté** : oui  
**Invariant** : chaque vertexId doit exister dans la table `RoofVertex`

---

### 1.7 `RoofVertex` — Sommet topologique

```typescript
interface RoofVertex {
  readonly id: StableEntityId;
  readonly xPx: number;            // position image px
  readonly yPx: number;            // position image px
  readonly heightM?: number;       // hauteur explicite (m) — si saisie utilisateur
  readonly heightSource: "explicit" | "interpolated" | "zero_fallback";
}
```
**Persisté** : `id`, `xPx`, `yPx`, `heightM`, `heightSource`  
**Dérivé** : position monde ENU — calculée depuis WorldTransform

---

### 1.8 `RoofObstacle` — Obstacle sur toiture

```typescript
interface RoofObstacle {
  readonly id: StableEntityId;
  readonly catalogId: RoofObstacleBusinessId;   // from roofObstacleCatalog.ts
  readonly centerPx: { xPx: number; yPx: number };
  readonly rotationDeg: number;
  readonly widthM: number;
  readonly depthM: number | null;
  readonly diameterM: number | null;
  readonly heightM: number;          // hauteur physique au-dessus du plan toiture (m)
  readonly baseZOffsetM: number;     // offset Z si non posé au niveau du pan (0 par défaut)
  readonly faceId?: StableEntityId;  // pan hôte si connu
  // Dérivé — non persisté
  readonly derived3D?: ObstacleDerived3D;
}

interface ObstacleDerived3D {
  readonly volume: RoofObstacleVolume3D;   // maillage volumique ENU
  readonly footprintWorld: ReadonlyArray<Vector3>;
}
```
**Persisté** : tout sauf `derived3D`  
**Invariant** : `heightM > 0` pour un obstacle ombrant, `heightM === 0` autorisé pour keepout pur

---

### 1.9 `PVPanel` — Module photovoltaïque posé

Ce type **remplace** le `panel`/`pvPlacement` du legacy.

```typescript
interface PVPanel {
  readonly id: StableEntityId;
  readonly faceId: StableEntityId;           // pan hôte (obligatoire)
  readonly blockId?: StableEntityId;         // bloc/string appartenance
  // Position (en coordonnées image px — source de vérité 2D)
  readonly centerPx: { xPx: number; yPx: number };
  readonly orientation: "portrait" | "landscape";
  readonly localRotationDeg: number;         // rotation dans le plan du pan (CCW)
  // Dimensions (tirées du modèle panneau)
  readonly widthM: number;
  readonly heightM: number;
  // Statut placement
  readonly isEnabled: boolean;
  readonly isFrozen: boolean;                // vrai = coordonnées gelées (ne bouge plus)
  // Géométrie 3D (dérivée — NON persistée)
  readonly derived3D?: PVPanelDerived3D;
  // Shading (dérivé — non persisté, rattaché en overlay)
  readonly shadingResult?: PVPanelShadingResult;
}

interface PVPanelDerived3D {
  readonly corners3D: readonly [Vector3, Vector3, Vector3, Vector3]; // ENU CCW
  readonly centerWorld: Vector3;
  readonly outwardNormal: Vector3;
  readonly localFrame: LocalFrame3D;
  readonly samplingGrid?: PvPanelGrid3D;
}

interface PVPanelShadingResult {
  readonly lossPct: number;
  readonly shadedFractionAvg: number;
  readonly engine: "backend_near" | "frontend_canonical" | "unknown";
}
```
**Persisté** : `id`, `faceId`, `blockId`, `centerPx`, `orientation`, `localRotationDeg`, `widthM`, `heightM`, `isEnabled`, `isFrozen`  
**Dérivé (jamais persisté)** : `derived3D`, `shadingResult`  
**Invariant critique** : `centerPx` EST la source de vérité position. `derived3D.centerWorld` en est la projection. Les deux ne peuvent pas coexister comme sources indépendantes.

---

### 1.10 `PVBlock` — Groupe logique de panneaux

```typescript
interface PVBlock {
  readonly id: StableEntityId;
  readonly panelIds: ReadonlyArray<StableEntityId>;
  readonly label?: string;
  readonly stringConfig?: {
    readonly panelsInSeries: number;
    readonly stringsInParallel: number;
  };
}
```
**Persisté** : oui  
**Invariant** : chaque `panelId` doit exister dans la table `PVPanel`

---

### 1.11 `ShadingState` — État ombrage calculé

```typescript
interface ShadingState {
  // Far shading (calculé serveur ou proxy PVGIS)
  readonly far?: {
    readonly totalLossPct: number;
    readonly source: "IGN_RGE_ALTI" | "HTTP_GEOTIFF" | "DSM_REAL" | "RELIEF_ONLY" | "SYNTHETIC_STUB";
    readonly farHorizonKind: "REAL_TERRAIN" | "SYNTHETIC" | "UNAVAILABLE";
    readonly horizonMaskSamples?: ReadonlyArray<{ azimuthDeg: number; elevationDeg: number }>;
  };
  // Near shading (calculé frontend ou serveur)
  readonly near?: {
    readonly totalLossPct: number;
    readonly perPanel: ReadonlyArray<{ panelId: string; lossPct: number }>;
    readonly engine: "nearShadingCore.cjs" | "canonical_3d_ts_frontend" | "legacy_polygon";
    readonly computedAtIso: string;
  };
  // Résultat officiel combiné (source contrat: combined.totalLossPct)
  readonly combined: {
    readonly totalLossPct: number;            // SEULE valeur à utiliser dans PDF/scénarios
  };
  readonly confidence: "HIGH" | "MEDIUM" | "LOW" | "UNKNOWN";
  readonly computedAtIso?: string;
}
```
**Persisté** : oui (bloc shading complet dans l'état étude)  
**Ne jamais persister** : positions de raycast intermédiaires, buffers WebGL  
**Invariant** : `combined.totalLossPct` = seule valeur UI/PDF. `near.totalLossPct` seul ≠ officiel.

---

### 1.12 `ExportSnapshot` — Snapshot export étude

```typescript
interface ExportSnapshot {
  readonly schemaVersion: "CALPINAGE_V2";       // remplace "CALPINAGE_V1"
  readonly studyRef: CalpinageStudyRef;
  readonly worldTransform: WorldTransform;
  readonly vertices: ReadonlyArray<RoofVertex>;
  readonly faces: ReadonlyArray<RoofFace>;       // polygon2DPx + heights seulement
  readonly ridges: ReadonlyArray<Ridge>;
  readonly obstacles: ReadonlyArray<RoofObstacle>;
  readonly panels: ReadonlyArray<PVPanel>;       // centerPx + métadonnées — sans derived3D
  readonly blocks: ReadonlyArray<PVBlock>;
  readonly shading?: ShadingState;
  readonly pvParams?: PVParams;
  readonly captureImageRef?: string;             // hash ou ID blob (pas le dataUrl inline)
  // Intégrité
  readonly integrityHashes: {
    readonly geometryHash: string;   // FNV1a32 sur faces+ridges+vertices
    readonly panelsHash: string;     // FNV1a32 sur panels (centerPx+orientation+enabled)
    readonly shadingHash?: string;   // FNV1a32 sur shading si présent
  };
  readonly exportedAtIso: string;
}
```
**Persisté** : oui — c'est l'objet sauvegardé/rechargé  
**Jamais dans ExportSnapshot** : derived3D, canvas HTML, window globals, renderer state

---

## SECTION 2 — SOURCE UNIQUE DE VÉRITÉ

### 2.1 Ce qui NE doit plus vivre sur `window`

| Variable window actuelle | Problème | Destination cible |
|---|---|---|
| `window.CALPINAGE_STATE` | Mutable global, non typé | `CalpinageStore` (Zustand) |
| `window.pvPlacementEngine` | Fonction impure accrochée en global | Export pur depuis `engine/pvPlacementEngine.ts` |
| `window.CALPINAGE_RENDER` | Callback de rendu exposé globalement | Abonnement store → renderer React |
| `window.computeProjectedPanelRect` | Fonction géométrique globale | Export de `core/geometryCore2d.ts` |
| `window.getHeightAtXY` | Accès hauteur via global | `HeightResolver` injecté dans les moteurs |
| `window.__calpinageBeginPhase3PvMoveFrom3d` | Bridge 3D→2D via global | Callback Zustand action |
| `window.__calpinageCommitPvPlacementFrom3DImagePoint` | Bridge 3D→2D via global | Zustand action |
| `window.__CALPINAGE_CANONICAL_3D__` | Override flag en global | Supprimer — utiliser `.env` uniquement |
| `window.emitOfficialRuntimeStructuralChange` | Événement DOM global | Zustand selector subscription |
| `window.__calpinage_hitTestPan__` | Hit test exposé global | Export pur depuis `core/hitTest.ts` |

### 2.2 Ce qui doit vivre dans un store typé (Zustand)

```typescript
interface CalpinageStore {
  // Identité étude
  studyRef: CalpinageStudyRef;

  // Données persistées (sauvegardées → rechargées)
  worldTransform: WorldTransform | null;
  captureImage: CaptureImage | null;
  roofContour: RoofContour | null;
  vertices: Map<StableEntityId, RoofVertex>;
  faces: Map<StableEntityId, RoofFace>;          // les "pans"
  ridges: Map<StableEntityId, Ridge>;
  obstacles: Map<StableEntityId, RoofObstacle>;
  panels: Map<StableEntityId, PVPanel>;
  blocks: Map<StableEntityId, PVBlock>;
  pvParams: PVParams | null;
  shadingState: ShadingState | null;

  // État UI (non persisté)
  activePhase: 1 | 2 | 3;
  selectedEntityId: StableEntityId | null;
  selectedEntityKind: "face" | "panel" | "obstacle" | "vertex" | "ridge" | null;
  interactionState: InteractionState;            // remplace interactionStateMachine.js
  viewMode: "2d" | "3d";
  is3DSceneDirty: boolean;                       // true = rebuild 3D nécessaire

  // Cache dérivé (invalidé automatiquement par Zustand)
  derived3DCache: Map<StableEntityId, RoofFaceDerived3D>;    // pans
  panelDerived3DCache: Map<StableEntityId, PVPanelDerived3D>; // panneaux

  // Actions
  actions: CalpinageActions;
}
```

### 2.3 Ce qui doit être calculé à la volée (dérivé, jamais persisté)

- Positions monde ENU des sommets (`imagePxToWorldHorizontalM`)
- Normales de pan (Newell ou cross-product sur corners3D)
- Inclinaison/azimut de pan
- Corners 3D des panneaux (`buildCanonicalPlacedPanelsFromRuntime`)
- Score qualité géométrique
- Zones de sécurité (setbacks, keepout margins)
- Signature de scène (`sceneRuntimeSignature`) pour cache 3D

### 2.4 Ce qui doit être persisté

- Tout ce qui est dans `ExportSnapshot` (section 1.12)
- `captureImage.dataUrl` (localStorage ou blob serveur)
- Les hashes d'intégrité `integrityHashes`
- La version schema `CALPINAGE_V2`

### 2.5 Ce qui ne doit jamais être persisté

- `derived3D` de n'importe quelle entité
- Canvas HTML, ImageData, WebGL buffers
- État UI (phase active, sélection, mode vue)
- Positions 3D redondantes (worldX/Y/Z séparés de centerPx)
- Cache de scène Three.js
- Résultats de raycast near shading intermédiaires

### 2.6 Ce qui doit être versionné (schema migrations)

- `ExportSnapshot.schemaVersion` : `"CALPINAGE_V1"` → `"CALPINAGE_V2"`  
- Trigger migration : champ `version: "v1"` (legacy) détecté → migration automatique au chargement  
- Outil migration : `migrateExportSnapshotV1ToV2(v1: unknown): ExportSnapshot`

---

## SECTION 3 — SÉPARATION CLAIRE DES COUCHES

### 3.1 Architecture cible en couches

```
┌─────────────────────────────────────────────────────────────────────┐
│  COUCHE UI (React)                                                  │
│  CalpinageApp.tsx · Phase2Sidebar.tsx · Phase3Sidebar.tsx          │
│  Inline3DViewerBridge.tsx · toolbar · modals · toasts              │
│  Règle : lecture/écriture store UNIQUEMENT via selectors/actions   │
├──────────────────────────────────────┬──────────────────────────────┤
│  RENDU 2D                            │  RENDU 3D                   │
│  CalpinageCanvas2D.tsx               │  SolarScene3DViewer.tsx     │
│  (Three.js orthographic OU konva)    │  (Three.js perspective)     │
│  Entrée : selectors store            │  Entrée : SolarScene3D      │
│  Sortie : événements utilisateur     │  Sortie : actions store     │
├──────────────────────────────────────┴──────────────────────────────┤
│  STORE APPLICATIF                                                   │
│  calpinageStore.ts (Zustand)                                       │
│  Source de vérité unique — pas de window, pas de DOM events        │
├──────────────────────────────────────┬──────────────────────────────┤
│  MOTEUR PLACEMENT PV                 │  MOTEUR GÉOMÉTRIE TOITURE   │
│  pvPlacementEngine/                  │  roofGeometryEngine/        │
│  · ghostSlots (auto-placement)       │  · faceSolver.ts            │
│  · collisionCheck.ts                 │  · ridgeSolver.ts           │
│  · keepoutFilter.ts                  │  · heightInterpolator.ts    │
│  · blockBuilder.ts                   │  · normalCalc.ts            │
│  Entrée : RoofFace, obstacles        │  Entrée : vertices, ridges  │
│  Sortie : PVPanel[]                  │  Sortie : RoofFaceDerived3D │
├──────────────────────────────────────┴──────────────────────────────┤
│  MOTEUR SHADING                                                     │
│  shading/                                                           │
│  · nearShadingFrontend.ts (wrapper canonical3d near)               │
│  · farShadingProxy.ts (PVGIS proxy)                                │
│  · shadingAggregator.ts (near + far → combined)                    │
│  Entrée : PVPanel[], obstacles, horizonMask, GPS                   │
│  Sortie : ShadingState                                             │
├─────────────────────────────────────────────────────────────────────┤
│  CORE GÉOMÉTRIQUE PUR                                               │
│  core/geometryCore2d.ts · core/worldMapping.ts                     │
│  · dist2d · pointInPolygon · intersectSegments                     │
│  · imagePxToWorldENU · worldENUToImagePx                           │
│  Règle : zéro dépendance externe, testable Node.js pur             │
├─────────────────────────────────────────────────────────────────────┤
│  COUCHE PERSISTENCE                                                 │
│  persistence/                                                       │
│  · calpinageStorage.ts (localStorage scopé — actuel, à garder)    │
│  · calpinageServerApi.ts (futur serveur — blob image, export PDF)  │
│  · exportSnapshotSerializer.ts (V1→V2 migration)                   │
│  · reloadIntegrityChecker.ts (hash verification)                   │
├─────────────────────────────────────────────────────────────────────┤
│  ADAPTATEURS LEGACY TEMPORAIRES (bridge → suppression progressive) │
│  adapters/                                                          │
│  · legacyCalpinageStateAdapter.ts (CALPINAGE_STATE → store)        │
│  · legacyWindowBridge.ts (window.* → store actions)               │
│  · legacyEventBridge.ts (DOM events → store subscriptions)        │
└─────────────────────────────────────────────────────────────────────┘
```

### 3.2 Fichiers/dossiers à CRÉER

```
src/modules/calpinage/
  store/
    calpinageStore.ts              ← Zustand store principal
    selectors/                     ← selectors dérivés (faces, panels, shading)
    actions/                       ← actions typées (createPanel, movePanel, etc.)
    types/                         ← interfaces store (CalpinageStore, etc.)
  engine/
    pvPlacementEngine/             ← extraction depuis calpinage.module.js
      ghostSlots.ts
      collisionCheck.ts
      keepoutFilter.ts
      blockBuilder.ts
      pvPlacementEngine.ts         ← orchestrateur
    roofGeometryEngine/
      faceSolver.ts                ← résout RoofFaceDerived3D depuis polygon2DPx
      ridgeSolver.ts
      heightInterpolator.ts
      normalCalc.ts
  persistence/
    calpinageStorage.ts            ← (actuel — garder, déplacer)
    calpinageServerApi.ts          ← NOUVEAU — futur API blob/serveur
    exportSnapshotSerializer.ts    ← V1→V2 migration
    reloadIntegrityChecker.ts      ← extract depuis calpinageReloadIntegrity.ts
  adapters/                        ← bridges temporaires
    legacyCalpinageStateAdapter.ts
    legacyWindowBridge.ts
    legacyEventBridge.ts
  render2d/                        ← NOUVEAU — rendu 2D React
    CalpinageCanvas2D.tsx
    layers/
      ContourLayer.tsx
      FacesLayer.tsx
      PanelsLayer.tsx
      ObstaclesLayer.tsx
      RidgesLayer.tsx
      InteractionLayer.tsx
```

### 3.3 Fichiers/dossiers à CONSERVER (sans modification ou refactoring mineur)

```
canonical3d/types/          ← GARDER intégralement — les types sont corrects
canonical3d/builder/        ← GARDER — worldMapping.ts est correct
canonical3d/scene/          ← GARDER — officialSolarScene3DGateway.ts (cache pattern)
canonical3d/viewer/         ← GARDER — SolarScene3DViewer.tsx (activer)
core/geometryCore2d.js      ← GARDER, migrer en .ts
calpinageStorage.ts         ← GARDER, déplacer dans persistence/
catalog/roofObstacleCatalog.ts ← GARDER
shading/shadingGovernance.ts   ← GARDER
shading/nearShadingTypes.ts    ← GARDER
integration/                   ← GARDER, enrichir
```

### 3.4 Fichiers/dossiers à SUPPRIMER (fin de migration)

```
legacy/calpinage.module.js          ← 22 637 lignes — LA cible principale
legacy/calpinage.module.js.bak      ← immédiatement
legacy/calpinage.module.d.ts        ← inutile après migration
phase3/phase3Viewer.js             ← après activation canonical3d
smartpitch/calpinage/store/types.ts ← doublon avec types canoniques (scale: number BUG)
runtime/canonical3DWorldContract.ts ← remplacé par WorldTransform dans le store
runtime/emitOfficialRuntimeStructuralChange.ts ← remplacé par Zustand subscription
```

---

## SECTION 4 — PIPELINE 2D/3D PARFAIT

### 4.1 Règle fondamentale

> **Un panneau a une seule position : `centerPx` en coordonnées image.**  
> La position monde `centerWorld` est une **projection dérivée**, jamais une source.  
> Si `centerPx` et `centerWorld` diffèrent → `centerPx` a raison. `centerWorld` se recalcule.

### 4.2 Pipeline cible (de l'image aux corners 3D)

```
[image naturelle PNG]
    │  widthPx, heightPx
    ↓
[WorldTransform]
    │  metersPerPixel, northAngleDeg
    │
    ├── imagePxToWorldHorizontalM(xPx, yPx, mpp, north)
    │       x0 = xPx * mpp
    │       y0 = -yPx * mpp        ← inversion Y (image Y-down → ENU Y-up)
    │       rotation par northAngleDeg
    │       → { x: number, y: number }  (horizontal ENU, Z=0)
    │
[RoofVertex avec heightM]
    │  (x, y) horizontal ENU + Z explicite ou interpolé
    ↓
[RoofFace.polygon2DPx → cornersWorld ENU]
    │  imagePxToWorldHorizontalM pour chaque sommet
    │  + Z depuis heightInterpolator (Ridge constraints + bilinéaire)
    ↓
[RoofFaceDerived3D]
    │  normal = Newell(cornersWorld)
    │  planeEquation = { normal, d = -dot(normal, cornersWorld[0]) }
    │  localFrame = { origin: centroid, xAxis, yAxis, zAxis=normal }
    │  tiltDeg, azimuthDeg
    ↓
[PVPanel.centerPx → centerWorld ENU]
    │  imagePxToWorldHorizontalM(centerPx)
    │  → (cx, cy) horizontal
    │  Z = planeEquation.solve(cx, cy)  ← projection sur le plan du pan
    ↓
[PVPanelDerived3D]
    │  corners3D = buildQuadOnPlane(centerWorld, localFrame, widthM, heightM, localRotationDeg)
    │  outwardNormal = face.normal
    │  samplingGrid (optionnel — pour near shading)
    ↓
[SolarScene3D]
    │  roofModel + pvPanels + obstacleVolumes
    ↓
[SolarScene3DViewer.tsx]  ← Three.js — rendu perspective
    │
    ↓
[Projection inverse : click 3D → centerPx]
    │  worldPointToImage(worldHit, worldTransform)
    │  → centerPx
    │  → store.actions.setPanelCenter(panelId, newCenterPx)
```

### 4.3 Synchronisation 2D ↔ 3D garantie

| Événement | Action | Garantie |
|---|---|---|
| Déplacement panneau en 2D | `store.actions.setPanelCenter(id, newPx)` | centerPx mis à jour → derived3D invalidé → 3D rebuild |
| Déplacement panneau en 3D | worldHit → `worldPointToImage` → `setPanelCenter` | Même chemin que 2D |
| Modification hauteur vertex | `store.actions.setVertexHeight(id, m)` | derived3DCache invalidé pour faces concernées → 3D rebuild |
| Modification WorldTransform | Store reset complet derived3D | Toute géométrie recalculée |
| Reload depuis localStorage | Seulement `ExportSnapshot` chargé → derived3D recalculé | Jamais de position stale |

---

## SECTION 5 — REFONTE PLACEMENT PANNEAUX

### 5.1 Modèle d'opérations

```
Opération          Entrée                        Sortie store
─────────────────────────────────────────────────────────────
createPanel        (faceId, centerPx?, model)   panels.set(id, panel)
movePanel          (id, newCenterPx)             panels.set(id, {..., centerPx})
rotatePanelInPlane (id, deltaDeg)                panels.set(id, {..., localRotationDeg})
setOrientation     (id, "portrait"|"landscape")  panels.set(id, {..., orientation})
toggleEnabled      (id)                          panels.set(id, {..., isEnabled: !isEnabled})
freezePanel        (id)                          panels.set(id, {..., isFrozen: true})
unfreezePanel      (id)                          panels.set(id, {..., isFrozen: false})
deletePanel        (id)                          panels.delete(id)
assignToBlock      (panelId, blockId)            panels.set + blocks.set
createAutoLayout   (faceId, model, params)       panels.setMany(generated)
```

### 5.2 Auto-placement (Ghost Slots)

Le moteur ghost slots actuel (extrait de calpinage.module.js) doit devenir une fonction pure :

```typescript
function computeGhostSlots(
  face: RoofFace,
  faceDerived: RoofFaceDerived3D,
  existingPanels: ReadonlyArray<PVPanel>,
  obstacles: ReadonlyArray<RoofObstacle>,
  pvModel: PVModelSpec,
  params: AutoLayoutParams
): ReadonlyArray<PVPanelSlot>
```

**Entrée** : données immuables du store  
**Sortie** : slots proposés (preview) → l'utilisateur confirme → `createAutoLayout` écrit dans le store  
**Règle** : aucune mutation du store pendant le calcul ghost — preview uniquement

### 5.3 Collisions et keepout

```typescript
function checkPanelCollisions(
  panel: PVPanel,
  allPanels: ReadonlyArray<PVPanel>,
  obstacles: ReadonlyArray<RoofObstacle>,
  worldTransform: WorldTransform
): CollisionResult
```

Réduit les 6 implémentations `pointInPolygon` dispersées à **une seule** depuis `geometryCore2d.ts`.

### 5.4 Élimination définitive du drift reload

**Cause actuelle** : `mapBlockForPanelsHash()` sérialise les champs `orientation`, `enabled`, `localRotationDeg`  
avec des valeurs `undefined` vs `false`/`0` selon le chemin de sauvegarde.

**Solution cible** :
1. `PVPanel` dans le store : tous les champs sont toujours définis (pas de `undefined` optionnel pour les champs critiques)
2. `panelsHash` calculé sur `[id, faceId, centerPx.xPx, centerPx.yPx, orientation, localRotationDeg, isEnabled, isFrozen]` — **liste fixe, ordre lexicographique des IDs**
3. Lors du reload : `ExportSnapshot.panels` → `PVPanel[]` via `deserializePanelV2(raw)` avec valeurs par défaut garanties
4. Hash recalculé après deserialization → comparaison → drift = 0 pour toute étude V2

---

## SECTION 6 — REFONTE OBSTACLES

### 6.1 Modèle final obstacles

```
RoofObstacle (persisté)
├── catalogId            → RoofObstacleCatalogEntry (métier)
├── centerPx             → position image (source de vérité)
├── rotationDeg          → orientation image
├── widthM, depthM       → dimensions réelles
├── diameterM            → si cylindrique
├── heightM              → hauteur physique au-dessus plan toiture
├── baseZOffsetM         → si flottant au-dessus du pan (ex: cheminée sur faîtage)
├── faceId?              → pan hôte (optionnel — pour Z resolution)
└── derived3D?           → calculé, jamais persisté

RoofObstacleDerived3D (dérivé)
├── footprintWorldPts[]  → emprise 2D en ENU (pour keepout 2D)
├── volumeMesh           → RoofObstacleVolume3D (pour rendu 3D)
└── aabb                 → bounding box pour frustum culling
```

### 6.2 Catégories d'obstacles — règles métier

| Catégorie | isShadingObstacle | keepout pose | Rendu 3D | Near shading |
|---|---|---|---|---|
| `opaque_shading` | true | oui | volume 3D | oui |
| `non_shading_keepout` | false | oui | outline only | non |
| `non_posable_zone` (manuel) | false | oui | zone colorée | non |

### 6.3 Résolution baseZ

Problème actuel : `baseZ` de l'obstacle n'est pas synchronisé avec le Z du pan hôte.

Solution : `resolveObstacleBaseZ(obstacle, face, faceDerived, worldTransform)` → calculé à la demande,  
jamais stocké dans l'obstacle lui-même. Si `faceId` absent → `baseZ = 0` (sol).

### 6.4 Obstacles ombrants → near shading

Les obstacles `opaque_shading` sont passés tels quels au moteur near shading via :  
```typescript
buildCanonicalObstacles3DFromRuntime(obstacles, worldTransform) → CanonicalObstacle3D[]
```
Ce fichier existe déjà (`canonical3d/adapters/buildCanonicalObstacles3DFromRuntime.ts`) — à conserver.

---

## SECTION 7 — REFONTE SHADING

### 7.1 Architecture cible shading

```
ShadingOrchestrator
├── [Far shading]
│   └── farShadingProxy.ts
│       ├── source: PVGIS proxy (HTTP_GEOTIFF / IGN_RGE_ALTI si GPS précis)
│       ├── source: SYNTHETIC_STUB si GPS manquant
│       └── cache: localStorage + TTL 24h par (lat, lon, ±0.001°)
│
├── [Near shading]
│   └── nearShadingSelector.ts  (shadingGovernance.ts pattern — actuel, garder)
│       ├── backend: nearShadingCore.cjs (via API serveur) → officiel étude/PDF
│       ├── frontend canonical: canonical3d near shading (VITE_CANONICAL_3D_NEAR_SHADING)
│       │   └── canonical3d/viewer/visualShading/ (actuel, garder)
│       └── frontend legacy: enrichNormalizedShadingFromHorizon.js (fallback)
│
└── [Agrégation]
    └── shadingAggregator.ts
        └── combined.totalLossPct = f(near, far)  ← seule valeur officielle PDF
```

### 7.2 Règles de gouvernance shading (renforcées)

1. `combined.totalLossPct` = **seule** valeur pour PDF et scénarios. Jamais `near.totalLossPct` seul.
2. Near backend (serveur) = officiel pour persistance étude. Near frontend = preview UI uniquement.
3. Recalcul near : uniquement si `panelsHash` ou `obstaclesHash` a changé depuis dernier calcul.
4. Recalcul far : uniquement si GPS ou mois a changé (cache 24h).
5. `hasShadingDrift` : comparaison `shadingHash` au reload → alerte UI si écart > 0.5%.

### 7.3 Cache et recalcul incrémental

```typescript
interface ShadingCacheKey {
  panelsHash: string;
  obstaclesHash: string;
  gpsLat: number;      // arrondi 3 décimales
  gpsLon: number;      // arrondi 3 décimales
}
```

Cache localStorage keyed sur `ShadingCacheKey` → TTL 1h pour near frontend, 24h pour far.

### 7.4 Lien shading ↔ scénarios PDF

Le bloc `ExportSnapshot.shading` est transmis tel quel à l'API serveur lors de la génération PDF.  
Le serveur recalcule near avec `nearShadingCore.cjs` si `near.engine !== "nearShadingCore.cjs"`.  
Résultat serveur remplace `shading.near` dans le snapshot persisté côté serveur.

---

## SECTION 8 — REFONTE RENDU 2D

### 8.1 Analyse des options

| Option | Avantages | Inconvénients | Score |
|---|---|---|---|
| **Canvas legacy (actuel)** | Rien à réécrire court terme | 22 637 lignes inextricables, non React, non testable | ❌ Non viable |
| **Three.js orthographic** | Même stack que 3D, coordonnées ENU unifiées, frustum culling, export image natif | Apprentissage caméra ortho, overkill pour 2D simple | ⭐⭐⭐⭐ |
| **Konva** | React-natif, declaratif, events souris propres, bonne perf canvas | Dépendance externe, coord px only (pas ENU) | ⭐⭐⭐ |
| **SVG pur** | HTML natif, accessible | Performance dégradée >1000 éléments, complexe pour interactions | ⭐⭐ |
| **Pixi.js** | Ultra-performant WebGL | Over-engineering pour calpinage, runtime lourd | ⭐⭐ |

### 8.2 Recommandation : Three.js orthographic

**Raison principale** : unification des coordonnées. En Three.js ortho, les panneaux sont placés  
en coordonnées ENU identiques au rendu 3D. Le même `SolarScene3D` alimente les deux vues.  
Il n'y a plus de conversion px ↔ monde ↔ vue — une seule projection : la caméra ortho.

```typescript
// Vue 2D = caméra orthographique plongeante (top-down)
const camera = new THREE.OrthographicCamera(left, right, top, bottom, near, far);
camera.position.set(0, 0, maxHeight + 10);
camera.lookAt(0, 0, 0);
camera.up.set(0, 1, 0);  // Nord vers le haut de l'écran
```

**Migration** : les couches 2D (contour, pans, panneaux, obstacles, ridges) deviennent des meshes  
Three.js Z=0 rendus par la caméra orthographique. La texture satellite devient le `GroundPlaneTexture`.  
La caméra peut basculer perspective ↔ orthographique sans rechanger la scène.

### 8.3 Architecture rendu 2D cible

```typescript
// CalpinageCanvas2D.tsx
// Même renderer Three.js que le 3D, caméra ortho
// Layers = groupes Three.js (visibles/masqués selon contexte)

const scene2D = {
  groundPlane: GroundPlaneMesh,          // texture satellite
  contourLayer: ContourMesh,            // contour bâtiment
  facesLayer: FacesMeshGroup,           // pans colorés
  ridgesLayer: RidgeLineGroup,          // lignes structurantes
  panelsLayer: PanelQuadGroup,          // quads panneaux
  obstaclesLayer: ObstacleMeshGroup,    // emprises obstacles
  interactionLayer: GhostSlotGroup,     // preview placement
  selectionLayer: SelectionHighlight,   // sélection courante
}
```

---

## SECTION 9 — REFONTE RENDU 3D

### 9.1 Architecture Three.js cible (SolarScene3DViewer)

Le fichier `SolarScene3DViewer.tsx` (2777 lignes) est **déjà correct** dans sa structure.  
Les corrections sont ciblées :

```
SolarScene3DViewer.tsx — conservé, corrections ciblées
├── WebGLRenderer
│   ├── ✅ antialias: true
│   ├── ✅ shadowMap.enabled = true (TYPE: PCFSoftShadowMap)
│   ├── ❌ setSize() : ajouter ResizeObserver → correction P1.1
│   └── ✅ on-demand rendering (requestRender)
│
├── Scene Graph
│   ├── GroundPlane (texture satellite)
│   │   └── ✅ GroundPlaneTexture.tsx — câbler GroundPlaneImageData depuis store
│   ├── RoofMeshGroup
│   │   └── ✅ RoofPlanePatch3D → THREE.Mesh (matériau Phong)
│   ├── ObstacleGroup
│   │   └── ✅ RoofObstacleVolume3D → THREE.Mesh
│   ├── PanelGroup
│   │   └── ✅ PvPanelSurface3D.corners3D → THREE.Mesh (sur plan de pan — pas horizontal)
│   │       └── ❌ phase3Viewer place les panneaux Y=1 (horizontal) → supprimer
│   ├── ShadingOverlayGroup
│   │   └── Coloration panneau via PanelVisualShading
│   ├── SelectionGroup
│   └── GizmoGroup (déplacement 3D)
│
├── Caméra
│   ├── PerspectiveCamera (FOV 42°)
│   ├── OrbitControls
│   └── Transition smooth 2D→3D (interpolation quaternion + position)
│
└── Lumières
    ├── AmbientLight (intensity: 0.36)
    ├── DirectionalLight (intensity: 0.88, shadow map 1024)
    └── HemisphereLight (optionnel — qualité visuelle)
```

### 9.2 Corrections obligatoires rendu 3D

| Correction | Priorité | Impact |
|---|---|---|
| ResizeObserver → `renderer.setSize()` | P0 | Canvas 300×150 en prod |
| Câbler `GroundPlaneImageData` depuis store | P0 | Sol noir = inutilisable |
| `VITE_CALPINAGE_CANONICAL_3D=true` | P0 | Rien ne marche en prod |
| Panneaux sur plan du pan (pas horizontal Y=1) | P1 | Précision géométrique |
| Transition caméra 2D→3D | P2 | UX |

### 9.3 Export image 3D

```typescript
function exportScene3DImage(renderer: THREE.WebGLRenderer, width: number, height: number): string {
  renderer.setSize(width, height);
  renderer.render(scene, camera);
  return renderer.domElement.toDataURL("image/png");
}
```
Intégrer dans `exportSolarScene3d.ts` + inclure dans le PDF via `ExportSnapshot.scene3DImageDataUrl`.

---

## SECTION 10 — STRATÉGIE DE MIGRATION

### 10.1 Principes non-négociables

1. **Zéro breaking change en prod** : feature flag `VITE_CALPINAGE_NEW_ARCHITECTURE` contrôle tout
2. **Les études existantes rechargent** : `ExportSnapshot` V1 → V2 via migration automatique
3. **Rollback immédiat** : toggle feature flag = retour à l'état précédent en < 1 seconde
4. **Pas de réécriture from scratch** : extractions progressives depuis calpinage.module.js

### 10.2 Phases de migration

#### PHASE 0 — Correctifs immédiats (1 semaine) — SANS refonte architecture
```
P0.1 : Corriger Roof.scale type dans smartpitch/calpinage/store/types.ts
P0.2 : VITE_CALPINAGE_CANONICAL_3D=true en .env.production
P0.3 : Câbler GroundPlaneImageData dans Inline3DViewerBridge
P0.4 : Corriger mapBlockForPanelsHash (normalisation stable)
P0.5 : Supprimer calpinage.module.js.bak
```
**Risque** : faible — corrections ciblées, pas d'architecture changée  
**Validation** : smoke test Phase 3 sur étude ROUXEL

#### PHASE 1 — Store Zustand + types unifiés (2-3 semaines)
```
1.1 : Créer calpinageStore.ts (Zustand) avec l'interface CalpinageStore complète
1.2 : Implémenter legacyCalpinageStateAdapter.ts (lecture CALPINAGE_STATE → store)
      → Le store lit depuis window.CALPINAGE_STATE au démarrage
      → Le legacy continue d'écrire dans window
      → React UI lit UNIQUEMENT depuis le store (pas depuis window)
1.3 : Migrer CalpinageApp.tsx → lectures store uniquement
1.4 : Migrer Phase2Sidebar → store selectors
1.5 : Migrer Phase3Sidebar → store selectors
1.6 : Tests : reload integrity + parity 2D/3D (baseline avant migration)
```
**Risque** : moyen — double-écriture legacy+store pendant la transition  
**Rollback** : désactiver legacyCalpinageStateAdapter → retour lecture window directe

#### PHASE 2 — Extraction moteur placement PV (3-4 semaines)
```
2.1 : Extraire pvPlacementEngine depuis calpinage.module.js → engine/pvPlacementEngine/
2.2 : Extraire ghostSlots.ts (auto-placement)
2.3 : Extraire collisionCheck.ts
2.4 : Connecter les opérations panneau aux store actions
2.5 : Tests unitaires moteur placement (aucune dépendance DOM)
2.6 : Extraire interactionStateMachine → store.interactionState
```
**Risque** : élevé — le cœur du placement est dans 22 637 lignes non documentées  
**Stratégie** : extraire en copiant, pas en supprimant (legacy reste actif en parallèle)

#### PHASE 3 — Extraction géométrie toiture + heights (2-3 semaines)
```
3.1 : Extraire roofGeometryEngine/faceSolver.ts
3.2 : Extraire heightInterpolator.ts (Z resolution depuis ridges)
3.3 : Connecter RoofFaceDerived3D au store derived3DCache
3.4 : Valider tilt/azimuth parity avec legacy (écart toléré : 0.1°)
3.5 : Extraire WorldTransform depuis CALPINAGE_STATE.roof → store
```

#### PHASE 4 — Rendu 2D Three.js orthographic (4-6 semaines)
```
4.1 : CalpinageCanvas2D.tsx — GroundPlane + ContourLayer en Three.js ortho
4.2 : FacesLayer, RidgesLayer
4.3 : PanelsLayer (quads sur plan de pan)
4.4 : ObstaclesLayer
4.5 : InteractionLayer (ghost slots, snap, sélection)
4.6 : Playwright visual : screenshot baseline vs nouveau rendu
4.7 : Feature flag VITE_CALPINAGE_2D_CANVAS_V2 → activation progressive
```
**Risque** : le plus élevé de toutes les phases — entièrement nouveau  
**Mitigation** : A/B test en prod (flag par étude), ancien canvas en fallback

#### PHASE 5 — Schema V2 + migration reload (1 semaine)
```
5.1 : ExportSnapshot schemaVersion: "CALPINAGE_V2"
5.2 : migrateExportSnapshotV1ToV2() — migration automatique au chargement
5.3 : Correction panelsHash (serialization stable)
5.4 : Tests snapshot JSON : V1 → V2 → reload sans drift
```

#### PHASE 6 — Suppression legacy (après 3 mois de prod stable)
```
6.1 : Désactiver calpinage.module.js (feature flag VITE_CALPINAGE_NEW_ARCHITECTURE=true)
6.2 : Supprimer legacyCalpinageStateAdapter.ts
6.3 : Supprimer legacyWindowBridge.ts, legacyEventBridge.ts
6.4 : Supprimer calpinage.module.js
6.5 : Supprimer phase3Viewer.js
6.6 : Supprimer runtime/emitOfficialRuntimeStructuralChange.ts
6.7 : Supprimer runtime/canonical3DWorldContract.ts
```

---

## SECTION 11 — TESTS OBLIGATOIRES

### 11.1 Tests unitaires — Core géométrie

```
core/__tests__/geometryCore2d.test.ts
  ✅ pointInPolygon (triangle, carré, point sur bord, point hors)
  ✅ imagePxToWorldHorizontalM (north=0, north=90, north=45)
  ✅ worldHorizontalMToImagePx (inverse de imagePxToWorldHorizontalM)
  ✅ segmentIntersection (parallèles, croisés, colinéaires)
  ✅ polygonArea2D (sens direct et inverse)
  ✅ projectPointOnSegment2d

engine/__tests__/faceSolver.test.ts
  ✅ cornersWorld depuis polygon2DPx + worldTransform
  ✅ normal Newell (triangle, quadrilatère)
  ✅ tiltDeg = 0 pour pan horizontal
  ✅ tiltDeg = 30 pour pan incliné connu
  ✅ azimuthDeg = 180 pour pan plein Sud

engine/__tests__/heightInterpolator.test.ts
  ✅ Z interpolé depuis ridge constraint
  ✅ Z fallback = 0 si pas de hauteur
  ✅ Z bilinéaire entre deux ridges
```

### 11.2 Tests unitaires — Placement panneaux

```
engine/__tests__/pvPlacementEngine.test.ts
  ✅ createPanel → center dans le pan
  ✅ createPanel → center hors pan → erreur
  ✅ movePanel → collision → blocage
  ✅ movePanel → keepout zone → blocage
  ✅ freezePanel → movePanel ignoré
  ✅ ghostSlots → liste de slots valides (pas de collision)
  ✅ ghostSlots → respecte setbacks
  ✅ autoLayout → count exact pour surface donnée
```

### 11.3 Tests property-based — Invariants géométrie

```typescript
// fast-check
fc.property(
  fc.tuple(fc.integer(0,4000), fc.integer(0,3000)),  // centerPx
  fc.float(0.05, 0.5),                                // mpp
  fc.float(0, 360),                                   // northAngle
  (centerPx, mpp, north) => {
    const world = imagePxToWorldHorizontalM(centerPx[0], centerPx[1], mpp, north);
    const back = worldHorizontalMToImagePx(world.x, world.y, mpp, north);
    expect(back.xPx).toBeCloseTo(centerPx[0], 3);
    expect(back.yPx).toBeCloseTo(centerPx[1], 3);
  }
)
// Invariant : la projection image → monde → image est idempotente à ±0.001px
```

### 11.4 Tests snapshot JSON — Reload integrity

```
__tests__/reloadIntegrity.test.ts
  ✅ Sauvegarder ExportSnapshot V2 → recharger → panelsHash identique (drift=0)
  ✅ Charger ExportSnapshot V1 → migration → panelsHash stable
  ✅ Modifier un panneau → panelsHash change
  ✅ Modifier un pan → geometryHash change, panelsHash inchangé
  ✅ ExportSnapshot avec 0 panels → recharge proprement
  ✅ ExportSnapshot corrompu → erreur explicite, pas de crash silencieux
```

### 11.5 Tests parity 2D/3D

```
__tests__/parity2D3D.test.ts
  ✅ panel.centerPx → imagePxToWorldHorizontalM → panel.derived3D.centerWorld
     puis worldHorizontalMToImagePx → centerPx identique à ±0.001px
  ✅ RoofFace.polygon2DPx → cornersWorld → azimuthDeg calculé = azimuthDeg legacy (±0.1°)
  ✅ obstacle footprintWorldPts → projection image = obstacle.centerPx (±0.001px)
```

### 11.6 Tests Playwright visuels

```
playwright/__tests__/calpinage2D.spec.ts
  ✅ Phase 2 : screenshot de l'étude ROUXEL avec pans dessinés
  ✅ Phase 3 : screenshot Vue 2D avec panneaux posés
  ✅ Phase 3 : screenshot Vue 3D (après activation canonical3D)
  ✅ Drift badge : visible si hasPanelDrift=true
  ✅ Pas de drift badge : étude fraîche sans drift
```

### 11.7 Tests export

```
__tests__/exportSnapshot.test.ts
  ✅ buildPremiumShadingExport(normalized) → combined.totalLossPct présent
  ✅ ExportSnapshot sérialisé → parsé → structurellement identique
  ✅ serializeSolarScene3DStableSorted → même scène → même chaîne (déterminisme)
```

---

## SECTION 12 — LIVRABLE FINAL : DOCUMENT DE DÉCISION

### 12.1 Architecture actuelle en une ligne

> Un fichier JS de 22 637 lignes avec état global sur `window`, 3 ilôts React dans du DOM legacy,  
> et un pipeline 3D complet en TypeScript désactivé par défaut en production.

### 12.2 Architecture cible en une ligne

> Un store Zustand typé comme source unique de vérité, des moteurs purs injectables,  
> un rendu unifié Three.js (ortho 2D + perspective 3D), et une persistance schématisée avec migration.

---

### 12.3 Schéma des flux cibles

```
                     ┌──────────────────────────────────────┐
                     │          UTILISATEUR                 │
                     │   (clics, saisie, drag, touch)       │
                     └──────────────┬───────────────────────┘
                                    │ événements
                     ┌──────────────▼───────────────────────┐
                     │    RENDER 2D  ←──────→  RENDER 3D    │
                     │ Three.js ortho     Three.js persp     │
                     │    (caméra 2D)      (caméra 3D)      │
                     └──────────────┬───────────────────────┘
                                    │ actions typées
                     ┌──────────────▼───────────────────────┐
                     │       CALPINAGE STORE (Zustand)      │
                     │  vertices · faces · panels · shading │
                     │  obstacles · blocks · pvParams       │
                     └──┬─────────┬──────────┬─────────────┘
                        │         │          │
               ┌────────▼──┐  ┌───▼────┐  ┌─▼──────────────┐
               │ PLACEMENT  │  │ GEOM   │  │   SHADING      │
               │ ENGINE     │  │ ENGINE │  │   ENGINE       │
               │ (pur, TS)  │  │(pur,TS)│  │(near+far)      │
               └────────────┘  └────────┘  └────────────────┘
                        │         │          │
                     ┌──▼─────────▼──────────▼─────────────┐
                     │        PERSISTENCE LAYER             │
                     │  localStorage · API serveur futur   │
                     │  ExportSnapshot V2 · migration V1   │
                     └──────────────────────────────────────┘
```

---

### 12.4 Modules à créer

| Module | Rôle | Priorité |
|---|---|---|
| `store/calpinageStore.ts` | Store Zustand typé — source de vérité | P0 |
| `store/selectors/` | Selectors dérivés (pans d'une face, panneaux actifs…) | P0 |
| `store/actions/` | Actions typées (createPanel, movePan…) | P0 |
| `engine/pvPlacementEngine/` | Extraction moteur placement depuis module.js | P1 |
| `engine/roofGeometryEngine/` | Extraction solver géométrie | P1 |
| `render2d/CalpinageCanvas2D.tsx` | Rendu 2D Three.js orthographic | P2 |
| `persistence/exportSnapshotSerializer.ts` | Migration V1 → V2 | P1 |
| `adapters/legacyCalpinageStateAdapter.ts` | Bridge temporaire window → store | P1 |
| `adapters/legacyWindowBridge.ts` | Bridge window.* → store actions | P1 |

### 12.5 Modules à supprimer (fin de migration)

| Module | Raison | Quand |
|---|---|---|
| `legacy/calpinage.module.js` | 22 637 lignes — tout le code sera extrait | Phase 6 |
| `legacy/calpinage.module.js.bak` | Fichier backup mort | Immédiatement |
| `legacy/calpinage.module.d.ts` | Types stale du .js | Phase 6 |
| `phase3/phase3Viewer.js` | Remplacé par SolarScene3DViewer | Phase 6 |
| `smartpitch/calpinage/store/types.ts` | Doublon avec types canoniques (+ bug scale) | Phase 5 |
| `runtime/canonical3DWorldContract.ts` | Remplacé par WorldTransform dans store | Phase 5 |
| `runtime/emitOfficialRuntimeStructuralChange.ts` | Remplacé par Zustand subscription | Phase 5 |
| `runtime/calpinageRuntime.ts` (façade window) | Plus de window globals | Phase 6 |

### 12.6 Bridges temporaires (à supprimer en Phase 6)

| Bridge | Durée de vie | Rôle |
|---|---|---|
| `legacyCalpinageStateAdapter.ts` | Phases 1-5 | CALPINAGE_STATE → store |
| `legacyWindowBridge.ts` | Phases 1-5 | window.* → store actions |
| `legacyEventBridge.ts` | Phases 1-4 | DOM events → Zustand subscriptions |
| `VITE_CALPINAGE_CANONICAL_3D` flag | Jusqu'à Phase 6 | Active pipeline canonical3d |
| `VITE_CALPINAGE_2D_CANVAS_V2` flag | Phase 4-6 | Active nouveau rendu 2D |

### 12.7 Liste "DO NOT TOUCH" (stable — ne pas modifier)

```
canonical3d/types/                      ← Types cibles — déjà corrects
canonical3d/builder/worldMapping.ts     ← imagePxToWorldHorizontalM — correct
canonical3d/scene/officialSolarScene3DGateway.ts  ← Cache pattern correct
shading/shadingGovernance.ts            ← Gouvernance solide
shading/nearShadingTypes.ts             ← Contrats corrects
catalog/roofObstacleCatalog.ts          ← Catalogue métier stable
calpinageStorage.ts                     ← Scoping correct (à déplacer, pas modifier)
integration/                            ← Pipeline d'intégration — enrichir, pas casser
core/geometryCore2d.js                  ← Correct (migrer en .ts seulement)
```

### 12.8 Liste "DELETE LATER" (après validation prod)

```
legacy/calpinage.module.js              ← après Phase 6 complet
legacy/calpinage.module.js.bak         ← maintenant
phase3/phase3Viewer.js                  ← après Phase 4 validé
smartpitch/calpinage/store/types.ts     ← après Phase 5
runtime/canonical3DWorldContract.ts     ← après Phase 5
runtime/emitOfficialRuntimeStructuralChange.ts  ← après Phase 5
```

### 12.9 Durées estimées et risques

| Phase | Durée | Risque | Rollback |
|---|---|---|---|
| Phase 0 — Correctifs immédiats | 1 semaine | Faible | Feature flag |
| Phase 1 — Store Zustand | 2-3 semaines | Moyen | Désactiver adapter |
| Phase 2 — Extraction placement PV | 3-4 semaines | Élevé | Legacy reste actif |
| Phase 3 — Géométrie toiture | 2-3 semaines | Moyen | Legacy reste actif |
| Phase 4 — Rendu 2D Three.js | 4-6 semaines | Très élevé | Feature flag par étude |
| Phase 5 — Schema V2 | 1 semaine | Faible | Migration réversible |
| Phase 6 — Suppression legacy | 1 semaine | Faible (si phases 1-5 OK) | Tags git |
| **TOTAL** | **14-19 semaines** | | |

### 12.10 Ordre absolu des travaux

```
1. P0.5 : Supprimer calpinage.module.js.bak  [30 min]
2. P0.1 : Fix Roof.scale type                [30 min]
3. P0.2 : VITE_CALPINAGE_CANONICAL_3D=true   [5 min]
4. P0.3 : Câbler GroundPlaneImageData        [2-4h]
5. P0.4 : Fix mapBlockForPanelsHash          [2-4h]
   ─── [Smoke test prod étude ROUXEL] ───────
6. Phase 1 : Store Zustand
7. Phase 2 : Extraction placement PV
8. Phase 3 : Géométrie toiture
9. Phase 5 : Schema V2  (avant Phase 4 — migrations d'abord)
10. Phase 4 : Rendu 2D
11. Phase 6 : Suppression legacy
```

---

*Document produit après audit complet du module calpinage (510 fichiers, 22 637 lignes legacy).  
Aucun code modifié. Décision architecture uniquement.*
