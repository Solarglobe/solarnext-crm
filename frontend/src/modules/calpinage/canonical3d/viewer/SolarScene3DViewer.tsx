/**
 * Viewer 3D officiel SolarNext — source de vérité rendu 3D pour le calpinage.
 *
 * Principe : la 3D dépend du modèle géométrique canonique (SolarScene3D), pas du rendu 2D legacy.
 * Pipeline cible : CALPINAGE_STATE → géométrie canonique (roof / planes / obstacles / panels) → ce viewer.
 *
 * Ne pas étendre phase3Viewer.js (LEGACY gelé) pour de nouvelles features ; tout développement 3D ici.
 *
 * Prompt 30 — Seul ce viewer (avec `SolarScene3D`) constitue la **vérité rendu 3D produit** ; le legacy n’est
 * ni référence de validation ni fallback silencieux (`docs/architecture/legacy-3d-fallback-sunset.md`).
 *
 * Convention axes / unités : `docs/architecture/3d-world-convention.md` — `canonical3d/world/unifiedWorldFrame.ts` + `core/worldConvention.ts`.
 * Trajectoire produit (preview legacy → ce viewer) : `docs/architecture/3d-convergence-plan.md`.
 * Contrat canonical → viewer (lecture seule, pas de recalcul métier) : `docs/architecture/canonical-pipeline.md`.
 *
 * Coloration panneaux : lecture `panelVisualShadingByPanelId` (runtime `shading.perPanel`) ou, à défaut,
 * agrégat déjà présent sur `nearShadingSnapshot` — aucun moteur ombrage dans le viewer.
 *
 * Mode `inspectMode` : sélection clic + panneau métadonnées — lecture seule, sauf édition Z sommet si
 * `enableRoofVertexZEdit` + `onRoofVertexHeightCommit` (mutation côté parent, phase B4), et XY si
 * `enableRoofVertexXYEdit` + `onRoofVertexXYCommit` (phase B5).
 *
 * Mode `panSelection3DMode` : sélection locale pan / sommet (surbrillance + marqueur) — pas d’écriture interne ;
 * mêmes hooks B4 / B5 possibles via les props ci-dessus.
 *
 * Prompt 34 — `cameraViewMode` : même `scene`, projection plan orthographique (dessus) ou perspective (orbite).
 *
 * Pass 4–5 — pose PV 3D : sonde `window.__CALPINAGE_3D_PV_PLACE_PROBE__` ou produit `pvLayout3DInteractionMode`
 * (`__CALPINAGE_3D_PV_LAYOUT_MODE__` + phase `PV_LAYOUT`) — clic toiture → `tryCommitPvPlacementFrom3dRoofHit` ;
 * clic panneau → manipulation (finalize = chaîne Phase 3 / `pvSyncSaveRender`).
 *
 * Dev — debug maillage extensions (chien assis) : **Shift+Alt+E** cycle fil de fer / normales faces sur `extensionVolumes`
 * (voir `roofExtensions/VIEWER_VALIDATION_P3.md`).
 */

import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";
import { Grid, Outlines, StatsGl } from "@react-three/drei";
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useId,
  useRef,
  useState,
  type PointerEvent as ReactPointerEvent,
} from "react";
import { flushSync } from "react-dom";
import * as THREE from "three";
import type { OrbitControls as OrbitControlsImpl } from "three-stdlib";

import { isCalpinage3DRuntimeDebugEnabled } from "../../core/calpinage3dRuntimeDebug";
import { isValidBuildingHeightM } from "../../core/heightResolver";
import type { RoofVertexHeightEdit } from "../../runtime/applyRoofVertexHeightEdit";
import type { StructuralHeightEdit } from "../../runtime/applyStructuralRidgeHeightEdit";
import {
  readCalpinageStructuralHeightM,
  resolveNearestStructuralHeightSelectionFromImagePx,
  type LegacyStructuralHeightSelection,
} from "../../runtime/structuralRidgeHeightSelection";
import { emitRoofVertexZTelemetry, generateRoofZDragSessionId } from "../../runtime/roofVertexZEditTelemetry";
import {
  ROOF_VERTEX_XY_EDIT_DEFAULT_MAX_DISPLACEMENT_PX,
  type RoofVertexXYEdit,
} from "../../runtime/applyRoofVertexXYEdit";
import { worldHorizontalMToImagePx } from "../builder/worldMapping";
import {
  computeRoofShellAlignmentDiagnostics,
  formatRoofShellAlignmentOneLine,
} from "../diagnostics/computeRoofShellAlignmentDiagnostics";
import type { SolarScene3D } from "../types/solarScene3d";
import {
  resolveViewerReliabilityState,
  type ViewerReliabilityState,
} from "./viewerReliabilityState";
import { ViewerPerformanceMonitor } from "./ViewerPerformanceMonitor";
import {
  clampViewerDpr,
  isViewerQualityManual,
  readViewerDeviceCapabilitySignals,
  resolveInitialViewerQualityTier,
  resolveViewerQualityTransition,
  VIEWER_QUALITY_PROFILES,
  type ViewerFrameWindowStats,
  type ViewerQualityMode,
  type ViewerQualityProfile,
  type ViewerQualityTier,
} from "./viewerQualityProfile";
import { ViewerLighting } from "./ViewerLighting";
import {
  CanvasQualityApplier,
  ViewerEnvironment,
  ViewerPostProcessing,
} from "./ViewerRenderingEffects";
import { ViewerRenderInvalidator } from "./viewerRenderInvalidation";
import { ViewerReliabilityOverlay } from "./ViewerReliabilityOverlay";
import { DebugSceneHelpers, DebugStatsOverlay } from "./ViewerDebugTools";
import {
  PvLayout3dScreenOverlayProjector,
  PvLayout3dSvgOverlay,
  type PvLayout3dHandleUi,
  type PvLayout3dScreenOverlayState,
} from "./pvLayout3dScreenOverlay";
import { exposeViewerDebugFacade } from "./viewerDebugFacade";
import { keepoutHatchGeometry, keepoutCornerMarksGeometry } from "./keepout3DGeometry";

import {
  computeSolarSceneBoundingBox,
  extendBoundingBoxWithSatelliteImageFootprint,
} from "./solarSceneBounds";
import { CameraFramingRig } from "./CameraFramingRig";
import { DynamicCamera } from "./DynamicCamera";
import { getDepthOffset } from "./DepthRegistry";
import { useViewerGestures } from "./useViewerGestures";
import { logIfGeometryNormalsSuspect } from "./geometryNormalsAudit";
import { ShadingLegend3D } from "./ShadingLegend3D";
import {
  SceneInspectionPanel3D,
  type RoofHeightAssistantUiModel,
  type RoofModelingHistoryUiModel,
  type StructuralRidgeHeightEditUiModel,
} from "./SceneInspectionPanel3D";
import {
  buildPickProvenance2DViewModel,
  type CalpinagePanProvenanceEntry,
} from "./inspection/buildPickProvenance2DViewModel";
import { buildSceneInspectionViewModel } from "./inspection/buildSceneInspectionViewModel";
import {
  INSPECT_USERDATA_KEY,
  type SceneInspectionSelection,
  type SceneInspectUserData,
  type ScenePickHit,
} from "./inspection/sceneInspectionTypes";
import { pickInspectableIntersection } from "./inspection/pickInspectableIntersection";
import { pickSceneHitForRoofVertexModeling } from "./inspection/pickRoofVertexModelingPick";
import { RoofVertexZDragController, type RoofZDragSession } from "./RoofVertexZDragController";
import { worldZFromPointerOnVerticalThroughXY } from "./roofVertexVerticalPointerMath";
import {
  GROUND_PLANE_CONTACT_OFFSET_M,
  VIEWER_CAMERA_FOV_DEG,
  VIEWER_DEFAULT_CAMERA_OFFSET,
} from "./viewerConstants";
import {
  applyCanonicalViewerGlOutput,
  getViewerPanVertexSelectionMarkerGeometry,
  SOLARNEXT_3D_PREMIUM_THEME,
  viewerFallbackGridProps,
  VIEWER_INSPECT_OUTLINE_HEX,
  VIEWER_OUTLINE_THICKNESS_FACTOR,
  VIEWER_SHELL_MESH_HEX,
} from "./viewerVisualTokens";
import {
  buildingShellGeometry,
  extensionMiniRoofLineGeometries,
  extensionVolumeGeometry,
  obstacleVolumeGeometry,
  panelQuadGeometry,
  roofClosureFacadeGeometry,
  roofEdgesLineGeometry,
  roofPatchGeometry,
  roofRidgesLineGeometry,
  volumeMeshFaceNormalsDebugLineGeometry,
} from "./solarSceneThreeGeometry";
import { buildPremiumHouse3DScene } from "./premium/buildPremiumHouse3DScene";

import { getPvPanelTexture } from "../pvPanels/buildPvPanelTexture";
import {
  PV_PANEL_GHOST_FILL_LIFT_M,
  PV_PANEL_GHOST_LINE_LIFT_M,
  PV_PANEL_LIVE_FILL_LIFT_M,
  PV_PANEL_LIVE_LINE_LIFT_M,
  PV_PANEL_RENDER_LIFT_M,
} from "../pvPanels/pvPanelRenderConfig";
import type { PremiumHouse3DSceneAssembly } from "./premium/premiumHouse3DSceneTypes";
import { PremiumGeometryTrustStripe } from "./premium/PremiumGeometryTrustStripe";
import type { PremiumHouse3DViewMode } from "./premium/premiumHouse3DViewModes";
import { buildPremiumObstacleAssets } from "./obstacles/premiumObstacleAssets";
import {
  resolveRoofMissingHeightAlerts,
} from "./roofTruthBadges";
import {
  MissingHeightAlertsOverlay,
  MultiPanDiagnosticsOverlay,
  RoofTruthBadgesOverlay,
  RoofTruthBadgesProjector,
  type RoofTruthBadgeScreenModel,
} from "./ViewerWarningOverlays";
import { ObstaclesMesh, type ObstacleDetailGeometries } from "./ObstaclesMesh";
import { RoofPansMesh } from "./RoofPansMesh";
import { PvPanelsLayer } from "./PvPanelsLayer";
import {
  inspectData,
  isInspectSelected,
  r3fGl,
  roofModelingSkipOccluderRaycast,
} from "./viewerHelpers";
import { PanelTooltip3D } from "./overlays/PanelTooltip3D";
import { PowerIndicator3D } from "./overlays/PowerIndicator3D";
import { MagneticGrid3D } from "./overlays/MagneticGrid3D";
import {
  computeInstalledPvPower,
  resolveSelectedPvModulePower,
} from "../../power/installedPvPower";
import {
  boundsLifecycleSnapshot,
  cameraLifecycleSnapshot,
  readViewerLifecycleDiagnostics,
  resetViewerLifecycleDiagnostics,
  updateViewerLifecycleDiagnostics,
  type ViewerLifecycleDiagnostics,
} from "./viewerLifecycleDiagnostics";

// ─── HorizonMaskRing3D ────────────────────────────────────────────────────────
// Visualise le masque d'horizon lointain comme une couronne LineLoop 3D.
// Chaque point = { azimuth 0°=Nord, elevation_deg } → position Three.js (X=Est, Y=Sud, Z=Up).
// Rayon fixe 500 m (HORIZON_RING_RADIUS_M), hauteur Y = tan(elevDeg°) × rayon.

const HORIZON_RING_RADIUS_M = 500;
const HORIZON_RING_COLOR = 0xff6b35; // orange vif
const HORIZON_RING_OPACITY = 0.6;

interface HorizonMaskPoint3D {
  az: number;  // azimut [0–360°]
  elev: number; // élévation [degrés]
}

interface HorizonMaskRing3DProps {
  mask: HorizonMaskPoint3D[];
  center: THREE.Vector3;
}

function HorizonMaskRing3D({ mask, center }: HorizonMaskRing3DProps) {
  const geometry = useMemo(() => {
    if (!mask || mask.length === 0) return null;
    const positions: number[] = [];
    // Convention axes : X=Est, Y=-Sud (Y=Nord positif), Z=Up (selon worldConvention)
    // Azimut météo : 0=Nord, 90=Est, 180=Sud, 270=Ouest → angle depuis Y+ dans sens horaire vu du dessus
    for (const pt of mask) {
      // C1-FIX — Guard NaN / Infinity : un azimut ou une élévation non-finie produit un
      // vertex NaN dans le BufferGeometry. Avec depthTest=false, cette ligne NaN traverse
      // toute la scène (origine GPU → infini) et reste toujours visible quelle que soit la
      // caméra. Un seul point corrompu suffit à générer la "ligne géante sur la toiture".
      if (
        typeof pt.az !== "number" || !isFinite(pt.az) ||
        typeof pt.elev !== "number" || !isFinite(pt.elev)
      ) continue;
      const azRad = (pt.az * Math.PI) / 180;
      // X = R × sin(az)  (Est positif)
      // Y = -R × cos(az) (Sud positif = -Y dans convention ENU où Y=Nord)
      // Z = R × tan(elev)
      const elevRad = (Math.max(0, pt.elev) * Math.PI) / 180;
      const x = center.x + HORIZON_RING_RADIUS_M * Math.sin(azRad);
      const y = center.y - HORIZON_RING_RADIUS_M * Math.cos(azRad);
      const z = center.z + HORIZON_RING_RADIUS_M * Math.tan(elevRad);
      positions.push(x, y, z);
    }
    // Fermer la boucle en répétant le premier point
    if (positions.length >= 3) {
      positions.push(positions[0], positions[1], positions[2]);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    return geo;
  }, [mask, center]);

  // Dispose propre : libère la mémoire GPU quand mask/center changent ou au démontage.
  // Sans ce cleanup, chaque changement de mask alloue une nouvelle BufferGeometry
  // sans libérer l'ancienne (fuite GPU garantie).
  useEffect(() => () => { geometry?.dispose(); }, [geometry]);

  if (!geometry) return null;

  return (
    <lineLoop geometry={geometry}>
      <lineBasicMaterial
        color={HORIZON_RING_COLOR}
        transparent
        opacity={HORIZON_RING_OPACITY}
        depthTest={false}
        linewidth={2}
      />
    </lineLoop>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

function ViewerLifecycleFrameProbe({
  sceneAttached,
  onDiagnostics,
}: {
  readonly sceneAttached: boolean;
  readonly onDiagnostics: (diagnostics: ViewerLifecycleDiagnostics) => void;
}) {
  const camera = useThree((s) => s.camera);
  const gl = useThree((s) => s.gl);

  useEffect(() => {
    const next = updateViewerLifecycleDiagnostics({
      canvasMounted: true,
      sceneAttached,
      cameraInitialized: true,
      webglInitialized: true,
      camera: cameraLifecycleSnapshot(camera),
      canvasWidth: gl.domElement.width,
      canvasHeight: gl.domElement.height,
    });
    onDiagnostics(next);
  }, [camera, gl, onDiagnostics, sceneAttached]);

  useEffect(() => {
    const canvas = gl.domElement;
    const onLost = (event: Event) => {
      event.preventDefault();
      const next = updateViewerLifecycleDiagnostics({
        webglContextLost: true,
        webglContextRestored: false,
        firstFrameRendered: false,
      });
      onDiagnostics(next);
    };
    const onRestored = () => {
      const next = updateViewerLifecycleDiagnostics({
        webglContextLost: false,
        webglContextRestored: true,
        firstFrameRendered: false,
      });
      onDiagnostics(next);
    };
    canvas.addEventListener("webglcontextlost", onLost);
    canvas.addEventListener("webglcontextrestored", onRestored);
    return () => {
      canvas.removeEventListener("webglcontextlost", onLost);
      canvas.removeEventListener("webglcontextrestored", onRestored);
    };
  }, [gl, onDiagnostics]);

  useFrame(() => {
    const prev = readViewerLifecycleDiagnostics();
    const next = updateViewerLifecycleDiagnostics({
      canvasMounted: true,
      sceneAttached,
      firstFrameRendered: true,
      frameCount: prev.frameCount + 1,
      cameraInitialized: true,
      webglInitialized: true,
      canvasWidth: gl.domElement.width,
      canvasHeight: gl.domElement.height,
      camera: cameraLifecycleSnapshot(camera),
    });
    if (
      prev.firstFrameRendered !== next.firstFrameRendered ||
      prev.viewerReady !== next.viewerReady ||
      prev.lastBlockReason !== next.lastBlockReason ||
      next.frameCount <= 2
    ) {
      onDiagnostics(next);
    }
  }, 10);

  return null;
}

import { PREMIUM_HOUSE_3D_VIEW_MODES } from "./premium/premiumHouse3DViewModes";
import type { CanonicalHouse3DValidationReport } from "../validation/canonicalHouse3DValidationModel";
import {
  GroundPlaneTexture,
  useDataUrlTexture,
  applyTextureCropToMatch2DCanvas,
  type GroundPlaneImageData,
} from "./GroundPlaneTexture";
import { DebugXYAlignmentOverlay } from "./DebugXYAlignmentOverlay";
import { blendPvSurfaceColor, premiumTintHexForQualityScore } from "./visualShading/premiumVisualShadingColors";
import {
  getEffectivePanelVisualShading,
  sceneHasAnyPanelVisualShadingData,
} from "./visualShading/effectivePanelVisualShading";
import { logVisualShadingDevDiagnosticsOnce } from "./visualShading/logVisualShadingDevDiagnostics";
import {
  DEFAULT_CAMERA_VIEW_MODE,
  type CameraViewMode,
} from "./cameraViewMode";
import { imagePointToWorld } from "../world/imageToWorld";
import { worldPointToImage } from "../world/worldToImage";
import { tryCommitPvPlacementFrom3dRoofHit } from "../../runtime/pvPlacementFrom3dWorldHit";
import {
  addPvPanelFrom3dImagePoint,
  applyPvMoveLiveFrom3d,
  applyPvTransformLiveFrom3d,
  beginPvRotateFrom3d,
  beginPvMoveFrom3d,
  clearPvSelectionFrom3d,
  cancelPvMoveFrom3d,
  hitTestPvBlockPanelFromImagePoint,
  readPvLayout3dOverlayState,
  removePvPanelFrom3d,
  removeSelectedPvPanelFrom3d,
  selectPvBlockFrom3d,
  type PvLayout3dOverlayState,
} from "../../runtime/pvPlacement3dProduct";
import { createCommandBus } from "../../commands/commandBus";
import type { CommandBus } from "../../commands/commandBus";
import { movePvPanelHandler } from "../../commands/handlers/movePvPanelHandler";
import { PvLayout3dDragController } from "./PvLayout3dDragController";
import { usePvPanelDrag } from "./usePvPanelDrag";
import { useRoofVertexDrag } from "./useRoofVertexDrag";
import { useCalpinageStore } from "../../store/calpinageStore";
import { useCalpinageFeatures } from "../../features/CalpinageFeatureContext";
import {
  compute3DRuntimeVerdict,
  dump3DRuntimeViewerGeoCompare,
  getLastAutopsySnapshot,
  log3DRuntimeVerdictFinal,
  type AutopsyLegacyRoofPath,
} from "../dev/runtime3DAutopsy";
import { diffSolarScene3D } from "../scene/diffSolarScene3D";

export interface SolarScene3DViewerProps {
  /**
   * Scène canonique `SolarScene3D` — **ou** `runtimeScene` si vous préférez ce nom côté appelant.
   * Au moins l’un des deux doit être fourni.
   */
  readonly scene?: SolarScene3D;
  /** Alias de `scene` (même type). Si `scene` est défini, il prime. */
  readonly runtimeScene?: SolarScene3D;
  readonly reliabilityState?: ViewerReliabilityState;
  readonly className?: string;
  readonly height?: number | string;
  readonly showRoof?: boolean;
  /** Badges produit par pan : Mesuré / Déduit / Générique / Incohérent. */
  readonly showRoofTruthBadges?: boolean;
  /** Alerte compacte quand un pan utilise une hauteur moyenne / par défaut. */
  readonly showMissingHeightAlerts?: boolean;
  /** Diagnostic des jonctions multi-pans avant pose PV. Opt-in: trop verbeux pour la phase 3 produit. */
  readonly showMultiPanDiagnostics?: boolean;
  readonly showRoofEdges?: boolean;
  readonly showObstacles?: boolean;
  readonly showExtensions?: boolean;
  readonly showPanels?: boolean;
  /** Teinte panneaux selon shading déjà connu (runtime / snapshot scène). */
  readonly showPanelShading?: boolean;
  /** Légende discrète (masquée si `showPanelShading` est false). */
  readonly showShadingLegend?: boolean;
  /**
   * Inspection clic (pan / panneau / obstacle / extension) + panneau latéral — lecture seule.
   * `false` : aucune surcharge UX, pas de sélection.
   */
  readonly inspectMode?: boolean;
  /**
   * Surbrillance locale pan ou sommet de pan au clic (`ScenePickHit` roof_* uniquement).
   * État `selectedHit` interne au viewer — pas de persistance CRM / calpinage.
   */
  readonly panSelection3DMode?: boolean;
  /**
   * Snapshot `CALPINAGE_STATE.pans` (id + polygonPx) pour le panneau provenance 2D — lecture seule.
   */
  readonly calpinagePansForProvenance?: ReadonlyArray<CalpinagePanProvenanceEntry>;
  readonly showSun?: boolean;
  readonly sunDirectionIndex?: number;
  /** Affiche axes ENU, bbox filaire et stats scène (vérification orientation / cadrage). */
  readonly showDebugOverlay?: boolean;
  /**
   * Overlay rouge (roof.roofPans → monde) vs vert (mesh au sol) — preuve visuelle alignement réel.
   * Peut être activé seul sans tout le debug (`__CALPINAGE_3D_XY_OVERLAY__` côté bridge).
   */
  readonly showXYAlignmentOverlay?: boolean;
  /**
   * Image satellite / orthophoto capturée en 2D — projetée comme fond plan horizontal.
   * Positionnement dérivé de `scene.worldConfig` (metersPerPixel + northAngleDeg).
   */
  readonly groundImage?: GroundPlaneImageData;
  /**
   * Runtime CALPINAGE_STATE brut — overlay XY debug + **aperçu live drag Z** (clone JSON + rebuild scène, sans commit).
   */
  readonly debugRuntime?: unknown;
  /**
   * Puissance du module sélectionné/snapshot (mono-module scène).
   * Le viewer n'est pas autorisé à estimer une puissance depuis la surface panneau.
   */
  readonly selectedModulePowerWc?: number | null;
  readonly cameraViewMode?: CameraViewMode;
  readonly onCameraViewModeChange?: (mode: CameraViewMode) => void;
  readonly defaultCameraViewMode?: CameraViewMode;
  readonly showCameraViewModeToggle?: boolean;
  /** Mode lecture premium (Prompt 10) — matériaux, arêtes, disclosure validation. */
  readonly premiumViewMode?: PremiumHouse3DViewMode;
  readonly onPremiumViewModeChange?: (mode: PremiumHouse3DViewMode) => void;
  /** Rapport `validateCanonicalHouse3DGeometry` — honnêteté géométrique sans recalcul. */
  readonly geometryValidationReport?: CanonicalHouse3DValidationReport | null;
  /** Surcharge tests / story : contourne `buildPremiumHouse3DScene`. */
  readonly premiumAssemblyOverride?: PremiumHouse3DSceneAssembly | null;
  /**
   * Barre / texte de confiance géométrique.
   * `undefined` : affiché si rapport fourni ou `premiumViewMode === "validation"`.
   */
  readonly showPremiumGeometryTrustStripe?: boolean;
  /** Toolbar modes premium (dev / QA). */
  readonly showPremiumViewModeToolbar?: boolean;
  /**
   * Phase B4 — édition Z d’un sommet de pan (mutation `state.pans` côté parent après commit).
   * Activer avec `window.__CALPINAGE_3D_VERTEX_Z_EDIT__` dans le bridge inline.
   */
  readonly enableRoofVertexZEdit?: boolean;
  readonly onRoofVertexHeightCommit?: (edit: RoofVertexHeightEdit) => void;
  /**
   * Phase B5 — édition XY d’un sommet (`polygonPx`), clamp px + validation polygone simple.
   * Activer avec `window.__CALPINAGE_3D_VERTEX_XY_EDIT__` dans le bridge inline.
   */
  readonly enableRoofVertexXYEdit?: boolean;
  readonly onRoofVertexXYCommit?: (edit: RoofVertexXYEdit) => void;
  /** Phase B7 — undo/redo `state.pans` (mémoire, pas de disque). */
  readonly roofModelingHistory?: RoofModelingHistoryUiModel | null;
  /**
   * Pass 3 — clic toiture ou ligne de faîtage → point structurel (contour / faîtage / trait) le plus proche en px image,
   * puis `applyHeightToSelectedPoints` legacy. Désactivé par défaut (`CalpinageApp` / `localStorage` `calpinage_3d_ridge_h`).
   */
  readonly enableStructuralRidgeHeightEdit?: boolean;
  readonly onStructuralRidgeHeightCommit?: (edit: StructuralHeightEdit) => void;
  readonly roofHeightAssistant?: RoofHeightAssistantUiModel | null;
  /**
   * Pass 5 — interaction pose / déplacement PV en 3D (phase `PV_LAYOUT`, vue 3D, flag `__CALPINAGE_3D_PV_LAYOUT_MODE__`).
   * Même chaîne legacy que le 2D (`pvSyncSaveRender`).
   */
  readonly pvLayout3DInteractionMode?: boolean;
  /**
   * Appelé immédiatement après `finalizePvMoveFrom3d` (commit déplacement/rotation bloc PV).
   * Le bridge doit invalider le cache gateway et déclencher un rebuild 3D sans attendre le RAF
   * de pvSyncSaveRender — évite le panneau fantôme à l'ancienne position pendant le délai RAF.
   */
  readonly onPanelMoveCommit?: () => void;
  /**
   * Active les effets postprocessing (SMAA + Vignette, Bloom si flag canonical3D ON).
   * Désactiver si le GPU cible ne supporte pas les FBO multiples. Défaut : true.
   */
  readonly enablePostProcessing?: boolean;
  /** Overlay StatsGl réel, opt-in debug/test uniquement. */
  readonly showStatsGl?: boolean;
  /** Phase 5 — qualité graphique adaptative. Défaut AUTO, pilotable en dev via window.__CALPINAGE_3D_PERF__. */
  readonly qualityMode?: ViewerQualityMode;
  readonly onQualityModeChange?: (mode: ViewerQualityMode) => void;
  /**
   * Masque d'horizon lointain (far shading) — list { az, elev } depuis GET /api/horizon-mask.
   * Si fourni, affiche une couronne LineLoop orange (rayon 500 m) dans la scène 3D.
   * null / undefined = pas de visualisation.
   */
  readonly horizonMask?: ReadonlyArray<{ az: number; elev: number }> | null;
}

// Light multiplier: the Canvas texture already carries the dark PV cell color.
const PREMIUM_PV_SURFACE_HEX = new THREE.Color("#d8e8f8").getHex();
const PREMIUM_PV_EMISSIVE_HEX = new THREE.Color(SOLARNEXT_3D_PREMIUM_THEME.pv.liveEmissive).getHex();
const PREMIUM_PV_SELECTED_FILL = SOLARNEXT_3D_PREMIUM_THEME.pv.selectedFill;
const PREMIUM_PV_LIVE_FILL = SOLARNEXT_3D_PREMIUM_THEME.pv.liveFill;
const PREMIUM_PV_INVALID_FILL = SOLARNEXT_3D_PREMIUM_THEME.pv.invalidFill;
const PV3D_OVERLAY_PANEL_FILL = "#0d1726";
const PV3D_OVERLAY_PANEL_EDGE = "#526b7d";
const PV3D_OVERLAY_PANEL_EMISSIVE = "#07101d";
const PV3D_SAFE_ZONE_LINE = SOLARNEXT_3D_PREMIUM_THEME.safeZone.line;
const PV3D_GHOST_VALID_FILL = SOLARNEXT_3D_PREMIUM_THEME.ghost.validFill;
const PV3D_GHOST_VALID_LINE = SOLARNEXT_3D_PREMIUM_THEME.ghost.validLine;
const PV3D_GHOST_AUTOFILL_FILL = SOLARNEXT_3D_PREMIUM_THEME.ghost.autofillFill;
const PV3D_GHOST_AUTOFILL_LINE = SOLARNEXT_3D_PREMIUM_THEME.ghost.autofillLine;
const PV3D_GHOST_EXCLUDED_FILL = SOLARNEXT_3D_PREMIUM_THEME.ghost.excludedFill;
const PV3D_GHOST_EXCLUDED_LINE = SOLARNEXT_3D_PREMIUM_THEME.ghost.excludedLine;
const PV3D_GHOST_INVALID_FILL = SOLARNEXT_3D_PREMIUM_THEME.ghost.invalidFill;
const PV3D_GHOST_INVALID_LINE = SOLARNEXT_3D_PREMIUM_THEME.ghost.invalidLine;


function volumeLoopLineGeometry(points: readonly THREE.Vector3[]): THREE.BufferGeometry | null {
  if (points.length < 3) return null;
  const positions: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function volumeAllEdgeLineGeometry(vol: SolarScene3D["obstacleVolumes"][number], lift = 0.01): THREE.BufferGeometry | null {
  if (!vol.edges.length || !vol.vertices.length) return null;
  const positions: number[] = [];
  for (const edge of vol.edges) {
    const a = vol.vertices[edge.vertexAIndex]?.position;
    const b = vol.vertices[edge.vertexBIndex]?.position;
    if (!a || !b) continue;
    positions.push(a.x, a.y, a.z + lift, b.x, b.y, b.z + lift);
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function volumeRingAt(vol: SolarScene3D["obstacleVolumes"][number], t: number, lift = 0.006): THREE.Vector3[] {
  const n = vol.footprintWorld.length;
  if (n < 3 || vol.vertices.length < n * 2) return [];
  return Array.from({ length: n }, (_, i) => {
    const base = vol.vertices[i]!.position;
    const top = vol.vertices[i + n]!.position;
    return new THREE.Vector3(
      base.x + (top.x - base.x) * t,
      base.y + (top.y - base.y) * t,
      base.z + (top.z - base.z) * t + lift,
    );
  });
}

function scaleRingFromCenter(points: readonly THREE.Vector3[], scale: number): THREE.Vector3[] {
  if (points.length === 0 || scale === 1) return [...points];
  const center = points.reduce((sum, pnt) => sum.add(pnt), new THREE.Vector3()).multiplyScalar(1 / points.length);
  return points.map((pnt) => new THREE.Vector3(
    center.x + (pnt.x - center.x) * scale,
    center.y + (pnt.y - center.y) * scale,
    pnt.z,
  ));
}

function volumeTopCapGeometry(
  vol: SolarScene3D["obstacleVolumes"][number],
  lift = 0.014,
  scale = 1,
): THREE.BufferGeometry | null {
  const top = volumeRingAt(vol, 1, lift);
  if (top.length < 3) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const pnt of scaleRingFromCenter(top, scale)) positions.push(pnt.x, pnt.y, pnt.z);
  for (let i = 1; i < top.length - 1; i++) indices.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function chimneyFlueOpeningGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  if (vol.kind !== "chimney") return null;
  return volumeTopCapGeometry(vol, 0.058, isRoundChimneyVolume(vol) ? 0.48 : 0.42);
}

function volumePlanMetrics(vol: SolarScene3D["obstacleVolumes"][number]): {
  readonly center: THREE.Vector3;
  readonly minRadius: number;
  readonly maxRadius: number;
  readonly bottomZ: number;
  readonly topZ: number;
} | null {
  const n = vol.footprintWorld.length;
  if (n < 3 || vol.vertices.length < n * 2) return null;
  const base = Array.from({ length: n }, (_, i) => {
    const p = vol.vertices[i]!.position;
    return new THREE.Vector3(p.x, p.y, p.z);
  });
  const top = Array.from({ length: n }, (_, i) => {
    const p = vol.vertices[i + n]!.position;
    return new THREE.Vector3(p.x, p.y, p.z);
  });
  const center = base.reduce((sum, p) => sum.add(new THREE.Vector3(p.x, p.y, p.z)), new THREE.Vector3()).multiplyScalar(1 / n);
  let minRadius = Infinity;
  let maxRadius = 0;
  for (const p of base) {
    const d = Math.hypot(p.x - center.x, p.y - center.y);
    minRadius = Math.min(minRadius, d);
    maxRadius = Math.max(maxRadius, d);
  }
  const bottomZ = Math.min(...base.map((p) => p.z));
  const topZ = Math.max(...top.map((p) => p.z));
  return {
    center: new THREE.Vector3(center.x, center.y, (bottomZ + topZ) * 0.5),
    minRadius: Number.isFinite(minRadius) ? minRadius : maxRadius,
    maxRadius,
    bottomZ,
    topZ,
  };
}

function isRoundChimneyVolume(vol: SolarScene3D["obstacleVolumes"][number]): boolean {
  const visualKey = String(vol.visualKey ?? "").toLowerCase();
  return vol.kind === "chimney" && (visualKey.includes("chimney_round") || vol.footprintWorld.length >= 8);
}

function cylinderLikeGeometry(
  center: THREE.Vector3,
  radius: number,
  height: number,
  segments: number,
  zBase: number,
): THREE.BufferGeometry | null {
  if (radius <= 0 || height <= 0) return null;
  const geo = new THREE.CylinderGeometry(radius, radius, height, segments, 1, false);
  geo.rotateX(Math.PI / 2);
  geo.translate(center.x, center.y, zBase + height * 0.5);
  return geo;
}

function roundChimneyBodyGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const metrics = volumePlanMetrics(vol);
  if (!metrics) return null;
  const radius = Math.max(0.08, metrics.maxRadius * 0.82);
  const height = Math.max(0.2, metrics.topZ - metrics.bottomZ);
  return cylinderLikeGeometry(metrics.center, radius, height, 36, metrics.bottomZ);
}

function roundChimneyRingLineGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const metrics = volumePlanMetrics(vol);
  if (!metrics) return null;
  const radius = Math.max(0.08, metrics.maxRadius * 0.84);
  const height = Math.max(0.2, metrics.topZ - metrics.bottomZ);
  const rows = Math.max(5, Math.min(18, Math.round(height / 0.16)));
  const segments = 36;
  const positions: number[] = [];
  for (let row = 1; row < rows; row++) {
    const z = metrics.bottomZ + (height * row) / rows + 0.012;
    for (let i = 0; i < segments; i++) {
      const a = (i / segments) * Math.PI * 2;
      const b = ((i + 1) / segments) * Math.PI * 2;
      positions.push(
        metrics.center.x + Math.cos(a) * radius,
        metrics.center.y + Math.sin(a) * radius,
        z,
        metrics.center.x + Math.cos(b) * radius,
        metrics.center.y + Math.sin(b) * radius,
        z,
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function roofWindowFrameGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const ring = volumeRingAt(vol, 1, 0.032);
  if (ring.length < 4) return null;
  const outer = scaleRingFromCenter(ring, 1.04);
  const inner = scaleRingFromCenter(ring, 0.78);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const pnt of outer) positions.push(pnt.x, pnt.y, pnt.z);
  for (const pnt of inner) positions.push(pnt.x, pnt.y, pnt.z + 0.002);
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    indices.push(i, next, ring.length + next, i, ring.length + next, ring.length + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function roofWindowHighlightLineGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const ring = scaleRingFromCenter(volumeRingAt(vol, 1, 0.04), 0.62);
  if (ring.length < 4) return null;
  const positions: number[] = [];
  const pushLine = (a: THREE.Vector3, b: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  const lerp = (a: THREE.Vector3, b: THREE.Vector3, t: number) => a.clone().lerp(b, t);
  const p0 = ring[0]!;
  const p1 = ring[1]!;
  const p2 = ring[2]!;
  const p3 = ring[3]!;
  pushLine(lerp(p0, p1, 0.18).lerp(lerp(p0, p3, 0.22), 0.42), lerp(p3, p2, 0.42));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function roofWindowSashLineGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const ring = scaleRingFromCenter(volumeRingAt(vol, 1, 0.043), 0.7);
  if (ring.length < 4) return null;
  const positions: number[] = [];
  const lerp = (a: THREE.Vector3, b: THREE.Vector3, t: number) => new THREE.Vector3().lerpVectors(a, b, t);
  const push = (a: THREE.Vector3, b: THREE.Vector3) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const p0 = ring[0]!;
  const p1 = ring[1]!;
  const p2 = ring[2]!;
  const p3 = ring[3]!;
  push(lerp(p0, p1, 0.5), lerp(p3, p2, 0.5));
  push(lerp(p0, p3, 0.5), lerp(p1, p2, 0.5));
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function roofWindowGreyFrameGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const ring = volumeRingAt(vol, 1, 0.038);
  if (ring.length < 4) return null;
  const outer = scaleRingFromCenter(ring, 1.1);
  const inner = scaleRingFromCenter(ring, 0.68);
  const positions: number[] = [];
  const indices: number[] = [];
  for (const p of outer) positions.push(p.x, p.y, p.z);
  for (const p of inner) positions.push(p.x, p.y, p.z + 0.004);
  for (let i = 0; i < ring.length; i++) {
    const next = (i + 1) % ring.length;
    indices.push(i, next, ring.length + next, i, ring.length + next, ring.length + i);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

function chimneyBrickLineGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const n = vol.footprintWorld.length;
  if (n < 4 || vol.vertices.length < n * 2) return null;
  const positions: number[] = [];
  const pushLine = (a: THREE.Vector3, b: THREE.Vector3) => {
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  };
  const baseMinZ = Math.min(...Array.from({ length: n }, (_, i) => vol.vertices[i]!.position.z));
  const topMaxZ = Math.max(...Array.from({ length: n }, (_, i) => vol.vertices[i + n]!.position.z));
  const approxRows = Math.max(4, Math.min(18, Math.round((topMaxZ - baseMinZ) / 0.18)));
  for (let row = 1; row < approxRows; row++) {
    const t = row / approxRows;
    const ring = volumeRingAt(vol, t, 0.018);
    for (let i = 0; i < ring.length; i++) pushLine(ring[i]!, ring[(i + 1) % ring.length]!);
  }
  for (let i = 0; i < n; i++) {
    const b0 = vol.vertices[i]!.position;
    const b1 = vol.vertices[(i + 1) % n]!.position;
    const t0 = vol.vertices[i + n]!.position;
    const t1 = vol.vertices[((i + 1) % n) + n]!.position;
    const sideWidth = Math.hypot(b1.x - b0.x, b1.y - b0.y);
    const cols = Math.max(1, Math.min(4, Math.round(sideWidth / 0.22)));
    for (let c = 1; c < cols; c++) {
      const u = c / cols;
      const stagger = i % 2 === 0 ? 0 : 0.5 / Math.max(1, cols);
      const uu = Math.min(0.92, Math.max(0.08, u + stagger));
      pushLine(
        new THREE.Vector3(
          b0.x + (b1.x - b0.x) * uu,
          b0.y + (b1.y - b0.y) * uu,
          b0.z + (b1.z - b0.z) * uu + 0.018,
        ),
        new THREE.Vector3(
          t0.x + (t1.x - t0.x) * uu,
          t0.y + (t1.y - t0.y) * uu,
          t0.z + (t1.z - t0.z) * uu + 0.018,
        ),
      );
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function vmcCapGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const metrics = volumePlanMetrics(vol);
  if (!metrics) return null;
  const radius = Math.max(0.08, metrics.maxRadius * 0.92);
  const height = Math.max(0.08, Math.min(0.18, (metrics.topZ - metrics.bottomZ) * 0.42));
  return cylinderLikeGeometry(metrics.center, radius, height, 28, metrics.topZ - height * 0.45);
}

function antennaBaseGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const metrics = volumePlanMetrics(vol);
  if (!metrics) return null;
  const radius = Math.max(0.07, metrics.maxRadius * 0.72);
  const height = Math.max(0.035, Math.min(0.08, (metrics.topZ - metrics.bottomZ) * 0.12));
  return cylinderLikeGeometry(metrics.center, radius, height, 24, metrics.bottomZ + 0.015);
}

function shadowVolumeRayGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  if (vol.visualRole !== "abstract_shadow_volume") return null;
  const n = vol.footprintWorld.length;
  if (n < 3 || vol.vertices.length < n * 2) return null;
  const positions: number[] = [];
  for (let i = 0; i < n; i++) {
    const base = vol.vertices[i]!.position;
    const top = vol.vertices[i + n]!.position;
    positions.push(base.x, base.y, base.z + 0.016, top.x, top.y, top.z + 0.016);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function vmcVentLineGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const metrics = volumePlanMetrics(vol);
  if (!metrics) return null;
  const positions: number[] = [];
  const radius = Math.max(0.08, metrics.maxRadius * 0.76);
  const z = metrics.topZ + 0.055;
  for (let i = 0; i < 4; i++) {
    const y = metrics.center.y + (i - 1.5) * radius * 0.28;
    positions.push(metrics.center.x - radius * 0.55, y, z, metrics.center.x + radius * 0.55, y, z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function antennaLineGeometry(vol: SolarScene3D["obstacleVolumes"][number]): THREE.BufferGeometry | null {
  const metrics = volumePlanMetrics(vol);
  if (!metrics) return null;
  const positions: number[] = [];
  const push = (a: THREE.Vector3, b: THREE.Vector3) => positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  const c = metrics.center;
  const height = Math.max(0.8, metrics.topZ - metrics.bottomZ);
  const mastBottom = new THREE.Vector3(c.x, c.y, metrics.bottomZ + 0.04);
  const mastTop = new THREE.Vector3(c.x, c.y, metrics.bottomZ + height);
  push(mastBottom, mastTop);
  const armBaseZ = metrics.bottomZ + height * 0.55;
  const armLen = Math.max(0.35, metrics.maxRadius * 2.3);
  for (let i = 0; i < 4; i++) {
    const z = armBaseZ + i * height * 0.09;
    const len = armLen * (1 - i * 0.12);
    push(new THREE.Vector3(c.x - len * 0.5, c.y, z), new THREE.Vector3(c.x + len * 0.5, c.y, z));
  }
  push(
    new THREE.Vector3(c.x, c.y, armBaseZ - height * 0.12),
    new THREE.Vector3(c.x + armLen * 0.48, c.y, armBaseZ + height * 0.36),
  );
  push(
    new THREE.Vector3(c.x, c.y, armBaseZ - height * 0.12),
    new THREE.Vector3(c.x - armLen * 0.48, c.y, armBaseZ + height * 0.36),
  );
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

function roofObstacleDetailGeometries(vol: SolarScene3D["obstacleVolumes"][number]): ObstacleDetailGeometries {
  const topRing = volumeRingAt(vol, 1, vol.visualRole === "roof_window_flush" || vol.visualRole === "keepout_surface" ? 0.018 : 0.012);
  const roundChimney = isRoundChimneyVolume(vol);
  const premiumAssets = buildPremiumObstacleAssets(vol);
  return {
    topCap: (vol.kind === "chimney" && !roundChimney) || vol.visualRole === "roof_window_flush"
      ? volumeTopCapGeometry(vol, vol.kind === "chimney" ? 0.045 : 0.024, vol.kind === "chimney" ? 1.12 : 0.6)
      : null,
    chimneyFlueOpening: vol.kind === "chimney" ? chimneyFlueOpeningGeometry(vol) : null,
    edgeLines: vol.visualRole === "roof_window_flush" ? null : volumeLoopLineGeometry(topRing),
    brickLines: vol.kind === "chimney" && !roundChimney ? chimneyBrickLineGeometry(vol) : null,
    windowFrame: vol.visualRole === "roof_window_flush" ? roofWindowFrameGeometry(vol) : null,
    windowHighlight: vol.visualRole === "roof_window_flush" ? roofWindowHighlightLineGeometry(vol) : null,
    windowSashLines: vol.visualRole === "roof_window_flush" ? roofWindowSashLineGeometry(vol) : null,
    windowOuterFrame: vol.visualRole === "roof_window_flush" ? roofWindowGreyFrameGeometry(vol) : null,
    vmcCap: vol.kind === "hvac" || vol.kind === "drain" ? vmcCapGeometry(vol) : null,
    vmcVentLines: vol.kind === "hvac" ? vmcVentLineGeometry(vol) : null,
    antennaLines: vol.kind === "antenna" ? antennaLineGeometry(vol) : null,
    antennaBase: vol.kind === "antenna" ? antennaBaseGeometry(vol) : null,
    roundChimneyBody: roundChimney ? roundChimneyBodyGeometry(vol) : null,
    roundChimneyLines: roundChimney ? roundChimneyRingLineGeometry(vol) : null,
    keepoutHatch: keepoutHatchGeometry(vol),
    keepoutCornerMarks: keepoutCornerMarksGeometry(vol),
    allEdgeLines: volumeAllEdgeLineGeometry(vol, vol.visualRole === "keepout_surface" ? 0.028 : 0.012),
    shadowVolumeRays: shadowVolumeRayGeometry(vol),
    premiumAssets,
    replaceBaseMesh: premiumAssets.replaceBaseMesh || roundChimney || vol.kind === "antenna",
  };
}

function panelSurfaceMaterial(
  scene: SolarScene3D,
  panelId: string,
  showShading: boolean,
  inspectSelected: boolean,
  emissiveBonus: number,
): { color: number; emissive: number; emissiveIntensity: number } {
  if (!showShading) {
    return {
      color: PREMIUM_PV_SURFACE_HEX,
      emissive: PREMIUM_PV_EMISSIVE_HEX,
      // 0.12 : plancher d'émissivité pour que les panneaux restent visibles
      // même sans données d'ombrage (fond sombre, ACES tonemapping).
      emissiveIntensity: 0.1 + emissiveBonus + (inspectSelected ? 0.08 : 0),
    };
  }
  const eff = getEffectivePanelVisualShading(panelId, scene);
  const tintHex = premiumTintHexForQualityScore(
    eff.state === "AVAILABLE" ? eff.qualityScore01 : null,
  );
  const color = blendPvSurfaceColor(tintHex, eff.state === "AVAILABLE" ? 0.18 : 0.1);
  const em = new THREE.Color(tintHex);
  return {
    color,
    emissive: em.getHex(),
    emissiveIntensity:
      (eff.state === "AVAILABLE" ? 0.05 : 0.028) + emissiveBonus + (inspectSelected ? 0.07 : 0),
  };
}

/** Pass 4 — résout l’id pan depuis le maillage `roof_tessellation` (intersections rayon). */
function pickRoofTessellationPanIdFromIntersections(
  intersections: ReadonlyArray<{ object?: { userData?: Record<string, unknown> } }>,
): string | null {
  for (const inter of intersections) {
    const payload = inter.object?.userData?.[INSPECT_USERDATA_KEY] as SceneInspectUserData | undefined;
    if (payload?.kind === "PAN" && payload.meshRole === "roof_tessellation") {
      return String(payload.id);
    }
  }
  return null;
}

function roofVertexWorldFromScene(scene: SolarScene3D, hit: ScenePickHit): THREE.Vector3 | null {
  if (hit.kind !== "roof_vertex") return null;
  const patch = scene.roofModel.roofPlanePatches.find((p) => String(p.id) === String(hit.roofPlanePatchId));
  const c = patch?.cornersWorld[hit.vertexIndexInPatch];
  return c ? new THREE.Vector3(c.x, c.y, c.z) : null;
}

/** Plage alignée sur `isValidBuildingHeightM` (heightResolver). */
const ROOF_VERTEX_EDIT_MIN_M = -2;
const ROOF_VERTEX_EDIT_MAX_M = 30;
/** Aligné sur `commitRoofVertexHeightLike2D` (proximité point structurel, px image). */
const STRUCTURAL_RIDGE_RESOLVE_MAX_DIST_IMG_PX = 56;
const STRUCTURAL_RIDGE_HEIGHT_MIN_M = 0;

function imagePolygonToRoofWorldPoints(
  scene: SolarScene3D,
  points: readonly { readonly x: number; readonly y: number }[],
  panId: string | null | undefined,
  offsetM: number,
): THREE.Vector3[] {
  if (!scene.worldConfig || points.length < 2) return [];
  const patch =
    scene.roofModel.roofPlanePatches.find((p) => String(p.id) === String(panId ?? "")) ??
    scene.roofModel.roofPlanePatches[0];
  if (!patch) return [];
  const n = new THREE.Vector3(patch.normal.x, patch.normal.y, patch.normal.z).normalize();
  const c0 = patch.cornersWorld[0];
  const d = c0 ? -(n.x * c0.x + n.y * c0.y + n.z * c0.z) : 0;
  return points.map((pt) => {
    const h = imagePointToWorld(pt, scene.worldConfig!);
    const z = Math.abs(n.z) > 1e-5 ? -(n.x * h.x + n.y * h.y + d) / n.z : (c0?.z ?? 0);
    return new THREE.Vector3(h.x, h.y, z).addScaledVector(n, offsetM);
  });
}

function imagePolygonToRoofMeshGeometry(
  scene: SolarScene3D,
  points: readonly { readonly x: number; readonly y: number }[],
  panId: string | null | undefined,
  offsetM: number,
): THREE.BufferGeometry | null {
  const world = imagePolygonToRoofWorldPoints(scene, points, panId, offsetM);
  if (world.length < 3) return null;
  const positions: number[] = [];
  for (const p of world) positions.push(p.x, p.y, p.z);
  const indices: number[] = [];
  for (let i = 1; i < world.length - 1; i++) indices.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // FA-7 : eager boundingSphere — évite le lazy compute au premier frame de rendu.
  geo.computeBoundingSphere();
  return geo;
}

function imagePolygonToRoofLineGeometry(
  scene: SolarScene3D,
  points: readonly { readonly x: number; readonly y: number }[],
  panId: string | null | undefined,
  offsetM: number,
): THREE.BufferGeometry | null {
  const world = imagePolygonToRoofWorldPoints(scene, points, panId, offsetM);
  if (world.length < 2) return null;
  const positions: number[] = [];
  for (let i = 0; i < world.length; i++) {
    const a = world[i]!;
    const b = world[(i + 1) % world.length]!;
    positions.push(a.x, a.y, a.z, b.x, b.y, b.z);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  // FA-7 : eager boundingSphere pour les lineSegments live (frustum culling correct dès le 1er frame).
  geo.computeBoundingSphere();
  return geo;
}

function imagePolygonToRoofRibbonGeometry(
  scene: SolarScene3D,
  points: readonly { readonly x: number; readonly y: number }[],
  panId: string | null | undefined,
  offsetM: number,
  widthM: number,
): THREE.BufferGeometry | null {
  const patch =
    scene.roofModel.roofPlanePatches.find((p) => String(p.id) === String(panId ?? "")) ??
    scene.roofModel.roofPlanePatches[0];
  if (!patch) return null;
  const normal = new THREE.Vector3(patch.normal.x, patch.normal.y, patch.normal.z).normalize();
  const world = imagePolygonToRoofWorldPoints(scene, points, panId, offsetM);
  if (world.length < 2) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = Math.max(0.01, widthM) / 2;
  for (let i = 0; i < world.length; i++) {
    const a = world[i]!;
    const b = world[(i + 1) % world.length]!;
    const edge = new THREE.Vector3().subVectors(b, a);
    if (edge.lengthSq() < 1e-8) continue;
    const side = new THREE.Vector3().crossVectors(edge.normalize(), normal).normalize().multiplyScalar(halfWidth);
    const base = positions.length / 3;
    const a1 = a.clone().add(side);
    const b1 = b.clone().add(side);
    const b2 = b.clone().sub(side);
    const a2 = a.clone().sub(side);
    positions.push(a1.x, a1.y, a1.z, b1.x, b1.y, b1.z, b2.x, b2.y, b2.z, a2.x, a2.y, a2.z);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  // FA-7 : eager boundingSphere pour le ribbon safe-zone.
  geo.computeBoundingSphere();
  return geo;
}

function worldPolygonLineGeometry(
  points: readonly { readonly x: number; readonly y: number; readonly z: number }[],
  normal: THREE.Vector3,
  offsetM: number,
): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  const positions: number[] = [];
  for (let i = 0; i < points.length; i++) {
    const a = points[i]!;
    const b = points[(i + 1) % points.length]!;
    positions.push(
      a.x + normal.x * offsetM,
      a.y + normal.y * offsetM,
      a.z + normal.z * offsetM,
      b.x + normal.x * offsetM,
      b.y + normal.y * offsetM,
      b.z + normal.z * offsetM,
    );
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.computeBoundingSphere();
  return geo;
}

function worldPolygonRibbonGeometry(
  points: readonly { readonly x: number; readonly y: number; readonly z: number }[],
  normal: THREE.Vector3,
  offsetM: number,
  widthM: number,
): THREE.BufferGeometry | null {
  if (points.length < 2) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  const halfWidth = Math.max(0.01, widthM) / 2;
  for (let i = 0; i < points.length; i++) {
    const pa = points[i]!;
    const pb = points[(i + 1) % points.length]!;
    const a = new THREE.Vector3(pa.x, pa.y, pa.z).addScaledVector(normal, offsetM);
    const b = new THREE.Vector3(pb.x, pb.y, pb.z).addScaledVector(normal, offsetM);
    const edge = new THREE.Vector3().subVectors(b, a);
    if (edge.lengthSq() < 1e-8) continue;
    const side = new THREE.Vector3().crossVectors(edge.normalize(), normal).normalize().multiplyScalar(halfWidth);
    const base = positions.length / 3;
    const a1 = a.clone().add(side);
    const b1 = b.clone().add(side);
    const b2 = b.clone().sub(side);
    const a2 = a.clone().sub(side);
    positions.push(a1.x, a1.y, a1.z, b1.x, b1.y, b1.z, b2.x, b2.y, b2.z, a2.x, a2.y, a2.z);
    indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
  }
  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function worldPolygonFillGeometry(
  points: readonly { readonly x: number; readonly y: number; readonly z: number }[],
  normal: THREE.Vector3,
  offsetM: number,
): THREE.BufferGeometry | null {
  if (points.length < 3) return null;
  const lifted = points.map((p) => ({
    x: p.x + normal.x * offsetM,
    y: p.y + normal.y * offsetM,
    z: p.z + normal.z * offsetM,
  }));
  const positions: number[] = [];
  for (const p of lifted) positions.push(p.x, p.y, p.z);
  const indices: number[] = [];
  for (let i = 1; i < lifted.length - 1; i++) {
    indices.push(0, i, i + 1);
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  return geo;
}

function extensionV1FootprintSafeZoneGeometries(
  scene: SolarScene3D,
  extension: SolarScene3D["extensionVolumes"][number],
): { readonly id: string; readonly ribbon: THREE.BufferGeometry | null; readonly line: THREE.BufferGeometry | null } | null {
  if (extension.footprintWorld.length < 3) return null;
  const supportId = extension.topology?.supportPlanePatchId ?? extension.relatedPlanePatchIds[0] ?? null;
  const patch = scene.roofModel.roofPlanePatches.find((p) => String(p.id) === String(supportId));
  const normal = patch
    ? new THREE.Vector3(patch.normal.x, patch.normal.y, patch.normal.z).normalize()
    : new THREE.Vector3(0, 0, 1);
  const ribbon = worldPolygonRibbonGeometry(extension.footprintWorld, normal, 0.026, 0.055);
  const line = worldPolygonLineGeometry(extension.footprintWorld, normal, 0.034);
  return ribbon || line ? { id: String(extension.id), ribbon, line } : null;
}

function getActiveRoofVertexModelingTarget(
  inspectMode: boolean,
  panSelection3DMode: boolean,
  inspectionSelection: SceneInspectionSelection | null,
  selectedHit: ScenePickHit | null,
): { readonly patchId: string; readonly vertexIndex: number } | null {
  if (inspectMode && inspectionSelection?.kind === "PAN" && inspectionSelection.roofVertexIndexInPatch != null) {
    return { patchId: String(inspectionSelection.id), vertexIndex: inspectionSelection.roofVertexIndexInPatch };
  }
  if (panSelection3DMode && selectedHit?.kind === "roof_vertex") {
    return { patchId: selectedHit.roofPlanePatchId, vertexIndex: selectedHit.vertexIndexInPatch };
  }
  return null;
}

function readVertexReferenceHeightM(
  pans: ReadonlyArray<CalpinagePanProvenanceEntry> | undefined,
  panId: string,
  vertexIndex: number,
  worldZFallbackM: number,
): number {
  const p = pans?.find((x) => String(x.id) === String(panId));
  const poly = p?.polygonPx;
  if (poly && vertexIndex >= 0 && vertexIndex < poly.length) {
    const pt = poly[vertexIndex];
    const h = pt && typeof pt === "object" && "h" in pt ? (pt as { h?: unknown }).h : undefined;
    if (typeof h === "number" && isValidBuildingHeightM(h)) return h;
  }
  if (isValidBuildingHeightM(worldZFallbackM)) return worldZFallbackM;
  return 0;
}

function readVertexReferencePx(
  pans: ReadonlyArray<CalpinagePanProvenanceEntry> | undefined,
  panId: string,
  vertexIndex: number,
  worldXYFallback: { readonly x: number; readonly y: number } | null,
  scene: SolarScene3D,
): { readonly xPx: number; readonly yPx: number } | null {
  const p = pans?.find((x) => String(x.id) === String(panId));
  const poly = p?.polygonPx;
  if (poly && vertexIndex >= 0 && vertexIndex < poly.length) {
    const pt = poly[vertexIndex];
    if (pt && typeof pt === "object") {
      const x = Number((pt as { x?: unknown }).x);
      const y = Number((pt as { y?: unknown }).y);
      if (Number.isFinite(x) && Number.isFinite(y)) return { xPx: x, yPx: y };
    }
  }
  const wc = scene.worldConfig;
  if (
    worldXYFallback &&
    Number.isFinite(worldXYFallback.x) &&
    Number.isFinite(worldXYFallback.y) &&
    wc &&
    typeof wc.metersPerPixel === "number" &&
    wc.metersPerPixel > 0
  ) {
    const north = typeof wc.northAngleDeg === "number" && Number.isFinite(wc.northAngleDeg) ? wc.northAngleDeg : 0;
    const { xPx, yPx } = worldHorizontalMToImagePx(
      worldXYFallback.x,
      worldXYFallback.y,
      wc.metersPerPixel,
      north,
    );
    if (Number.isFinite(xPx) && Number.isFinite(yPx)) return { xPx, yPx };
  }
  return null;
}

/**
 * Marqueur sommet : sphère **centrée sur le coin 3D exact** (`cornersWorld`).
 * Si `pickPosition` est fourni (drag Z), le raycast va sur une sphère invisible décalée le long de la normale
 * pour ne pas voler le hit au pan tout en gardant l’orange collé au sommet.
 */
function PanVertexSelectionMarkerMesh({
  position,
  pickPosition,
  pickHitRadius,
  radius,
  interactive,
  onPointerDown,
}: {
  readonly position: readonly [number, number, number];
  /** Centre monde de la hitbox (souvent légèrement au-dessus du plan) ; absent → pas de drag séparé. */
  readonly pickPosition?: readonly [number, number, number];
  readonly pickHitRadius?: number;
  readonly radius: number;
  readonly interactive?: boolean;
  readonly onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}) {
  const visualRef = useRef<THREE.Mesh>(null);
  const pickRef = useRef<THREE.Mesh>(null);
  const usePickHelper = !!(interactive && pickPosition != null && pickHitRadius != null && pickHitRadius > 0);

  useLayoutEffect(() => {
    const vis = visualRef.current;
    if (!vis) return;
    if (interactive && !usePickHelper) {
      vis.raycast = THREE.Mesh.prototype.raycast.bind(vis);
    } else {
      vis.raycast = (): void => {
        /* Hitbox drag sur sphère invisible ; visuel au sommet exact sans bloquer le pan. */
      };
    }
  }, [interactive, usePickHelper]);

  useLayoutEffect(() => {
    const pick = pickRef.current;
    if (!pick) return;
    if (usePickHelper) {
      pick.raycast = THREE.Mesh.prototype.raycast.bind(pick);
    } else {
      pick.raycast = (): void => {};
    }
  }, [usePickHelper]);

  const hitR = usePickHelper ? pickHitRadius! : radius;

  return (
    <>
      <mesh
        ref={visualRef}
        position={position}
        scale={[radius, radius, radius]}
        geometry={getViewerPanVertexSelectionMarkerGeometry()}
        renderOrder={interactive ? 24 : 8}
        onPointerDown={interactive && !usePickHelper ? onPointerDown : undefined}
        onClick={interactive ? (e) => e.stopPropagation() : undefined}
      >
        <meshStandardMaterial
          color="#ffb74d"
          emissive="#ff9800"
          emissiveIntensity={interactive ? 0.72 : 0.55}
          metalness={0.12}
          roughness={0.4}
          toneMapped
          depthTest
          polygonOffset
          {...getDepthOffset("SELECTION_HIGHLIGHT")}
        />
      </mesh>
      {usePickHelper ? (
        <mesh
          ref={pickRef}
          position={pickPosition}
          scale={[hitR, hitR, hitR]}
          geometry={getViewerPanVertexSelectionMarkerGeometry()}
          renderOrder={25}
          onPointerDown={onPointerDown}
          onClick={(e) => e.stopPropagation()}
        >
          <meshStandardMaterial transparent opacity={0} depthWrite={false} depthTest={false} toneMapped={false} />
        </mesh>
      ) : null}
    </>
  );
}

type PanelHover = { readonly panelId: string; readonly clientX: number; readonly clientY: number } | null;

type RoofModelingPointerUi =
  | null
  | {
      readonly clientX: number;
      readonly clientY: number;
      readonly label: string;
      readonly cursor?: string;
    };

/** Synchronise le curseur du canvas WebGL (hors DOM overlay). */
function GlCursorBinder({ cursor }: { readonly cursor: string }) {
  const gl = useThree((s) => s.gl);
  useLayoutEffect(() => {
    const el = gl.domElement;
    const prev = el.style.cursor;
    el.style.cursor = cursor || "";
    return () => {
      el.style.cursor = prev;
    };
  }, [gl, cursor]);
  return null;
}

/** Facilite le picking des `LineSegments` (faîtages) en monde 3D. */
function LineRaycastThreshold({ maxDim, enabled }: { readonly maxDim: number; readonly enabled: boolean }) {
  const raycaster = useThree((s) => s.raycaster);
  useLayoutEffect(() => {
    if (!enabled) return;
    const t = Math.max(0.05, maxDim * 0.002);
    const prev = raycaster.params.Line;
    raycaster.params.Line = { threshold: t };
    return () => {
      raycaster.params.Line = prev;
    };
  }, [enabled, maxDim, raycaster]);
  return null;
}

type ViewerRenderabilitySnapshot = {
  readonly frameCount: number;
  readonly renderableObjectCount: number;
  readonly boundsFinite: boolean;
  readonly cameraFinite: boolean;
  readonly frustumIntersectsBounds: boolean;
  readonly cameraPosition: readonly [number, number, number] | null;
  readonly cameraTarget: readonly [number, number, number] | null;
  readonly near: number | null;
  readonly far: number | null;
  readonly bounds: {
    readonly min: readonly [number, number, number] | null;
    readonly max: readonly [number, number, number] | null;
  };
};

function vectorSnapshot(v: THREE.Vector3): readonly [number, number, number] | null {
  return Number.isFinite(v.x) && Number.isFinite(v.y) && Number.isFinite(v.z) ? [v.x, v.y, v.z] : null;
}

function boxSnapshot(box: THREE.Box3): ViewerRenderabilitySnapshot["bounds"] {
  return {
    min: vectorSnapshot(box.min),
    max: vectorSnapshot(box.max),
  };
}

function ViewerRenderabilityProbe({
  box,
  target,
  renderableObjectCount,
}: {
  readonly box: THREE.Box3;
  readonly target: THREE.Vector3;
  readonly renderableObjectCount: number;
}) {
  const camera = useThree((s) => s.camera);
  const frameCountRef = useRef(0);
  const frustumRef = useRef(new THREE.Frustum());
  const matrixRef = useRef(new THREE.Matrix4());

  useFrame(() => {
    frameCountRef.current += 1;
    camera.updateMatrixWorld();
    if ("updateProjectionMatrix" in camera && typeof camera.updateProjectionMatrix === "function") {
      camera.updateProjectionMatrix();
    }
    matrixRef.current.multiplyMatrices(camera.projectionMatrix, camera.matrixWorldInverse);
    frustumRef.current.setFromProjectionMatrix(matrixRef.current);
    const near = (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).near;
    const far = (camera as THREE.PerspectiveCamera | THREE.OrthographicCamera).far;
    const snapshot: ViewerRenderabilitySnapshot = {
      frameCount: frameCountRef.current,
      renderableObjectCount,
      boundsFinite: !box.isEmpty() && vectorSnapshot(box.min) != null && vectorSnapshot(box.max) != null,
      cameraFinite: vectorSnapshot(camera.position) != null && Number.isFinite(near) && Number.isFinite(far),
      frustumIntersectsBounds: !box.isEmpty() && frustumRef.current.intersectsBox(box),
      cameraPosition: vectorSnapshot(camera.position),
      cameraTarget: vectorSnapshot(target),
      near: Number.isFinite(near) ? near : null,
      far: Number.isFinite(far) ? far : null,
      bounds: boxSnapshot(box),
    };
    (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_RENDERABILITY__"] = snapshot;
  });

  return null;
}

function StatsGlProbe({ enabled }: { readonly enabled: boolean }) {
  const frameCountRef = useRef(0);
  useFrame(() => {
    if (!enabled) return;
    frameCountRef.current += 1;
    (window as unknown as Record<string, unknown>)["__CALPINAGE_3D_STATS_GL_PROBE__"] = {
      mounted: true,
      frameCount: frameCountRef.current,
      updatedAt: Date.now(),
    };
  });
  return null;
}


/** Contenu géométrique + soleil — dispose explicite des BufferGeometry créées ici. */
function ViewerSceneContent({
  scene,
  box,
  assembly,
  showRoof,
  showRoofEdges,
  showObstacles,
  showExtensions,
  showPanels,
  showPanelShading,
  showSun,
  sunDirectionIndex,
  onPanelHover,
  inspectMode,
  panSelection3DMode,
  selectedHit,
  inspectionSelection,
  onInspectClick,
  onRoofMeshClick,
  onRoofModelingPointerUi,
  roofModelingSurfaceUx,
  roofModelingPassThroughOccluders,
  maxDim,
  roofVertexMarker,
  enableStructuralRidgeHeightEdit = false,
  onStructuralRidgeLinePointerDown,
  onRoofTessellationPv3dProbePointerDown,
  pvLayout3DInteractionMode = false,
  pvLayout3dOverlayState,
  onPvPanelPvLayout3dPointerDown,
  satelliteTexture,
  satelliteUvMapper,
  extensionVolDebugLevel = 0,
  qualityProfile,
}: Required<
  Pick<
    SolarScene3DViewerProps,
    | "scene"
    | "showRoof"
    | "showRoofEdges"
    | "showObstacles"
    | "showExtensions"
    | "showPanels"
    | "showPanelShading"
    | "showSun"
    | "inspectMode"
    | "panSelection3DMode"
    | "enableRoofVertexZEdit"
    | "enableRoofVertexXYEdit"
  >
> & {
  readonly roofModelingSurfaceUx: boolean;
  /** Raycast désactivé sur PV / obstacles / extensions pour atteindre la toiture sous le curseur. */
  readonly roofModelingPassThroughOccluders: boolean;
  readonly assembly: PremiumHouse3DSceneAssembly;
  readonly box: THREE.Box3;
  sunDirectionIndex: number;
  readonly onPanelHover?: (h: PanelHover) => void;
  readonly selectedHit: ScenePickHit | null;
  readonly inspectionSelection: SceneInspectionSelection | null;
  readonly onInspectClick: (e: ThreeEvent<MouseEvent>) => void;
  readonly onRoofMeshClick?: (e: ThreeEvent<MouseEvent>) => void;
  readonly onRoofModelingPointerUi?: (p: RoofModelingPointerUi) => void;
  readonly maxDim: number;
  readonly roofVertexMarker: {
    readonly position: readonly [number, number, number];
    readonly pickPosition?: readonly [number, number, number];
    readonly pickHitRadius?: number;
    readonly radius: number;
    readonly interactiveZDrag: boolean;
    readonly onMarkerPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  } | null;
  readonly enableStructuralRidgeHeightEdit?: boolean;
  readonly onStructuralRidgeLinePointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  /** Pass 4 — sonde technique pose PV (flag `window.__CALPINAGE_3D_PV_PLACE_PROBE__`). */
  readonly onRoofTessellationPv3dProbePointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  readonly pvLayout3DInteractionMode?: boolean;
  readonly pvLayout3dOverlayState?: PvLayout3dOverlayState | null;
  readonly onPvPanelPvLayout3dPointerDown?: (e: ThreeEvent<PointerEvent>, panelId: string) => void;
  /**
   * Texture satellite (orthophoto 2D) déjà chargée + crop appliqué — projetée en top-down sur les pans.
   * Null si l'image n'est pas encore prête ou absente.
   */
  readonly satelliteTexture?: THREE.Texture | null;
  /**
   * Mapper UV (wx, wy) → {u, v} [0,1] en espace déclaré pour la projection satellite sur la toiture.
   * Doit être cohérent avec satelliteTexture (même repeat/offset).
   */
  readonly satelliteUvMapper?: ((wx: number, wy: number) => { u: number; v: number }) | null;
  /** Dev uniquement : Shift+Alt+E cycle fil de fer / normales sur les volumes extension (chien assis). */
  readonly extensionVolDebugLevel?: 0 | 1 | 2;
  readonly qualityProfile: ViewerQualityProfile;
}) {
  const pvPanelRaycastPassThrough = roofModelingPassThroughOccluders && !pvLayout3DInteractionMode;

  // ── Diff de scène incrémental (D2) ────────────────────────────────────────
  // Remplace le key instable sur createdAtIso (supprimé D2) : au lieu de démonter/remonter ViewerSceneContent
  // entier, on compare prev/next et on dispatche les deltas minimaux.
  // Les useMemo ci-dessous (roofGeos, panelGeos…) gèrent déjà les mises à jour
  // incrémentales via leurs deps — ce useEffect sert à :
  //   1. Détecter FULL_REBUILD explicitement (log dev + guard futur).
  //   2. Fournir un point d'extension pour les optimisations impératives Three.js.
  const prevSceneRef = useRef<typeof scene | null>(null);
  useEffect(() => {
    const deltas = diffSolarScene3D(prevSceneRef.current, scene);
    prevSceneRef.current = scene;

    if (!import.meta.env.DEV) return;
    if (deltas.length === 0) return;
    const isFullRebuild = deltas.some((d) => d.type === "FULL_REBUILD");
    if (isFullRebuild) {
      console.log("[3D DIFF] FULL_REBUILD", { createdAtIso: scene.metadata.createdAtIso });
    } else {
      console.log("[3D DIFF] incremental", deltas.length, "delta(s)", deltas);
    }
  }, [scene]);

  const center = useMemo(() => box.getCenter(new THREE.Vector3()).clone(), [box]);
  const maxDimLocal = useMemo(() => {
    const s = new THREE.Vector3();
    box.getSize(s);
    return Math.max(s.x, s.y, s.z, 1);
  }, [box]);

  const outlineThickness = Math.max(0.0008, maxDim * VIEWER_OUTLINE_THICKNESS_FACTOR);

  const autopsyDevColors =
    import.meta.env.DEV &&
    typeof window !== "undefined" &&
    (window as unknown as { __CALPINAGE_3D_AUTOPSY_COLORS__?: boolean }).__CALPINAGE_3D_AUTOPSY_COLORS__ === true;

  const shellGeo = useMemo(() => {
    const sh = scene.buildingShell;
    if (!sh) return null;
    return buildingShellGeometry(sh);
  }, [scene.buildingShell]);

  const roofGeos = useMemo(() => {
    return scene.roofModel.roofPlanePatches.map((p) => ({
      id: p.id,
      geo: roofPatchGeometry(p, satelliteUvMapper ?? undefined),
    }));
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene.roofModel.roofPlanePatches, satelliteUvMapper]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log("[3D DRAG] mesh build from scene", {
      sceneCreatedAt: scene.metadata.createdAtIso,
      patchCount: scene.roofModel.roofPlanePatches.length,
    });
  }, [scene]);

  const roofClosureGeo = useMemo(
    () => roofClosureFacadeGeometry(scene.roofModel),
    [scene.roofModel],
  );

  const edgeGeo = useMemo(() => roofEdgesLineGeometry(scene.roofModel), [scene.roofModel]);

  const ridgeGeo = useMemo(() => roofRidgesLineGeometry(scene.roofModel), [scene.roofModel]);

  const obsGeos = useMemo(() => {
    return scene.obstacleVolumes.map((v) => ({
      id: v.id,
      volume: v,
      geo: obstacleVolumeGeometry(v),
      details: roofObstacleDetailGeometries(v),
    }));
  }, [scene.obstacleVolumes]);

  const extGeos = useMemo(() => {
    return scene.extensionVolumes.map((v) => ({
      id: v.id,
      geo: extensionVolumeGeometry(v),
      miniRoofLines: extensionMiniRoofLineGeometries(v),
    }));
  }, [scene.extensionVolumes]);

  const extensionKeepoutFillGeos = useMemo(() => {
    return scene.extensionVolumes.flatMap((ext) => {
      if (ext.footprintWorld.length < 3) return [];
      const supportId = ext.topology?.supportPlanePatchId ?? ext.relatedPlanePatchIds[0] ?? null;
      const patch = scene.roofModel.roofPlanePatches.find((p) => String(p.id) === String(supportId));
      const normal = patch
        ? new THREE.Vector3(patch.normal.x, patch.normal.y, patch.normal.z).normalize()
        : new THREE.Vector3(0, 0, 1);
      const fill = worldPolygonFillGeometry(ext.footprintWorld, normal, 0.025);
      return fill ? [{ id: String(ext.id), fill }] : [];
    });
  }, [scene.extensionVolumes, scene.roofModel.roofPlanePatches]);

  const extensionVolDebugEdgesGeos = useMemo(() => {
    if (!import.meta.env.DEV || extensionVolDebugLevel < 1 || !showExtensions || extGeos.length === 0) {
      return [];
    }
    return extGeos.map(({ id, geo }) => ({
      id,
      edges: new THREE.EdgesGeometry(geo, 38),
    }));
  }, [extGeos, extensionVolDebugLevel, showExtensions]);

  const extensionVolDebugNormalsGeos = useMemo(() => {
    if (!import.meta.env.DEV || extensionVolDebugLevel < 2 || !showExtensions || extGeos.length === 0) {
      return [];
    }
    const scale = Math.max(0.06, maxDimLocal * 0.015);
    const out: { id: string; normals: THREE.BufferGeometry }[] = [];
    for (const { id, geo } of extGeos) {
      const lines = volumeMeshFaceNormalsDebugLineGeometry(geo, scale);
      if (lines) out.push({ id, normals: lines });
    }
    return out;
  }, [extGeos, extensionVolDebugLevel, showExtensions, maxDimLocal]);

  const extensionVolDebugDisposableGeos = useMemo(
    () => [
      ...extensionVolDebugEdgesGeos.map((x) => x.edges),
      ...extensionVolDebugNormalsGeos.map((x) => x.normals),
    ],
    [extensionVolDebugEdgesGeos, extensionVolDebugNormalsGeos],
  );

  useEffect(() => {
    return () => {
      for (const g of extensionVolDebugDisposableGeos) {
        g.dispose();
      }
    };
  }, [extensionVolDebugDisposableGeos]);

  // ── pvLayout3D hidden-IDs pipeline ───────────────────────────────────────────
  // Placé AVANT panelGeos pour permettre le filtrage des panneaux masqués dans
  // les géométries d'inspection pendant un drag.

  const pv3dLivePanelGeos = useMemo(() => {
    if (!pvLayout3DInteractionMode || !pvLayout3dOverlayState) return [];
    // Gate sur isManipulating : le live overlay ne s'affiche QUE pendant un drag actif.
    // Quand le bloc est seulement sélectionné (sans drag), les panneaux sont rendus
    // normalement via l'InstancedMesh — évite tout Z-fighting overlay vs InstancedMesh.
    if (!pvLayout3dOverlayState.isManipulating) return [];
    return pvLayout3dOverlayState.panels.flatMap((p) => {
      if (!p.selected) return [];
      const fill = imagePolygonToRoofMeshGeometry(scene, p.points, p.panId, PV_PANEL_LIVE_FILL_LIFT_M);
      const line = imagePolygonToRoofLineGeometry(scene, p.points, p.panId, PV_PANEL_LIVE_LINE_LIFT_M);
      return fill || line
        ? [{
            id: p.id,
            fill,
            line,
            selected: !!p.selected,
            invalid: !!p.invalid,
            enabled: p.enabled !== false,
          }]
        : [];
    });
  }, [scene, pvLayout3DInteractionMode, pvLayout3dOverlayState]);

  const pv3dSelectedLivePanelIds = useMemo(
    () => new Set(pv3dLivePanelGeos.filter((p) => p.selected).map((p) => String(p.id))),
    [pv3dLivePanelGeos],
  );

  /**
   * hiddenPanelIds effectif : panneaux live (drag actif) masqués dans l'InstancedMesh
   * pendant le drag — l'overlay live les remplace.
   *
   * Règle simplifiée (rendue possible par le gate isManipulating sur pv3dLivePanelGeos) :
   * - pv3dSelectedLivePanelIds n'est non-vide QUE quand CALPINAGE_IS_MANIPULATING=true.
   *   → On peut masquer tous ces panneaux dans l'InstancedMesh sans risque de régression :
   *     l'overlay live les remplace pendant le drag, et dès que le drag finit, l'ensemble
   *     se vide → l'InstancedMesh reprend le rendu normalement.
   * Plus de validatedPanelIdSet ni de logique activeBlock : le gate isManipulating garantit
   * qu'on n'a jamais overlay ET InstancedMesh qui rendent le même panneau simultanément.
   * La déduplication par panelId dans buildCanonicalPlacedPanelsFromRuntime garantit
   * qu'aucune ancienne position ne subsiste dans pvPanels après rebuild.
   */
  const pvLayout3DEffectiveHiddenIds = useMemo(() => {
    if (!pvLayout3DInteractionMode) return undefined;
    // Stabilise la référence : retourner undefined si aucun panneau n'est masqué.
    // Évite de déclencher panelGeos inutilement à chaque
    // rebuild de scène hors drag actif (thrash GPU : N dispose + N alloc par commit).
    if (pv3dSelectedLivePanelIds.size === 0) return undefined;
    const result = new Set<string>();
    // Pendant le drag : masquer dans l'InstancedMesh (l'overlay live prend le relais)
    for (const id of pv3dSelectedLivePanelIds) {
      result.add(id);
    }
    return result;
  }, [pvLayout3DInteractionMode, pv3dSelectedLivePanelIds]);

  // ── Géométries statiques filtrées ─────────────────────────────────────────────

  /**
   * panelGeos : quads d'inspection (outline sélection, raycasting).
   * Filtré par pvLayout3DEffectiveHiddenIds pour éviter des meshes d'inspection
   * fantômes à l'ancienne position pendant le drag.
   */
  const panelGeos = useMemo(() => {
    return scene.pvPanels
      .filter((p) => !pvLayout3DEffectiveHiddenIds?.has(String(p.id)))
      .map((p) => ({
        id: String(p.id),
        geo: panelQuadGeometry(p, PV_PANEL_RENDER_LIFT_M),
      }));
  }, [scene.pvPanels, pvLayout3DEffectiveHiddenIds]);

  /** Lookup overlay PV 3D par panneau, utilisé uniquement pour les états visuels. */
  const pv3dOverlayPanelById = useMemo(() => {
    const m = new Map<string, PvLayout3dOverlayState["panels"][number]>();
    if (!pvLayout3dOverlayState) return m;
    for (const panel of pvLayout3dOverlayState.panels) m.set(String(panel.id), panel);
    return m;
  }, [pvLayout3dOverlayState]);

  const pv3dGhostGeos = useMemo(() => {
    if (!pvLayout3DInteractionMode || !pvLayout3dOverlayState) return [];
    // Ghosts are placement affordances, not only drag affordances. Autofill previews
    // and expansion candidates must stay visible whenever the 2D engine exposes them.
    return pvLayout3dOverlayState.ghosts.flatMap((g) => {
      const fill = imagePolygonToRoofMeshGeometry(scene, g.points, g.panId, PV_PANEL_GHOST_FILL_LIFT_M);
      const line = imagePolygonToRoofLineGeometry(scene, g.points, g.panId, PV_PANEL_GHOST_LINE_LIFT_M);
      return fill || line
        ? [{ id: g.id, fill, line, valid: g.valid !== false, excluded: !!g.excluded, source: g.source }]
        : [];
    });
  }, [scene, pvLayout3DInteractionMode, pvLayout3dOverlayState]);

  const pv3dOverlayPanelGeos = useMemo(() => {
    if (!pvLayout3DInteractionMode || !pvLayout3dOverlayState) return [];
    return pvLayout3dOverlayState.panels.flatMap((p) => {
      if (p.enabled === false) return [];
      const fill = imagePolygonToRoofMeshGeometry(scene, p.points, p.panId, PV_PANEL_LIVE_FILL_LIFT_M);
      const line = imagePolygonToRoofLineGeometry(scene, p.points, p.panId, PV_PANEL_LIVE_LINE_LIFT_M);
      return fill || line
        ? [{ id: p.id, fill, line, selected: !!p.selected, invalid: !!p.invalid }]
        : [];
    });
  }, [scene, pvLayout3DInteractionMode, pvLayout3dOverlayState]);

  const pv3dSelectedPanelGeos = useMemo(() => {
    if (!pvLayout3DInteractionMode || !pvLayout3dOverlayState || pvLayout3dOverlayState.isManipulating) return [];
    return pvLayout3dOverlayState.panels.flatMap((p) => {
      if (!p.selected) return [];
      const fill = imagePolygonToRoofMeshGeometry(scene, p.points, p.panId, PV_PANEL_LIVE_FILL_LIFT_M);
      const line = imagePolygonToRoofLineGeometry(scene, p.points, p.panId, PV_PANEL_LIVE_LINE_LIFT_M);
      return fill || line ? [{ id: p.id, fill, line, invalid: !!p.invalid }] : [];
    });
  }, [scene, pvLayout3DInteractionMode, pvLayout3dOverlayState]);

  const pv3dSafeZoneGeos = useMemo(() => {
    if (!pvLayout3DInteractionMode || !pvLayout3dOverlayState) return [];
    return pvLayout3dOverlayState.safeZones.flatMap((z) =>
      z.polygons.flatMap((poly, index) => {
        const ribbon = imagePolygonToRoofRibbonGeometry(scene, poly, z.panId, 0.008, 0.06);
        const line = imagePolygonToRoofLineGeometry(scene, poly, z.panId, 0.014);
        return ribbon || line ? [{ id: `${z.panId}-${index}`, ribbon, line }] : [];
      }),
    );
  }, [scene, pvLayout3DInteractionMode, pvLayout3dOverlayState]);

  const pv3dExtensionSafeZoneGeos = useMemo(() => {
    if (!pvLayout3DInteractionMode) return [];
    return scene.extensionVolumes.flatMap((extension) => {
      const geos = extensionV1FootprintSafeZoneGeometries(scene, extension);
      return geos ? [geos] : [];
    });
  }, [scene, pvLayout3DInteractionMode]);

  const allGeos = useMemo(
    () => [
      ...(shellGeo ? [shellGeo] : []),
      ...roofGeos.map((x) => x.geo),
      ...(roofClosureGeo ? [roofClosureGeo] : []),
      ...(edgeGeo ? [edgeGeo] : []),
      ...(ridgeGeo ? [ridgeGeo] : []),
      ...obsGeos.flatMap((x) => [
        x.geo,
        x.details.topCap,
        x.details.chimneyFlueOpening,
        x.details.edgeLines,
        x.details.brickLines,
        x.details.windowFrame,
        x.details.windowHighlight,
        x.details.windowSashLines,
        x.details.windowOuterFrame,
        x.details.vmcCap,
        x.details.vmcVentLines,
        x.details.antennaLines,
        x.details.antennaBase,
        x.details.roundChimneyBody,
        x.details.roundChimneyLines,
        x.details.keepoutHatch,
        x.details.keepoutCornerMarks,
        x.details.allEdgeLines,
        x.details.shadowVolumeRays,
        ...x.details.premiumAssets.meshes.map((asset) => asset.geometry),
        ...x.details.premiumAssets.lines.map((asset) => asset.geometry),
      ].filter((g): g is THREE.BufferGeometry => g != null)),
      ...extGeos.map((x) => x.geo),
      ...extGeos.flatMap((x) => x.miniRoofLines.map((line) => line.geometry)),
      ...panelGeos.map((x) => x.geo),
      ...pv3dLivePanelGeos.flatMap((x) => [x.fill, x.line].filter((g): g is THREE.BufferGeometry => g != null)),
      ...pv3dGhostGeos.flatMap((x) => [x.fill, x.line].filter((g): g is THREE.BufferGeometry => g != null)),
      ...pv3dOverlayPanelGeos.flatMap((x) => [x.fill, x.line].filter((g): g is THREE.BufferGeometry => g != null)),
      ...pv3dSelectedPanelGeos.flatMap((x) => [x.fill, x.line].filter((g): g is THREE.BufferGeometry => g != null)),
      ...pv3dSafeZoneGeos.flatMap((x) => [x.ribbon, x.line].filter((g): g is THREE.BufferGeometry => g != null)),
      ...pv3dExtensionSafeZoneGeos.flatMap((x) => [x.ribbon, x.line].filter((g): g is THREE.BufferGeometry => g != null)),
      ...extensionKeepoutFillGeos.map((x) => x.fill),
    ],
    [
      shellGeo,
      roofGeos,
      roofClosureGeo,
      edgeGeo,
      ridgeGeo,
      obsGeos,
      extGeos,
      panelGeos,
      pv3dLivePanelGeos,
      pv3dGhostGeos,
      pv3dOverlayPanelGeos,
      pv3dSelectedPanelGeos,
      pv3dSafeZoneGeos,
      pv3dExtensionSafeZoneGeos,
      extensionKeepoutFillGeos,
    ],
  );

  const solidGeosForNormalsAudit = useMemo(
    () => [
      ...(shellGeo ? [shellGeo] : []),
      ...roofGeos.map((x) => x.geo),
      ...(roofClosureGeo ? [roofClosureGeo] : []),
      ...obsGeos.map((x) => x.geo),
      ...extGeos.map((x) => x.geo),
      ...extGeos.flatMap((x) => x.miniRoofLines.map((line) => line.geometry)),
      ...panelGeos.map((x) => x.geo),
    ],
    [shellGeo, roofGeos, roofClosureGeo, obsGeos, extGeos, panelGeos],
  );

  useEffect(() => {
    logIfGeometryNormalsSuspect(solidGeosForNormalsAudit, "viewer-meshes");
  }, [solidGeosForNormalsAudit]);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const cmp = dump3DRuntimeViewerGeoCompare(scene, shellGeo, roofGeos);
    const snap = getLastAutopsySnapshot();
    const bridge = (window as unknown as { __LAST_3D_BRIDGE__?: Record<string, unknown> }).__LAST_3D_BRIDGE__ ?? {};
    const bridgeMode = bridge.mode === "emergency" ? "emergency" : "official";
    const legFromBridge = bridge.autopsyLegacyPath;
    const legacyPath: AutopsyLegacyRoofPath =
      (snap?.legacyPath as AutopsyLegacyRoofPath) ??
      (typeof legFromBridge === "string" ? (legFromBridge as AutopsyLegacyRoofPath) : "unknown");
    const v = compute3DRuntimeVerdict({
      bridgeMode,
      officialOk: bridge.officialOk !== false,
      viewerMismatch: cmp.viewerMismatch,
      legacyPath,
      shellPresent: snap?.shellPresent ?? !!scene.buildingShell,
      patchCount: snap?.patchCount ?? scene.roofModel.roofPlanePatches.length,
      allPatchesFlatZ: snap?.allPatchesFlatZ ?? false,
      anyPatchHighZRatio: snap?.anyPatchHighZRatio ?? false,
      shellWallSuspect: snap?.shellWallSuspect ?? false,
    });
    log3DRuntimeVerdictFinal({
      verdict: v.verdict,
      reason: v.reason,
      bridgeMode,
      legacyPath,
      viewerMismatch: cmp.viewerMismatch,
    });
  }, [scene, shellGeo, roofGeos]);

  useEffect(() => {
    return () => {
      for (const g of allGeos) g.dispose();
    };
  }, [allGeos]);

  const sunUnit = scene.solarContext?.directionsTowardSunUnit[sunDirectionIndex] ?? {
    x: 0,
    y: 0,
    z: 1,
  };

  const L = assembly.layers;
  const visRoof = showRoof && L.showRoof;
  const visRoofEdges = showRoofEdges && L.showRoofEdges;
  const visRidges = L.showStructuralRidgeLines && ridgeGeo != null;
  const visObs = showObstacles && L.showObstacles;
  const visExt = showExtensions && L.showExtensions;
  const visPanels = showPanels && L.showPanels;
  const visPanelShading = showPanelShading && L.showPanelShading;
  const visSun = showSun && L.showSun;

  const mRoof = assembly.materials.roof;
  const mObs = assembly.materials.obstacle;
  const mExt = assembly.materials.extension;
  const shellIdForInspect = scene.buildingShell?.id ?? "calpinage-building-shell";
  const shellInspectSelected =
    shellGeo != null && isInspectSelected(inspectionSelection, "SHELL", shellIdForInspect);
  const mEdge = assembly.materials.roofEdgeLine;
  const mRidge = assembly.materials.structuralRidgeLine;
  const pvB = assembly.pvBoost;
  const livePvPanelTexture = useMemo(() => getPvPanelTexture("live"), []);

  /**
   * Couleurs hex par instance pour PvPanelInstanced — même logique que panelSurfaceMaterial.
   * Dépendances : toutes déclarées au-dessus (pvB, visPanelShading, pv3dOverlayPanelById, etc.).
   */
  const panelInstanceColors = useMemo(() => {
    return scene.pvPanels.map((p) => {
      const id = String(p.id);
      const pvSel = isInspectSelected(inspectionSelection, "PV_PANEL", id);
      const pv3dPanel = pvLayout3DInteractionMode ? pv3dOverlayPanelById.get(id) : null;
      const pv3dSelected = !!pv3dPanel?.selected;
      const pv3dInvalid = !!pv3dPanel?.invalid;
      if (pv3dInvalid) {
        return new THREE.Color(SOLARNEXT_3D_PREMIUM_THEME.pv.invalidFill).getHex();
      }
      return panelSurfaceMaterial(
        scene,
        id,
        visPanelShading,
        pvSel || pv3dSelected,
        pvB.panelEmissiveIntensityBonus,
      ).color;
    });
  }, [
    scene,
    visPanelShading,
    inspectionSelection,
    pvLayout3DInteractionMode,
    pv3dOverlayPanelById,
    pvB.panelEmissiveIntensityBonus,
  ]);

  const showRoofModelingHoverUx =
    roofModelingSurfaceUx && (inspectMode || panSelection3DMode) && onRoofModelingPointerUi != null;

  const arrowRef = useMemo(() => {
    const dir = new THREE.Vector3(sunUnit.x, sunUnit.y, sunUnit.z).normalize();
    const origin = center.clone().add(new THREE.Vector3(0, 0, maxDimLocal * 0.4));
    const len = maxDimLocal * 0.5;
    return new THREE.ArrowHelper(dir, origin, len, 0xffb74d, len * 0.12, len * 0.08);
  }, [sunUnit.x, sunUnit.y, sunUnit.z, center, maxDimLocal]);

  useEffect(() => {
    return () => {
      arrowRef.dispose();
    };
  }, [arrowRef]);

  const panVertexSelectionMarker = useMemo(() => {
    if (!roofVertexMarker) return null;
    return (
      <PanVertexSelectionMarkerMesh
        position={roofVertexMarker.position}
        pickPosition={roofVertexMarker.pickPosition}
        pickHitRadius={roofVertexMarker.pickHitRadius}
        radius={roofVertexMarker.radius}
        interactive={roofVertexMarker.interactiveZDrag}
        onPointerDown={roofVertexMarker.onMarkerPointerDown}
      />
    );
  }, [roofVertexMarker]);

  return (
    <>
      <ViewerLighting
        center={center}
        maxDim={maxDimLocal}
        ambientScale={assembly.lighting.ambientScale}
        keyScale={assembly.lighting.keyScale}
        fillScale={assembly.lighting.fillScale}
        qualityProfile={qualityProfile}
      />
      {shellGeo && (
        <mesh
          geometry={shellGeo}
          castShadow={qualityProfile.shadows}
          receiveShadow={qualityProfile.shadows}
          position={[0, 0, 0]}
          userData={inspectData("SHELL", shellIdForInspect, "shell_tessellation")}
          onClick={inspectMode ? onInspectClick : undefined}
        >
          <meshStandardMaterial
            color={autopsyDevColors ? "#ff00ff" : VIEWER_SHELL_MESH_HEX}
            metalness={0.05}
            roughness={0.88}
            side={THREE.DoubleSide}
            polygonOffset
            {...getDepthOffset("BUILDING_SHELL")}
            emissive={shellInspectSelected ? SOLARNEXT_3D_PREMIUM_THEME.shell.selectedEmissive : "#000000"}
            emissiveIntensity={shellInspectSelected ? 0.1 : 0}
          />
          {inspectMode && shellInspectSelected && (
            <Outlines
              thickness={outlineThickness}
              color={VIEWER_INSPECT_OUTLINE_HEX.shell}
              opacity={0.95}
              toneMapped={false}
            />
          )}
        </mesh>
      )}
      {visRoof && (
        <RoofPansMesh
          roofGeos={roofGeos}
          inspectionSelection={inspectionSelection}
          inspectMode={inspectMode}
          panSelection3DMode={panSelection3DMode}
          selectedHit={selectedHit}
          satelliteTexture={satelliteTexture ?? null}
          autopsyDevColors={autopsyDevColors}
          onRoofMeshClick={onRoofMeshClick}
          onInspectClick={onInspectClick}
          showRoofModelingHoverUx={showRoofModelingHoverUx}
          onRoofModelingPointerUi={onRoofModelingPointerUi}
          onRoofTessellationPv3dProbePointerDown={onRoofTessellationPv3dProbePointerDown}
          outlineThickness={outlineThickness}
          mRoof={mRoof}
          roofClosureGeo={roofClosureGeo}
          visRoofEdges={visRoofEdges}
          edgeGeo={edgeGeo}
          mEdge={mEdge}
          visRidges={visRidges}
          ridgeGeo={ridgeGeo}
          mRidge={mRidge}
          enableStructuralRidgeHeightEdit={enableStructuralRidgeHeightEdit ?? false}
          onStructuralRidgeLinePointerDown={onStructuralRidgeLinePointerDown}
          panVertexSelectionMarker={panVertexSelectionMarker}
        />
      )}
      {visObs && (
        <ObstaclesMesh
          obsGeos={obsGeos}
          inspectionSelection={inspectionSelection}
          mObs={mObs}
          inspectMode={inspectMode}
          onInspectClick={onInspectClick}
          roofModelingPassThroughOccluders={roofModelingPassThroughOccluders}
          pvLayout3DInteractionMode={pvLayout3DInteractionMode ?? false}
          outlineThickness={outlineThickness}
        />
      )}
      {visExt && (
        <>
          {extGeos.map(({ id, geo, miniRoofLines }) => {
            const sid = String(id);
            const sel = isInspectSelected(inspectionSelection, "EXTENSION", sid);
            return (
              <group key={`ext-${id}`}>
                <mesh
                  userData={inspectData("EXTENSION", sid)}
                  geometry={geo}
                  castShadow={qualityProfile.shadows}
                  receiveShadow={qualityProfile.shadows}
                  raycast={(roofModelingPassThroughOccluders || pvLayout3DInteractionMode) ? roofModelingSkipOccluderRaycast : undefined}
                  onClick={inspectMode ? onInspectClick : undefined}
                >
                  <meshStandardMaterial
                    color={mExt.color}
                    metalness={mExt.metalness}
                    roughness={mExt.roughness}
                    flatShading={mExt.flatShading ?? false}
                    side={THREE.DoubleSide}
                    emissive={sel ? SOLARNEXT_3D_PREMIUM_THEME.extension.selectedEmissive : "#000000"}
                    emissiveIntensity={sel ? 0.22 : 0}
                  />
                  {inspectMode && sel && (
                    <Outlines
                      thickness={outlineThickness}
                      color={VIEWER_INSPECT_OUTLINE_HEX.extension}
                      opacity={0.95}
                      toneMapped={false}
                    />
                  )}
                </mesh>
                {miniRoofLines.map((line) => (
                  <lineSegments key={`ext-mini-roof-${id}-${line.role}`} geometry={line.geometry} renderOrder={18}>
                    <lineBasicMaterial
                      color={
                        line.role === "ridge"
                          ? SOLARNEXT_3D_PREMIUM_THEME.extension.ridge
                          : line.role === "hip"
                            ? SOLARNEXT_3D_PREMIUM_THEME.extension.hip
                            : line.role === "support_seam"
                              ? SOLARNEXT_3D_PREMIUM_THEME.extension.supportSeam
                              : SOLARNEXT_3D_PREMIUM_THEME.extension.eave
                      }
                      transparent
                      opacity={line.role === "support_seam" ? 0.68 : 0.82}
                      toneMapped={false}
                      depthTest
                    />
                  </lineSegments>
                ))}
              </group>
            );
          })}
          {import.meta.env.DEV &&
            extensionVolDebugLevel >= 1 &&
            extensionVolDebugEdgesGeos.map(({ id, edges }) => (
              <lineSegments key={`ext-dbg-edges-${id}`} geometry={edges} renderOrder={88}>
                <lineBasicMaterial color="#18ffff" toneMapped={false} transparent opacity={0.92} depthTest />
              </lineSegments>
            ))}
          {import.meta.env.DEV &&
            extensionVolDebugLevel >= 2 &&
            extensionVolDebugNormalsGeos.map(({ id, normals }) => (
              <lineSegments key={`ext-dbg-nrm-${id}`} geometry={normals} renderOrder={89}>
                <lineBasicMaterial color="#fff176" toneMapped={false} transparent opacity={0.88} depthTest />
              </lineSegments>
            ))}
        </>
      )}
      {pvLayout3DInteractionMode &&
        pv3dSafeZoneGeos.map(({ id, ribbon, line }) => (
          <group key={`pv3d-safe-${id}`}>
            {ribbon ? (
              <mesh geometry={ribbon} renderOrder={22}>
                <meshBasicMaterial
                  color={PV3D_SAFE_ZONE_LINE}
                  transparent
                  opacity={0.78}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  depthTest
                  toneMapped={false}
                  polygonOffset
                  {...getDepthOffset("CONTOUR_LINE")}
                />
              </mesh>
            ) : null}
            {line ? (
              <lineSegments geometry={line} renderOrder={23}>
                <lineBasicMaterial color="#fecaca" transparent opacity={0.88} depthWrite={false} toneMapped={false} depthTest />
              </lineSegments>
            ) : null}
          </group>
        ))}
      {pvLayout3DInteractionMode &&
        pv3dExtensionSafeZoneGeos.map(({ id, ribbon, line }) => (
          <group key={`pv3d-ext-safe-${id}`}>
            {ribbon ? (
              <mesh geometry={ribbon} renderOrder={23}>
                <meshBasicMaterial
                  color={PV3D_SAFE_ZONE_LINE}
                  transparent
                  opacity={0.24}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  depthTest
                  toneMapped={false}
                  polygonOffset
                  {...getDepthOffset("CONTOUR_LINE")}
                />
              </mesh>
            ) : null}
            {line ? (
              <lineSegments geometry={line} renderOrder={24}>
                <lineBasicMaterial color={PV3D_SAFE_ZONE_LINE} transparent opacity={0.48} depthWrite={false} toneMapped={false} depthTest />
              </lineSegments>
            ) : null}
          </group>
        ))}
      {extensionKeepoutFillGeos.map(({ id, fill }) => (
        <mesh key={`ext-keepout-fill-${id}`} geometry={fill} renderOrder={22}>
          <meshBasicMaterial color="#cc0000" transparent opacity={0.65} depthWrite={false} side={THREE.DoubleSide} toneMapped={false} />
        </mesh>
      ))}
      {pvLayout3DInteractionMode &&
        pv3dGhostGeos.map(({ id, fill, line, valid, excluded, source }) => (
          <group key={`pv3d-ghost-${id}`}>
            {fill ? (
              <mesh geometry={fill} renderOrder={24}>
                <meshBasicMaterial
                  color={
                    valid
                      ? excluded
                        ? PV3D_GHOST_EXCLUDED_FILL
                        : source === "autofill"
                          ? PV3D_GHOST_AUTOFILL_FILL
                          : PV3D_GHOST_VALID_FILL
                      : PV3D_GHOST_INVALID_FILL
                  }
                  transparent
                  opacity={valid ? (excluded ? 0.14 : 0.35) : 0.22}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  depthTest
                  toneMapped={false}
                />
              </mesh>
            ) : null}
            {line ? (
              <lineSegments geometry={line} renderOrder={25}>
                <lineBasicMaterial
                  color={
                    valid
                      ? excluded
                        ? PV3D_GHOST_EXCLUDED_LINE
                        : source === "autofill"
                          ? PV3D_GHOST_AUTOFILL_LINE
                          : PV3D_GHOST_VALID_LINE
                      : PV3D_GHOST_INVALID_LINE
                  }
                  transparent
                  opacity={valid ? (excluded ? 0.55 : 0.6) : 0.88}
                  depthWrite={false}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
          </group>
        ))}
      {pvLayout3DInteractionMode &&
        pv3dOverlayPanelGeos.map(({ id, fill, line, selected, invalid }) => (
          <group key={`pv3d-overlay-panel-solid-${id}`}>
            {fill ? (
              <mesh geometry={fill} renderOrder={26}>
                <meshStandardMaterial
                  color={invalid ? PREMIUM_PV_INVALID_FILL : PV3D_OVERLAY_PANEL_FILL}
                  emissive={invalid ? SOLARNEXT_3D_PREMIUM_THEME.pv.invalidEmissive : PV3D_OVERLAY_PANEL_EMISSIVE}
                  emissiveIntensity={invalid ? 0.2 : selected ? 0.14 : 0.1}
                  metalness={0.18}
                  roughness={0.38}
                  envMapIntensity={0.85}
                  transparent={invalid}
                  opacity={invalid ? 0.78 : 1}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  depthTest
                  polygonOffset
                  {...getDepthOffset("PV_PANEL")}
                />
              </mesh>
            ) : null}
            {line ? (
              <lineSegments geometry={line} renderOrder={27}>
                <lineBasicMaterial
                  color={
                    invalid
                      ? SOLARNEXT_3D_PREMIUM_THEME.pv.invalidLine
                      : selected
                        ? SOLARNEXT_3D_PREMIUM_THEME.pv.selectedLine
                        : PV3D_OVERLAY_PANEL_EDGE
                  }
                  transparent
                  opacity={invalid ? 1 : selected ? 0.92 : 0.58}
                  depthWrite={false}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
          </group>
        ))}
      {pvLayout3DInteractionMode &&
        pv3dSelectedPanelGeos.map(({ id, fill, line, invalid }) => (
          <group key={`pv3d-selected-${id}`}>
            {fill ? (
              <mesh geometry={fill} renderOrder={28}>
                <meshBasicMaterial
                  color={invalid ? SOLARNEXT_3D_PREMIUM_THEME.pv.invalidFill : SOLARNEXT_3D_PREMIUM_THEME.pv.selectedFill}
                  transparent
                  opacity={invalid ? 0.28 : 0.22}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  depthTest
                  toneMapped={false}
                />
              </mesh>
            ) : null}
            {line ? (
              <lineSegments geometry={line} renderOrder={29}>
                <lineBasicMaterial
                  color={invalid ? SOLARNEXT_3D_PREMIUM_THEME.pv.invalidLine : SOLARNEXT_3D_PREMIUM_THEME.pv.selectedLine}
                  transparent
                  opacity={invalid ? 1 : 0.95}
                  depthWrite={false}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
          </group>
        ))}
      {pvLayout3DInteractionMode &&
        pv3dLivePanelGeos.map(({ id, fill, line, selected, invalid, enabled }) => (
          <group key={`pv3d-live-${id}`}>
            {fill ? (
              <mesh geometry={fill} renderOrder={30}>
                <meshStandardMaterial
                  color={invalid ? PREMIUM_PV_INVALID_FILL : selected ? PREMIUM_PV_SELECTED_FILL : PREMIUM_PV_LIVE_FILL}
                  map={invalid ? undefined : livePvPanelTexture}
                  emissive={
                    invalid
                      ? SOLARNEXT_3D_PREMIUM_THEME.pv.invalidEmissive
                      : selected
                        ? SOLARNEXT_3D_PREMIUM_THEME.pv.selectedEmissive
                        : SOLARNEXT_3D_PREMIUM_THEME.pv.liveEmissive
                  }
                  emissiveIntensity={invalid ? 0.34 : selected ? 0.18 : 0.08}
                  metalness={pvB.panelMetalness}
                  roughness={pvB.panelRoughness}
                  envMapIntensity={1.05}
                  transparent={invalid || enabled === false}
                  opacity={invalid ? 0.74 : enabled === false ? 0.42 : 1}
                  // depthWrite=false : le fill live ne doit pas occulter son outline.
                  // La profondeur de la scène opaque (toiture, bâtiment) est déjà dans
                  // le depth buffer au moment du rendu overlay.
                  depthWrite={false}
                  side={THREE.DoubleSide}
                  polygonOffset
                  {...getDepthOffset("PV_PANEL")}
                  depthTest
                />
              </mesh>
            ) : null}
            {line ? (
              <lineSegments geometry={line} renderOrder={31}>
                <lineBasicMaterial
                  color={invalid ? SOLARNEXT_3D_PREMIUM_THEME.pv.invalidLine : SOLARNEXT_3D_PREMIUM_THEME.pv.selectedLine}
                  transparent
                  opacity={invalid ? 1 : 0.95}
                  depthWrite={false}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
          </group>
        ))}
      {visPanels && (
        <PvPanelsLayer
          panels={scene.pvPanels}
          panelColors={panelInstanceColors}
          pvPanelEmissiveIntensityBonus={pvB.panelEmissiveIntensityBonus}
          pvPanelMetalness={pvB.panelMetalness}
          pvPanelRoughness={pvB.panelRoughness}
          pvLayout3DInteractionMode={pvLayout3DInteractionMode ?? false}
          pvLayout3DEffectiveHiddenIds={pvLayout3DEffectiveHiddenIds}
          pvPanelRaycastPassThrough={pvPanelRaycastPassThrough}
          inspectMode={inspectMode}
          onInspectClick={onInspectClick}
          onPvPanelPvLayout3dPointerDown={onPvPanelPvLayout3dPointerDown}
          onPanelHover={onPanelHover}
          panelGeos={panelGeos}
          inspectionSelection={inspectionSelection}
          outlineThickness={outlineThickness}
        />
      )}
      {visSun && <primitive object={arrowRef} />}
    </>
  );
}

export function SolarScene3DViewer({
  scene: sceneProp,
  runtimeScene,
  reliabilityState,
  className,
  height = 420,
  showRoof = true,
  showRoofTruthBadges = false,
  showMissingHeightAlerts = true,
  showMultiPanDiagnostics = false,
  showRoofEdges = true,
  showObstacles = true,
  showExtensions = true,
  showPanels = true,
  showPanelShading = true,
  showShadingLegend = true,
  inspectMode = false,
  panSelection3DMode = false,
  calpinagePansForProvenance,
  showSun = true,
  sunDirectionIndex = 0,
  showDebugOverlay = false,
  showXYAlignmentOverlay = false,
  groundImage,
  debugRuntime,
  selectedModulePowerWc,
  cameraViewMode: cameraViewModeControlled,
  onCameraViewModeChange,
  defaultCameraViewMode,
  showCameraViewModeToggle = false,
  premiumViewMode: premiumViewModeControlled,
  onPremiumViewModeChange,
  geometryValidationReport = null,
  premiumAssemblyOverride = null,
  showPremiumGeometryTrustStripe,
  showPremiumViewModeToolbar = false,
  enableRoofVertexZEdit = false,
  onRoofVertexHeightCommit,
  enableRoofVertexXYEdit = false,
  onRoofVertexXYCommit,
  roofModelingHistory = null,
  enableStructuralRidgeHeightEdit = false,
  onStructuralRidgeHeightCommit,
  roofHeightAssistant = null,
  pvLayout3DInteractionMode = false,
  onPanelMoveCommit,
  enablePostProcessing = true,
  showStatsGl = false,
  qualityMode: qualityModeControlled,
  onQualityModeChange,
  horizonMask = null,
}: SolarScene3DViewerProps) {
  const baseScene = sceneProp ?? runtimeScene;
  if (baseScene == null) {
    throw new Error("[SolarScene3DViewer] Fournir `scene` ou `runtimeScene` (SolarScene3D).");
  }
  const scene = baseScene;

  // Reflet de window.CALPINAGE_STATE depuis le store Zustand — aucune lecture directe de window.
  // Mis à jour à chaque "phase3:update" par legacyCalpinageStateAdapter.
  const roofRawState = useCalpinageStore((s) => s.roofRawState);
  const phase3PowerSnapshot = useCalpinageStore((s) => s.phase3);
  const selectedPvModulePower = useMemo(() => {
    if (selectedModulePowerWc != null) {
      return {
        unitPowerWc: selectedModulePowerWc,
        source: "runtime_panel_spec" as const,
        moduleId: null,
      };
    }
    return resolveSelectedPvModulePower({
      selectedPanelId: phase3PowerSnapshot.selectedPanelId,
      selectedPanel: phase3PowerSnapshot.pvSelectedPanel,
      panelCatalog: phase3PowerSnapshot.panelCatalog,
      runtimeSnapshot: debugRuntime,
    });
  }, [
    debugRuntime,
    phase3PowerSnapshot.panelCatalog,
    phase3PowerSnapshot.pvSelectedPanel,
    phase3PowerSnapshot.selectedPanelId,
    selectedModulePowerWc,
  ]);

  // Feature flags 3D — A2 : lecture via Context (plus de window.__CALPINAGE_3D_PV_PLACE_PROBE__).
  const { pvPlaceProbe } = useCalpinageFeatures();

  const [internalQualityMode, setInternalQualityMode] = useState<ViewerQualityMode>("AUTO");
  const qualityMode = qualityModeControlled ?? internalQualityMode;
  const [effectiveQualityTier, setEffectiveQualityTier] = useState<ViewerQualityTier>(() => {
    const initial = resolveInitialViewerQualityTier(readViewerDeviceCapabilitySignals());
    return isViewerQualityManual(qualityModeControlled ?? "AUTO") ? (qualityModeControlled as ViewerQualityTier) : initial;
  });
  const lastQualityTierChangeAtRef = useRef(0);
  const setQualityMode = useCallback(
    (mode: ViewerQualityMode) => {
      onQualityModeChange?.(mode);
      if (qualityModeControlled === undefined) setInternalQualityMode(mode);
      if (isViewerQualityManual(mode)) {
        setEffectiveQualityTier(mode);
        lastQualityTierChangeAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
      }
    },
    [onQualityModeChange, qualityModeControlled],
  );

  useEffect(() => {
    if (isViewerQualityManual(qualityMode)) {
      setEffectiveQualityTier(qualityMode);
      lastQualityTierChangeAtRef.current = typeof performance !== "undefined" ? performance.now() : Date.now();
    }
  }, [qualityMode]);

  const onViewerPerformanceWindow = useCallback(
    (stats: ViewerFrameWindowStats, nowMs: number) => {
      if (qualityMode !== "AUTO") return;
      setEffectiveQualityTier((current) => {
        const next = resolveViewerQualityTransition({
          mode: qualityMode,
          currentTier: current,
          stats,
          nowMs,
          lastTierChangeAtMs: lastQualityTierChangeAtRef.current,
        });
        if (next.tier === current) return current;
        lastQualityTierChangeAtRef.current = nowMs;
        return next.tier;
      });
    },
    [qualityMode],
  );

  const qualityProfile = VIEWER_QUALITY_PROFILES[effectiveQualityTier];
  const effectiveDpr = clampViewerDpr(
    typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1,
    qualityProfile,
  );

  const [extensionVolDebugLevel, setExtensionVolDebugLevel] = useState<0 | 1 | 2>(0);
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const onKey = (e: KeyboardEvent) => {
      if (!e.shiftKey || !e.altKey || e.code !== "KeyE") return;
      const t = e.target as HTMLElement | null;
      if (t?.closest?.("input, textarea, select, [contenteditable=true]")) return;
      e.preventDefault();
      setExtensionVolDebugLevel((v) => {
        const n = ((v + 1) % 3) as 0 | 1 | 2;
        const labels = ["off", "fil de fer extensions", "fil de fer + normales faces"] as const;
        console.info(`[Calpinage3D] debug volumes extension : ${labels[n]} — Shift+Alt+E`);
        return n;
      });
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!import.meta.env.DEV) return;
    console.log("[3D DRAG] displayedScene", {
      sceneCreatedAt: scene.metadata.createdAtIso,
      patchCount: scene.roofModel.roofPlanePatches.length,
    });
  }, [scene]);

  /**
   * Mode caméra initial : toujours SCENE_3D (perspective orbitale libre).
   * La vue de départ est quasiment zénithale (VIEWER_DEFAULT_CAMERA_OFFSET ≈ top-down)
   * pour une transition imperceptible depuis la 2D Konva.
   * Le prop `defaultCameraViewMode` prime sur ce défaut si fourni explicitement.
   */
  const effectiveDefaultViewMode: CameraViewMode =
    defaultCameraViewMode ?? DEFAULT_CAMERA_VIEW_MODE;
  const [internalViewMode, setInternalViewMode] = useState<CameraViewMode>(effectiveDefaultViewMode);
  const cameraViewMode = cameraViewModeControlled ?? internalViewMode;
  const setCameraViewMode = useCallback(
    (mode: CameraViewMode) => {
      onCameraViewModeChange?.(mode);
      if (cameraViewModeControlled === undefined) setInternalViewMode(mode);
    },
    [cameraViewModeControlled, onCameraViewModeChange],
  );

  const [internalPremiumMode, setInternalPremiumMode] = useState<PremiumHouse3DViewMode>("presentation");
  const premiumMode = premiumViewModeControlled ?? internalPremiumMode;
  const setPremiumMode = useCallback(
    (m: PremiumHouse3DViewMode) => {
      onPremiumViewModeChange?.(m);
      if (premiumViewModeControlled === undefined) setInternalPremiumMode(m);
    },
    [premiumViewModeControlled, onPremiumViewModeChange],
  );

  const premiumAssembly = useMemo(
    () =>
      premiumAssemblyOverride ??
      buildPremiumHouse3DScene({
        scene,
        viewMode: premiumMode,
        geometryValidationReport,
      }),
    [premiumAssemblyOverride, scene, premiumMode, geometryValidationReport],
  );

  const effectiveFrameloop =
    pvLayout3DInteractionMode || cameraViewMode === "SCENE_3D"
      ? "always"
      : qualityProfile.frameloop;

  const geometryBox = useMemo(() => computeSolarSceneBoundingBox(scene), [scene]);
  const effectiveReliabilityState = useMemo(
    () =>
      reliabilityState ??
      resolveViewerReliabilityState({
        scene,
        source: "OFFICIAL",
        generation: 0,
        renderedGeneration: 0,
        officialBuildStatus: "SUCCESS",
      }),
    [reliabilityState, scene],
  );

  const groundPlaneConfig = useMemo(() => {
    if (!groundImage?.dataUrl || !groundImage.widthPx || !groundImage.heightPx) return null;
    const wc = scene.worldConfig;
    if (!wc || !Number.isFinite(wc.metersPerPixel) || wc.metersPerPixel <= 0) return null;
    return {
      image: groundImage,
      metersPerPixel: wc.metersPerPixel,
      northAngleDeg: wc.northAngleDeg,
    };
  }, [groundImage, scene.worldConfig]);

  // ── Texture satellite toiture ──────────────────────────────────────────────────────────────
  // Instance séparée du fond plan (même image, même paramètres) pour disposer les UVs sur les pans.
  const roofSatelliteRawTexture = useDataUrlTexture(groundPlaneConfig?.image.dataUrl ?? "");

  /** Correction crop : même logique que GroundPlaneTexture — aligne le sous-rectangle déclaré. */
  useLayoutEffect(() => {
    if (!roofSatelliteRawTexture || !groundPlaneConfig) return;
    applyTextureCropToMatch2DCanvas(
      roofSatelliteRawTexture,
      groundPlaneConfig.image.widthPx,
      groundPlaneConfig.image.heightPx,
    );
  }, [roofSatelliteRawTexture, groundPlaneConfig]);

  /**
   * Projection top-down : (wx, wy) monde → UV [0,1] en espace déclaré.
   * u = xPx / declaredW, v = 1 − yPx / declaredH
   * La correction repeat/offset du texture gère l'éventuel bitmap surdimensionné.
   */
  const satelliteUvMapper = useMemo(():
    | ((wx: number, wy: number) => { u: number; v: number })
    | null => {
    if (!groundPlaneConfig) return null;
    const {
      metersPerPixel,
      northAngleDeg,
      image: { widthPx, heightPx },
    } = groundPlaneConfig;
    return (wx: number, wy: number) => {
      const { xPx, yPx } = worldHorizontalMToImagePx(wx, wy, metersPerPixel, northAngleDeg);
      return { u: xPx / widthPx, v: 1 - yPx / heightPx };
    };
  }, [groundPlaneConfig]);

  /** Texture prête (image chargée + crop appliqué) — null si pas encore chargée ou pas de config. */
  const satelliteTexture =
    roofSatelliteRawTexture && groundPlaneConfig ? roofSatelliteRawTexture : null;
  // ─────────────────────────────────────────────────────────────────────────────────────────────

  /** Bbox passée à `CameraFramingRig` : géométrie ∪ emprise image satellite (si fond plan présent). */
  const framingBox = useMemo(() => {
    if (!groundPlaneConfig) return geometryBox;
    const { widthPx, heightPx } = groundPlaneConfig.image;
    if (!(widthPx > 0) || !(heightPx > 0)) return geometryBox;
    return extendBoundingBoxWithSatelliteImageFootprint(
      geometryBox,
      widthPx,
      heightPx,
      groundPlaneConfig.metersPerPixel,
      groundPlaneConfig.northAngleDeg,
    );
  }, [geometryBox, groundPlaneConfig]);

  const { center, maxDim } = useMemo(() => {
    const c = new THREE.Vector3();
    const s = new THREE.Vector3();
    geometryBox.getCenter(c);
    geometryBox.getSize(s);
    return { center: c, maxDim: Math.max(s.x, s.y, s.z, 1) };
  }, [geometryBox]);

  const [panelHover, setPanelHover] = useState<PanelHover>(null);
  const [inspectionSelection, setInspectionSelection] = useState<SceneInspectionSelection | null>(null);
  const [selectedHit, setSelectedHit] = useState<ScenePickHit | null>(null);
  const [orbitSuppressed, setOrbitSuppressed] = useState(false);
  const [roofPickHover, setRoofPickHover] = useState<{
    readonly clientX: number;
    readonly clientY: number;
    readonly label: string;
  } | null>(null);
  const [glCursor, setGlCursor] = useState("");
  const [roofZDragSession, setRoofZDragSession] = useState<RoofZDragSession | null>(null);
  const [roofZDragPreviewM, setRoofZDragPreviewM] = useState<number | null>(null);
  const [structuralHeightSelection, setStructuralHeightSelection] = useState<LegacyStructuralHeightSelection | null>(
    null,
  );
  // A10 — anti-pattern useState+useRef+useEffect(async-sync) éliminé.
  // Le ref de session Z (dead-code : jamais lu dans les handlers) est supprimé.
  // La session PV est désormais gérée par usePvPanelDrag (architecture sync-first).
  const zDragSessionImmediateRef = useRef<RoofZDragSession | null>(null);
  const zDragGestureActiveRef = useRef(false);
  // usePvPanelDrag : sessionRef mis à jour AVANT setSession → pas de ref stale.
  const pvPanelDrag = usePvPanelDrag();
  // useRoofVertexDrag : state de haut niveau du geste sommet (complète zDragSessionImmediateRef).
  const roofVertexDrag = useRoofVertexDrag(scene);
  void roofVertexDrag;

  // CommandBus — instance isolée par composant (pattern Strangler Fig).
  // Stable sur toute la durée de vie du composant (useMemo sans deps).
  const commandBus: CommandBus = useMemo(() => createCommandBus(), []);

  // Abonner le handler MOVE_PV_PANEL au bus pour la durée de vie du composant.
  useEffect(() => {
    return commandBus.subscribe((cmd) => {
      if (cmd.type === "MOVE_PV_PANEL") movePvPanelHandler(cmd);
    });
  }, [commandBus]);
  // pvRebuildBlockPanelIds supprimé : la déduplication par blockId dans
  // buildCanonicalPlacedPanelsFromRuntime garantit l'unicité des panneaux dans pvPanels.
  // Aucun panneau fantôme ne peut subsister après rebuild → workaround inutile.
  const zDragLiveCommitRafRef = useRef<number | null>(null);
  const zDragLivePendingHeightRef = useRef<number | null>(null);
  const zEditUnarmedLoggedRef = useRef(false);
  const zDragCommitTargetRef = useRef<{ readonly panId: string; readonly vertexIndex: number } | null>(
    null,
  );
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);

  // ── Gestes tactiles (pinch-zoom + tap) ─────────────────────────────────────
  // Coexistence souris/touch : pointer events unifient les deux sources sans
  // double-déclenchement. OrbitControls reste le système de base (pan/orbite).
  // touch-action:none est posé sur le wrapper div ET sur gl.domElement (onCreated).
  const { wrapperPointerProps } = useViewerGestures({ orbitControlsRef });
  const onRoofVertexHeightCommitRef = useRef(onRoofVertexHeightCommit);
  onRoofVertexHeightCommitRef.current = onRoofVertexHeightCommit;
  const zDragTelemetrySessionIdRef = useRef<string | null>(null);
  const zDragTelemetryStartMsRef = useRef(0);
  const zDragViewerCommitInvocationCountRef = useRef(0);

  useEffect(() => {
    if (!import.meta.env.DEV || zEditUnarmedLoggedRef.current) return;
    const misconfigured =
      (enableRoofVertexZEdit && !onRoofVertexHeightCommit) ||
      (!enableRoofVertexZEdit && !!onRoofVertexHeightCommit);
    if (misconfigured) {
      zEditUnarmedLoggedRef.current = true;
      console.warn("[3D DRAG] Z edit disabled or unarmed", {
        enableRoofVertexZEdit,
        hasOnCommit: !!onRoofVertexHeightCommit,
      });
    }
  }, [enableRoofVertexZEdit, onRoofVertexHeightCommit]);

  const onRoofModelingPointerUi = useCallback((p: RoofModelingPointerUi) => {
    if (!p) {
      setRoofPickHover(null);
      setGlCursor("");
      return;
    }
    setRoofPickHover({ clientX: p.clientX, clientY: p.clientY, label: p.label });
    setGlCursor(p.cursor ?? "pointer");
  }, []);

  useEffect(() => {
    if (!inspectMode) setInspectionSelection(null);
  }, [inspectMode]);

  useEffect(() => {
    if (!panSelection3DMode) setSelectedHit(null);
  }, [panSelection3DMode]);

  useEffect(() => {
    if (!inspectMode && !panSelection3DMode) {
      setOrbitSuppressed(false);
      setRoofPickHover(null);
      setGlCursor("");
    }
  }, [inspectMode, panSelection3DMode]);

  const onInspectClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!inspectMode) return;
      e.stopPropagation();
      const picked = pickInspectableIntersection(e.intersections);
      if (picked) setInspectionSelection(picked);
    },
    [inspectMode],
  );

  const onRoofMeshClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      /** En mode pose PV 3D, le clic toiture est réservé au placement de panneaux — pas d'édition sommet. */
      if (pvLayout3DInteractionMode) return;
      const allowStructuralPick = enableStructuralRidgeHeightEdit && onStructuralRidgeHeightCommit;
      if (!inspectMode && !panSelection3DMode && !allowStructuralPick) return;
      e.stopPropagation();

      const wc = scene.worldConfig;
      if (allowStructuralPick && wc) {
        const p = e.point;
        const img = worldPointToImage({ x: p.x, y: p.y, z: p.z }, wc);
        const rt = debugRuntime ?? roofRawState;
        const sel = resolveNearestStructuralHeightSelectionFromImagePx(
          rt,
          { x: img.x, y: img.y },
          STRUCTURAL_RIDGE_RESOLVE_MAX_DIST_IMG_PX,
        );
        if (sel) {
          setSelectedHit(null);
          setInspectionSelection(null);
          setStructuralHeightSelection(sel);
          setOrbitSuppressed(true);
          return;
        }
      }

      if (inspectMode) {
        const picked = pickInspectableIntersection(e.intersections);
        if (picked) setInspectionSelection(picked);
      }
      if (panSelection3DMode) {
        const cam = e.camera;
        const gl = r3fGl(e);
        const ne = e.nativeEvent;
        let hit: ScenePickHit | null = null;
        if (cam && gl?.domElement) {
          hit = pickSceneHitForRoofVertexModeling(e.intersections, {
            camera: cam,
            canvasRect: gl.domElement.getBoundingClientRect(),
            clientX: ne.clientX,
            clientY: ne.clientY,
          });
        }
        if (hit?.kind === "roof_vertex") {
          setSelectedHit(hit);
        } else {
          setSelectedHit(null);
        }
      }
    },
    [
      debugRuntime,
      roofRawState,
      enableStructuralRidgeHeightEdit,
      inspectMode,
      onStructuralRidgeHeightCommit,
      panSelection3DMode,
      scene.worldConfig,
    ],
  );

  const finalizeRoofZDrag = useCallback(() => {
    zDragGestureActiveRef.current = false;
    zDragSessionImmediateRef.current = null;
    if (zDragLiveCommitRafRef.current != null) {
      cancelAnimationFrame(zDragLiveCommitRafRef.current);
      zDragLiveCommitRafRef.current = null;
    }
    const pendingH = zDragLivePendingHeightRef.current;
    const tgt = zDragCommitTargetRef.current;
    const commit = onRoofVertexHeightCommitRef.current;
    const dragSid = zDragTelemetrySessionIdRef.current;
    const markerTrace: RoofVertexHeightEdit["trace"] | undefined =
      dragSid != null ? { dragSessionId: dragSid, source: "3d_marker_drag" } : undefined;
    if (pendingH != null && tgt && commit) {
      commit({
        panId: tgt.panId,
        vertexIndex: tgt.vertexIndex,
        heightM: pendingH,
        ...(markerTrace ? { trace: markerTrace } : {}),
      });
      if (dragSid != null) zDragViewerCommitInvocationCountRef.current += 1;
    }
    zDragLivePendingHeightRef.current = null;
    const invocations = zDragViewerCommitInvocationCountRef.current;
    const startMs = zDragTelemetryStartMsRef.current;
    flushSync(() => {
      setRoofZDragSession(null);
      setRoofZDragPreviewM(null);
      zDragCommitTargetRef.current = null;
      setOrbitSuppressed(false);
    });
    if (dragSid != null) {
      emitRoofVertexZTelemetry({
        event: "roof_vertex_z_drag_end",
        dragSessionId: dragSid,
        durationMs: Math.max(0, performance.now() - startMs),
        viewerCommitInvocationCount: invocations,
        source: "3d_marker",
      });
      zDragTelemetrySessionIdRef.current = null;
    }
    const oc = orbitControlsRef.current;
    if (oc) oc.enabled = true;
  }, []);

  const finalizeRoofZDragRef = useRef(finalizeRoofZDrag);
  finalizeRoofZDragRef.current = finalizeRoofZDrag;

  /** Même callback métier que le slider ± / curseur de l’overlay ; throttle 1× par frame. */
  const liveRoofZCommitFromDrag = useCallback((z: number) => {
    setRoofZDragPreviewM(z);
    zDragLivePendingHeightRef.current = z;
    if (zDragLiveCommitRafRef.current != null) return;
    zDragLiveCommitRafRef.current = requestAnimationFrame(() => {
      zDragLiveCommitRafRef.current = null;
      const h = zDragLivePendingHeightRef.current;
      const target = zDragCommitTargetRef.current;
      const commit = onRoofVertexHeightCommitRef.current;
      if (h == null || !target || !commit) return;
      const dragSid = zDragTelemetrySessionIdRef.current;
      const markerTrace: RoofVertexHeightEdit["trace"] | undefined =
        dragSid != null ? { dragSessionId: dragSid, source: "3d_marker_drag" } : undefined;
      commit({
        panId: target.panId,
        vertexIndex: target.vertexIndex,
        heightM: h,
        ...(markerTrace ? { trace: markerTrace } : {}),
      });
      if (dragSid != null) zDragViewerCommitInvocationCountRef.current += 1;
      zDragLivePendingHeightRef.current = null;
    });
  }, []);

  const onRoofVertexMarkerPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!enableRoofVertexZEdit || !onRoofVertexHeightCommit) return;
      if (e.button !== 0) return;
      const t = getActiveRoofVertexModelingTarget(
        inspectMode,
        panSelection3DMode,
        inspectionSelection,
        selectedHit,
      );
      if (!t) return;
      const hit: ScenePickHit = {
        kind: "roof_vertex",
        roofPlanePatchId: t.patchId,
        vertexIndexInPatch: t.vertexIndex,
      };
      const wPos = roofVertexWorldFromScene(baseScene, hit);
      if (!wPos) return;
      const h0 = readVertexReferenceHeightM(calpinagePansForProvenance, t.patchId, t.vertexIndex, wPos.z);
      e.stopPropagation();
      const oc = orbitControlsRef.current;
      if (oc) oc.enabled = false;
      flushSync(() => {
        setOrbitSuppressed(true);
      });
      const gl = r3fGl(e);
      const cam = e.camera;
      const rect = gl.domElement.getBoundingClientRect();
      const zb = worldZFromPointerOnVerticalThroughXY(
        cam,
        e.nativeEvent.clientX,
        e.nativeEvent.clientY,
        rect,
        wPos.x,
        wPos.y,
      );
      const useScreenOnly = cameraViewMode === "PLAN_2D" || !Number.isFinite(zb);
      const rayZBaseline = Number.isFinite(zb) ? zb : null;
      try {
        gl.domElement.setPointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
      const session: RoofZDragSession = {
        panId: t.patchId,
        vertexIndex: t.vertexIndex,
        anchorXM: wPos.x,
        anchorYM: wPos.y,
        heightMStart: h0,
        rayZBaseline,
        useScreenOnly,
        startClientY: e.nativeEvent.clientY,
        pointerId: e.pointerId,
        minM: ROOF_VERTEX_EDIT_MIN_M,
        maxM: ROOF_VERTEX_EDIT_MAX_M,
      };
      zDragGestureActiveRef.current = true;
      const dragSid = generateRoofZDragSessionId();
      zDragTelemetrySessionIdRef.current = dragSid;
      zDragTelemetryStartMsRef.current = performance.now();
      zDragViewerCommitInvocationCountRef.current = 0;
      emitRoofVertexZTelemetry({
        event: "roof_vertex_z_drag_start",
        dragSessionId: dragSid,
        panId: t.patchId,
        vertexIndex: t.vertexIndex,
        startHeightM: h0,
        source: "3d_marker",
      });
      zDragCommitTargetRef.current = { panId: t.patchId, vertexIndex: t.vertexIndex };
      zDragSessionImmediateRef.current = session;
      setRoofZDragSession(session);
      setRoofZDragPreviewM(h0);
      if (import.meta.env.DEV) {
        console.log("[3D DRAG] start", { panId: t.patchId, vertexIndex: t.vertexIndex, startHeight: h0, dragSid });
      }
    },
    [
      enableRoofVertexZEdit,
      onRoofVertexHeightCommit,
      inspectMode,
      panSelection3DMode,
      inspectionSelection,
      selectedHit,
      baseScene,
      calpinagePansForProvenance,
      cameraViewMode,
    ],
  );

  // A10 : useEffect de sync async supprimé (le ref de session Z était dead-code).

  useEffect(() => {
    if (zDragGestureActiveRef.current) return;
    if (zDragLiveCommitRafRef.current != null) {
      cancelAnimationFrame(zDragLiveCommitRafRef.current);
      zDragLiveCommitRafRef.current = null;
    }
    zDragLivePendingHeightRef.current = null;
    setRoofZDragSession(null);
    setRoofZDragPreviewM(null);
    zDragSessionImmediateRef.current = null;
    zDragCommitTargetRef.current = null;
    setOrbitSuppressed(false);
    const oc = orbitControlsRef.current;
    if (oc) oc.enabled = true;
  }, [inspectionSelection, selectedHit]);

  const roofVertexMarker = useMemo(() => {
    const allowVertex =
      (enableRoofVertexZEdit || enableRoofVertexXYEdit) && (inspectMode || panSelection3DMode);
    if (!allowVertex) return null;
    const t = getActiveRoofVertexModelingTarget(
      inspectMode,
      panSelection3DMode,
      inspectionSelection,
      selectedHit,
    );
    if (!t) return null;
    const hit: ScenePickHit = {
      kind: "roof_vertex",
      roofPlanePatchId: t.patchId,
      vertexIndexInPatch: t.vertexIndex,
    };
    const wPos = roofVertexWorldFromScene(scene, hit);
    if (!wPos) return null;
    const r = Math.max(0.036, maxDim * 0.016);
    const interactiveZDrag = !!(enableRoofVertexZEdit && onRoofVertexHeightCommit);
    const patch = scene.roofModel.roofPlanePatches.find((p) => String(p.id) === t.patchId);
    const n = patch?.normal;
    /** Sommet 3D exact (pas de décalage : l’orange est collé au coin du plan). */
    const position = [wPos.x, wPos.y, wPos.z] as const;
    let pickPosition: readonly [number, number, number] | undefined;
    let pickHitRadius: number | undefined;
    if (
      interactiveZDrag &&
      n &&
      typeof n.x === "number" &&
      Number.isFinite(n.x) &&
      Number.isFinite(n.y) &&
      Number.isFinite(n.z)
    ) {
      const off = Math.max(r * 2.2, maxDim * 0.014);
      pickPosition = [wPos.x + n.x * off, wPos.y + n.y * off, wPos.z + n.z * off] as const;
      pickHitRadius = Math.max(r * 2.4, maxDim * 0.018);
    }
    return {
      position,
      pickPosition,
      pickHitRadius,
      radius: r,
      interactiveZDrag,
      onMarkerPointerDown: interactiveZDrag ? onRoofVertexMarkerPointerDown : undefined,
    };
  }, [
    enableRoofVertexZEdit,
    enableRoofVertexXYEdit,
    onRoofVertexHeightCommit,
    inspectMode,
    panSelection3DMode,
    inspectionSelection,
    selectedHit,
    scene,
    maxDim,
    onRoofVertexMarkerPointerDown,
  ]);

  const inspectionModel = useMemo(() => {
    if (!inspectMode || !inspectionSelection) return null;
    return buildSceneInspectionViewModel(scene, inspectionSelection);
  }, [inspectMode, inspectionSelection, scene]);

  const pickProvenance2DModel = useMemo(() => {
    if (!inspectMode && !panSelection3DMode) return null;
    if (inspectMode && inspectionSelection != null && inspectionSelection.kind !== "PAN") {
      return null;
    }
    let patchId: string | null = null;
    let highlightVi: number | null = null;
    if (inspectMode && inspectionSelection?.kind === "PAN") {
      patchId = String(inspectionSelection.id);
      highlightVi = inspectionSelection.roofVertexIndexInPatch ?? null;
    } else if (panSelection3DMode && selectedHit?.kind === "roof_patch") {
      patchId = selectedHit.roofPlanePatchId;
      highlightVi = null;
    } else if (panSelection3DMode && selectedHit?.kind === "roof_vertex") {
      patchId = selectedHit.roofPlanePatchId;
      highlightVi = selectedHit.vertexIndexInPatch;
    } else {
      return null;
    }
    const imageSizePx =
      groundImage?.widthPx != null && groundImage?.heightPx != null
        ? { width: groundImage.widthPx, height: groundImage.heightPx }
        : undefined;
    return buildPickProvenance2DViewModel({
      scene,
      roofPlanePatchId: patchId,
      highlightVertexIndex: highlightVi,
      calpinagePans: calpinagePansForProvenance,
      imageSizePx,
    });
  }, [
    inspectMode,
    panSelection3DMode,
    selectedHit,
    inspectionSelection,
    scene,
    groundImage?.widthPx,
    groundImage?.heightPx,
    calpinagePansForProvenance,
  ]);

  const roofVertexHeightEdit = useMemo(() => {
    if (!enableRoofVertexZEdit || !onRoofVertexHeightCommit) return null;
    let patchId: string;
    let vi: number;
    if (inspectMode && inspectionSelection?.kind === "PAN" && inspectionSelection.roofVertexIndexInPatch != null) {
      patchId = String(inspectionSelection.id);
      vi = inspectionSelection.roofVertexIndexInPatch;
    } else if (panSelection3DMode && selectedHit?.kind === "roof_vertex") {
      patchId = selectedHit.roofPlanePatchId;
      vi = selectedHit.vertexIndexInPatch;
    } else {
      return null;
    }
    const wPos = roofVertexWorldFromScene(scene, {
      kind: "roof_vertex",
      roofPlanePatchId: patchId,
      vertexIndexInPatch: vi,
    });
    if (!wPos) return null;
    const referenceHeightM = readVertexReferenceHeightM(
      calpinagePansForProvenance,
      patchId,
      vi,
      wPos.z,
    );
    return {
      panId: patchId,
      vertexIndex: vi,
      referenceHeightM,
      dragLiveHeightM: roofZDragPreviewM,
      heightMinM: ROOF_VERTEX_EDIT_MIN_M,
      heightMaxM: ROOF_VERTEX_EDIT_MAX_M,
      worldPositionM: { x: wPos.x, y: wPos.y, z: wPos.z },
      onApplyHeightM: (heightM: number) =>
        onRoofVertexHeightCommit({
          panId: patchId,
          vertexIndex: vi,
          heightM,
          trace: { source: "3d_inspection_overlay" },
        }),
    };
  }, [
    enableRoofVertexZEdit,
    onRoofVertexHeightCommit,
    inspectMode,
    inspectionSelection,
    panSelection3DMode,
    selectedHit,
    scene,
    calpinagePansForProvenance,
    roofZDragPreviewM,
  ]);

  const roofVertexXYEdit = useMemo(() => {
    if (!enableRoofVertexXYEdit || !onRoofVertexXYCommit) return null;
    let patchId: string;
    let vi: number;
    if (inspectMode && inspectionSelection?.kind === "PAN" && inspectionSelection.roofVertexIndexInPatch != null) {
      patchId = String(inspectionSelection.id);
      vi = inspectionSelection.roofVertexIndexInPatch;
    } else if (panSelection3DMode && selectedHit?.kind === "roof_vertex") {
      patchId = selectedHit.roofPlanePatchId;
      vi = selectedHit.vertexIndexInPatch;
    } else {
      return null;
    }
    const wPos = roofVertexWorldFromScene(scene, {
      kind: "roof_vertex",
      roofPlanePatchId: patchId,
      vertexIndexInPatch: vi,
    });
    const refPx = readVertexReferencePx(
      calpinagePansForProvenance,
      patchId,
      vi,
      wPos ? { x: wPos.x, y: wPos.y } : null,
      scene,
    );
    if (!refPx) return null;
    return {
      panId: patchId,
      vertexIndex: vi,
      referenceXPx: refPx.xPx,
      referenceYPx: refPx.yPx,
      maxDisplacementPx: ROOF_VERTEX_XY_EDIT_DEFAULT_MAX_DISPLACEMENT_PX,
      onApplyDeltaWorldM: (dxM: number, dyM: number) =>
        onRoofVertexXYCommit({ panId: patchId, vertexIndex: vi, mode: "deltaWorldM", dxM, dyM }),
      onApplyImagePx: (xPx: number, yPx: number) =>
        onRoofVertexXYCommit({ panId: patchId, vertexIndex: vi, mode: "imagePx", xPx, yPx }),
    };
  }, [
    enableRoofVertexXYEdit,
    onRoofVertexXYCommit,
    inspectMode,
    inspectionSelection,
    panSelection3DMode,
    selectedHit,
    scene,
    calpinagePansForProvenance,
  ]);

  const onStructuralRidgeLinePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      const wc = scene.worldConfig;
      if (!wc) return;
      const p = e.point;
      const img = worldPointToImage({ x: p.x, y: p.y, z: p.z }, wc);
      const rt = debugRuntime ?? roofRawState;
      const sel = resolveNearestStructuralHeightSelectionFromImagePx(
        rt,
        { x: img.x, y: img.y },
        STRUCTURAL_RIDGE_RESOLVE_MAX_DIST_IMG_PX,
      );
      if (!sel) return;
      setSelectedHit(null);
      setInspectionSelection(null);
      setStructuralHeightSelection(sel);
      setOrbitSuppressed(true);
    },
    [debugRuntime, roofRawState, scene.worldConfig],
  );

  const calpinageRuntimeForPv = useMemo(
    () => debugRuntime ?? roofRawState,
    [debugRuntime, roofRawState],
  );

  const pvRoofPlacementEnabled = useMemo(() => {
    // pvPlaceProbe : flag Context A2 (plus de lecture window.__CALPINAGE_3D_PV_PLACE_PROBE__).
    const rt = calpinageRuntimeForPv;
    const phaseOk =
      rt != null && typeof rt === "object" && (rt as { currentPhase?: string }).currentPhase === "PV_LAYOUT";
    return (pvPlaceProbe || pvLayout3DInteractionMode) && phaseOk;
  }, [calpinageRuntimeForPv, pvLayout3DInteractionMode, pvPlaceProbe]);

  const [pv3dOverlayEpoch, setPv3dOverlayEpoch] = useState(0);
  const pv3dOverlayRefreshFrameRef = useRef<number | null>(null);
  const pv3dOverlayLifecycleGenerationRef = useRef(0);
  const refreshPv3dOverlay = useCallback(() => {
    setPv3dOverlayEpoch((n) => n + 1);
  }, []);
  const refreshPv3dOverlayThrottled = useCallback(() => {
    if (pv3dOverlayRefreshFrameRef.current != null) return;
    pv3dOverlayRefreshFrameRef.current = window.requestAnimationFrame(() => {
      pv3dOverlayRefreshFrameRef.current = null;
      refreshPv3dOverlay();
    });
  }, [refreshPv3dOverlay]);

  useEffect(() => {
    return () => {
      if (pv3dOverlayRefreshFrameRef.current != null) {
        window.cancelAnimationFrame(pv3dOverlayRefreshFrameRef.current);
        pv3dOverlayRefreshFrameRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!pvLayout3DInteractionMode) return;
    const onOverlayChange = (event: Event) => {
      const generation = (event as CustomEvent<{ generation?: number }>).detail?.generation;
      if (typeof generation === "number") {
        if (generation < pv3dOverlayLifecycleGenerationRef.current) return;
        pv3dOverlayLifecycleGenerationRef.current = generation;
      }
      refreshPv3dOverlayThrottled();
    };
    window.addEventListener("calpinage:pv3d-overlay-changed", onOverlayChange);
    window.addEventListener("calpinage:ph3-handles-changed", onOverlayChange);
    return () => {
      window.removeEventListener("calpinage:pv3d-overlay-changed", onOverlayChange);
      window.removeEventListener("calpinage:ph3-handles-changed", onOverlayChange);
    };
  }, [pvLayout3DInteractionMode, refreshPv3dOverlayThrottled]);

  // LOT3-C7 : refresh automatique de l'overlay après chaque rebuild de scène en mode PV layout.
  // Avant ce fix, buildScene() appelait setScene() mais n'incrémentait pas pv3dOverlayEpoch
  // → pvLayout3dOverlayState restait stale après validation / autofill / suppression panneau
  // → selectedPanels pouvait contenir des panneaux qui n'existent plus dans scene.pvPanels
  // → handles pointaient dans le vide ou disparaissaient.
  // `scene` délibérément absent des deps du useMemo pvLayout3dOverlayState (cf. commentaire ci-dessous) ;
  // ce useEffect séparé assure la resync sans causer de flash overlay au render du useMemo.
  useEffect(() => {
    if (!pvLayout3DInteractionMode) return;
    refreshPv3dOverlayThrottled();
    // `scene` est la seule dep qui peut changer ici ; pvLayout3DInteractionMode et refreshPv3dOverlayThrottled sont stables.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scene]);

  // LOT3-C8 : déblocage de CALPINAGE_IS_MANIPULATING après pointercancel sur le canvas R3F.
  // Le legacy écoute pointercancel sur le canvas 2D, pas sur le canvas Three.js / R3F.
  // Si le pointer est annulé (perte de focus, multi-touch, interruption OS) pendant un drag 3D,
  // CALPINAGE_IS_MANIPULATING restait stuck à true → pv3dLivePanelGeos non-vide en permanence
  // → overlay live fantôme bloqué → masquage du panneau dans l'InstancedMesh sans rendu overlay.
  useEffect(() => {
    if (!pvLayout3DInteractionMode) return;
    const onPointerCancel = () => {
      if (!pvPanelDrag.sessionRef.current) return;
      cancelPvMoveFrom3d();
      pvPanelDrag.end();
      setOrbitSuppressed(false);
      refreshPv3dOverlay();
    };
    window.addEventListener("pointercancel", onPointerCancel);
    return () => window.removeEventListener("pointercancel", onPointerCancel);
  }, [pvLayout3DInteractionMode, pvPanelDrag, refreshPv3dOverlay]);

  const pvLayout3dOverlayState = useMemo(
    () => (pvLayout3DInteractionMode ? readPvLayout3dOverlayState() : null),
    // `scene` retiré intentionnellement : l'overlay est déjà rafraîchi par pv3dOverlayEpoch
    // (refreshPv3dOverlay) et les events calpinage:pv3d-overlay-changed. L'inclure déclenchait
    // un recalcul overlay sur chaque rebuild de scène, causant un flash de l'overlay.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [pvLayout3DInteractionMode, pv3dOverlayEpoch],
  );
  // LOT3-C4 : pvLayout3dScreenOverlay consommé par <PvLayout3dSvgOverlay> ci-dessous (plus voided).
  const [pvLayout3dScreenOverlay, setPvLayout3dScreenOverlay] = useState<PvLayout3dScreenOverlayState | null>(null);
  const [roofTruthBadges, setRoofTruthBadges] = useState<RoofTruthBadgeScreenModel[]>([]);

  // ── [PV3D-HANDLES] Log overlay + handles state ────────────────────────────
  useEffect(() => {
    const dbg =
      import.meta.env.DEV ||
      (typeof window !== "undefined" && (window as unknown as Record<string, unknown>)["__PV3D_DEBUG"] === true);
    if (!dbg) return;
    const ov = pvLayout3dOverlayState;
    console.groupCollapsed(
      `[PV3D-HANDLES] overlay update : interactionMode=${String(pvLayout3DInteractionMode)}` +
      `  focusBlockId=${String(ov?.focusBlockId ?? null)}` +
      `  activeBlockId=${String(ov?.activeBlockId ?? null)}` +
      `  panels=${String(ov?.panels.length ?? 0)}` +
      `  ghosts=${String(ov?.ghosts.length ?? 0)}` +
      (pvLayout3DInteractionMode && !ov ? "  ⚠️ OVERLAY NULL" : ""),
    );
    console.log("pvLayout3DInteractionMode :", pvLayout3DInteractionMode);
    console.log("pvLayout3dOverlayState :", ov);
    console.log("scene.pvPanels.length :", scene.pvPanels.length);
    if (pvLayout3DInteractionMode && ov) {
      const selectedPanels = ov.panels.filter((p) => p.selected);
      console.log("panels selected dans overlay :", selectedPanels.length);
      if (selectedPanels.length === 0) {
        console.warn("[PV3D-HANDLES] ⚠️ 0 panneaux selected dans overlay — handles masqués (selectedPanels.length > 0 fail).");
      }
      if (!ov.focusBlockId) {
        console.warn("[PV3D-HANDLES] ⚠️ focusBlockId=null — handles masqués (overlay.focusBlockId fail).");
      }
    }
    if (pvLayout3DInteractionMode && !ov) {
      console.error("[PV3D-HANDLES] ⛔ overlay=null en interactionMode — event calpinage:pv3d-overlay-changed non reçu ?");
    }
    console.groupEnd();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pvLayout3dOverlayState, pvLayout3DInteractionMode, scene.pvPanels.length]);

  // ── Overlays interactifs ──────────────────────────────────────────────────

  /** Panneau PV survolé — lookup par panelHover.panelId dans scene.pvPanels. */
  const hoveredPanel = useMemo(
    () =>
      panelHover
        ? (scene.pvPanels.find((p) => String(p.id) === panelHover.panelId) ?? null)
        : null,
    [panelHover, scene.pvPanels],
  );

  /** Position world du centre du panneau survolé — THREE.Vector3 pour PanelTooltip3D. */
  const hoveredPanelWorldPos = useMemo(() => {
    if (!hoveredPanel) return null;
    const c = hoveredPanel.center3D;
    return new THREE.Vector3(c.x, c.y, c.z);
  }, [hoveredPanel]);

  /** Puissance totale installée (Wc) + nombre de panneaux valides — pour PowerIndicator3D. */
  const pvPowerSummary = useMemo(
    () =>
      computeInstalledPvPower({
        panels: scene.pvPanels,
        modulePowerWc: selectedPvModulePower.unitPowerWc,
      }),
    [scene.pvPanels, selectedPvModulePower.unitPowerWc],
  );

  /**
   * Pan de toit actif en mode placement PV.
   * Dérivé de pvLayout3dOverlayState — bloc actif ou premier pan disponible.
   */
  const pvLayoutActivePanId = useMemo(() => {
    if (!pvLayout3DInteractionMode || !pvLayout3dOverlayState) return null;
    const activeId = pvLayout3dOverlayState.activeBlockId ?? pvLayout3dOverlayState.focusBlockId;
    if (activeId) {
      const panelOfBlock = pvLayout3dOverlayState.panels.find((p) => p.blockId === activeId);
      if (panelOfBlock?.panId) return panelOfBlock.panId;
    }
    return pvLayout3dOverlayState.panels[0]?.panId ?? null;
  }, [pvLayout3DInteractionMode, pvLayout3dOverlayState]);

  /**
   * Points de snap magnétiques sur le pan actif — grille 9x9 world space.
   * Recalculé uniquement quand le pan ou le modèle toiture change.
   */
  const magneticGridSnapPoints = useMemo((): THREE.Vector3[] => {
    if (!pvLayout3DInteractionMode || !pvLayoutActivePanId) return [];
    const patch = scene.roofModel.roofPlanePatches.find(
      (p) => String(p.id) === pvLayoutActivePanId,
    );
    if (!patch || patch.cornersWorld.length < 3) return [];

    const { origin, xAxis, yAxis, zAxis } = patch.localFrame;
    let uMin = Infinity, uMax = -Infinity, vMin = Infinity, vMax = -Infinity;
    for (const c of patch.cornersWorld) {
      const dx = c.x - origin.x, dy = c.y - origin.y, dz = c.z - origin.z;
      const u = dx * xAxis.x + dy * xAxis.y + dz * xAxis.z;
      const v = dx * yAxis.x + dy * yAxis.y + dz * yAxis.z;
      if (u < uMin) uMin = u;
      if (u > uMax) uMax = u;
      if (v < vMin) vMin = v;
      if (v > vMax) vMax = v;
    }

    const GRID_N = 9;
    const MARGIN = 0.18;
    const SURFACE_OFFSET = 0.025;
    const uRange = uMax - uMin - 2 * MARGIN;
    const vRange = vMax - vMin - 2 * MARGIN;
    if (uRange <= 0 || vRange <= 0) return [];

    const points: THREE.Vector3[] = [];
    for (let i = 0; i < GRID_N; i++) {
      for (let j = 0; j < GRID_N; j++) {
        const u = uMin + MARGIN + (i / (GRID_N - 1)) * uRange;
        const v = vMin + MARGIN + (j / (GRID_N - 1)) * vRange;
        points.push(
          new THREE.Vector3(
            origin.x + u * xAxis.x + v * yAxis.x + SURFACE_OFFSET * zAxis.x,
            origin.y + u * xAxis.y + v * yAxis.y + SURFACE_OFFSET * zAxis.y,
            origin.z + u * xAxis.z + v * yAxis.z + SURFACE_OFFSET * zAxis.z,
          ),
        );
      }
    }
    return points;
  }, [pvLayout3DInteractionMode, pvLayoutActivePanId, scene.roofModel.roofPlanePatches]);

  const projectPvLayoutImagePolygonToWorld = useCallback(
    (
      points: readonly { readonly x: number; readonly y: number }[],
      panId: string | null | undefined,
      offsetM: number,
    ) => imagePolygonToRoofWorldPoints(scene, points, panId, offsetM),
    [scene],
  );

  const onPv3dLiveOffsetImg = useCallback((dxImg: number, dyImg: number, rotationDeg = 0) => {
    if (pvPanelDrag.sessionRef.current?.mode === "rotate") {
      applyPvTransformLiveFrom3d(0, 0, rotationDeg);
    } else {
      applyPvMoveLiveFrom3d(dxImg, dyImg);
    }
    refreshPv3dOverlayThrottled();
  }, [refreshPv3dOverlayThrottled]);

  const endPv3dDragSession = useCallback(() => {
    const s = pvPanelDrag.sessionRef.current;

    // Résoudre panelId depuis l'overlay state (best-effort — le handler n'utilise pas ces champs
    // pour la mutation legacy, ils servent à la traçabilité et au futur module pvLayoutEngine pur).
    const blockId = s?.blockId ?? "";
    const panelId =
      pvLayout3dOverlayState?.panels.find((p) => p.blockId === blockId)?.id ?? "";

    // Dispatch via CommandBus — le handler movePvPanelHandler appelle finalizePvMoveFrom3d
    // et émet calpinage:state-changed pour la sync Zustand.
    void commandBus.dispatch({
      type: "MOVE_PV_PANEL",
      panelId,
      newBlockId: blockId,
      deltaWorld: { x: 0, y: 0, z: 0 },
    });

    // Déclencher un rebuild 3D immédiat (sans attendre le RAF de pvSyncSaveRender).
    // Le moteur a déjà commité les nouvelles positions → getAllPanels() retourne les bonnes coords.
    onPanelMoveCommit?.();

    pvPanelDrag.end();
    setOrbitSuppressed(false);
    refreshPv3dOverlay();
  }, [commandBus, refreshPv3dOverlay, pvLayout3dOverlayState, onPanelMoveCommit, pvPanelDrag]);

  const onPvPanelPvLayout3dPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>, panelIdFromMesh: string) => {
      if (!pvLayout3DInteractionMode) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      const wc = scene.worldConfig;
      if (!wc) return;
      const rt = debugRuntime ?? roofRawState;
      if (!rt || typeof rt !== "object" || (rt as { currentPhase?: string }).currentPhase !== "PV_LAYOUT") {
        return;
      }
      const img = worldPointToImage({ x: e.point.x, y: e.point.y, z: e.point.z }, wc);
      const hit = hitTestPvBlockPanelFromImagePoint(img);
      const overlayPanel = pvLayout3dOverlayState?.panels.find((p) => String(p.id) === String(panelIdFromMesh));
      const resolvedBlockId = hit?.blockId ?? overlayPanel?.blockId ?? null;
      const resolvedPanelId = hit?.panelId ?? overlayPanel?.panelId ?? null;
      if (!resolvedBlockId) return;
      const removeOnSimpleClick =
        overlayPanel?.selected === true &&
        (pvLayout3dOverlayState?.ghosts.length ?? 0) > 0 &&
        pvPanelDrag.sessionRef.current == null;
      if (removeOnSimpleClick) {
        if (removePvPanelFrom3d(overlayPanel.blockId, overlayPanel.panelId)) {
          refreshPv3dOverlay();
          setPanelHover(null);
        }
        return;
      }
      selectPvBlockFrom3d(resolvedBlockId, resolvedPanelId);
      refreshPv3dOverlay();
    },
    [pvLayout3DInteractionMode, scene.worldConfig, debugRuntime, roofRawState, pvLayout3dOverlayState, refreshPv3dOverlay],
  );

  const handleExistingPvPanelHitFrom3dImagePoint = useCallback(
    (img: { readonly x: number; readonly y: number }): boolean => {
      if (!pvLayout3DInteractionMode) return false;
      const hit = hitTestPvBlockPanelFromImagePoint(img);
      if (!hit) return false;
      const overlayPanel = pvLayout3dOverlayState?.panels.find(
        (p) => String(p.blockId) === String(hit.blockId) && String(p.panelId) === String(hit.panelId),
      );
      const removeOnSimpleClick =
        overlayPanel?.selected === true &&
        (pvLayout3dOverlayState?.ghosts.length ?? 0) > 0 &&
        pvPanelDrag.sessionRef.current == null;
      if (removeOnSimpleClick && removePvPanelFrom3d(overlayPanel.blockId, overlayPanel.panelId)) {
        refreshPv3dOverlay();
        setPanelHover(null);
        return true;
      }
      selectPvBlockFrom3d(hit.blockId, hit.panelId);
      refreshPv3dOverlay();
      return true;
    },
    [pvLayout3DInteractionMode, pvLayout3dOverlayState, refreshPv3dOverlay],
  );

  const beginPv3dHandleDrag = useCallback(
    (e: ReactPointerEvent<Element>, mode: "move" | "rotate", h: PvLayout3dHandleUi) => {
      if (!pvLayout3DInteractionMode) return;
      if (e.button !== 0) return;
      const wc = scene.worldConfig;
      const blockId = h.blockId;
      if (!wc || !blockId) return;
      const img = mode === "rotate" ? h.rotateImg : h.moveImg;
      const ptr = (e.nativeEvent as PointerEvent).pointerId ?? 0;
      e.preventDefault();
      if (mode === "rotate") {
        const r = beginPvRotateFrom3d(blockId, img, ptr);
        if (!r.ok) {
          if (import.meta.env.DEV) console.warn("[CALPINAGE][PV_3D_ROTATE]", r);
          return;
        }
        pvPanelDrag.begin({ blockId, pointerId: ptr, startImg: { x: img.x, y: img.y }, mode: "rotate", centerImg: r.centerImg });
      } else {
        const r = beginPvMoveFrom3d(blockId, img, ptr);
        if (!r.ok) {
          if (import.meta.env.DEV) console.warn("[CALPINAGE][PV_3D_MOVE]", r);
          return;
        }
        pvPanelDrag.begin({ blockId, pointerId: ptr, startImg: { x: img.x, y: img.y }, mode: "move" });
      }
      setOrbitSuppressed(true);
      e.stopPropagation();
    },
    [pvLayout3DInteractionMode, scene.worldConfig, pvPanelDrag],
  );

  const onPvMoveHandlePointerDown = useCallback(
    (e: ReactPointerEvent<Element>, h: PvLayout3dHandleUi) => beginPv3dHandleDrag(e, "move", h),
    [beginPv3dHandleDrag],
  );

  const onPvRotateHandlePointerDown = useCallback(
    (e: ReactPointerEvent<Element>, h: PvLayout3dHandleUi) => beginPv3dHandleDrag(e, "rotate", h),
    [beginPv3dHandleDrag],
  );
  // LOT3-C4 : onPvMoveHandlePointerDown / onPvRotateHandlePointerDown consommés par
  // <PvLayout3dSvgOverlay> monté après </Canvas> — les `void` retirés.

  /** Pass 4–5 — toit : sonde (`__CALPINAGE_3D_PV_PLACE_PROBE__`) ou produit (`pvLayout3DInteractionMode`) en phase PV_LAYOUT. */
  const onRoofTessellationPv3dProbePointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>) => {
      if (!pvRoofPlacementEnabled) return;
      if (e.button !== 0) return;
      const wc = scene.worldConfig;
      if (!wc) return;
      const panId = pickRoofTessellationPanIdFromIntersections(e.intersections);
      if (!panId) return;
      const img = worldPointToImage({ x: e.point.x, y: e.point.y, z: e.point.z }, wc);
      if (handleExistingPvPanelHitFrom3dImagePoint(img)) {
        e.stopPropagation();
        return;
      }
      if (pvLayout3DInteractionMode && addPvPanelFrom3dImagePoint(img)) {
        // FA-6 : sélectionner le bloc nouvellement créé pour que les handles apparaissent
        // immédiatement — aligne ce chemin sur tryCommitPvPlacementFrom3dRoofHit qui
        // appelle explicitement selectPvBlockFrom3d(r.blockId, null) avant le commit.
        // readPvLayout3dOverlayState() retourne l'état frais (pas le useMemo stale).
        const freshOverlay = readPvLayout3dOverlayState();
        const newBlockId = freshOverlay?.focusBlockId ?? freshOverlay?.activeBlockId ?? null;
        if (newBlockId) selectPvBlockFrom3d(newBlockId, null);
        onPanelMoveCommit?.();
        refreshPv3dOverlay();
        e.stopPropagation();
        return;
      }
      if (pvLayout3DInteractionMode && (pvLayout3dOverlayState?.focusBlockId || pvLayout3dOverlayState?.activeBlockId)) {
        clearPvSelectionFrom3d();
        refreshPv3dOverlay();
        e.stopPropagation();
        return;
      }
      const r = tryCommitPvPlacementFrom3dRoofHit({
        panId,
        worldPointM: { x: e.point.x, y: e.point.y, z: e.point.z },
        worldConfig: wc,
      });
      if (import.meta.env.DEV) {
        if (r.ok) console.info("[CALPINAGE][PV_3D_ROOF]", r);
        else console.warn("[CALPINAGE][PV_3D_ROOF]", r);
      }
      if (r.ok) {
        // Forcer la sélection du nouveau bloc immédiatement : garantit que focusBlock = nouveau bloc
        // avant refreshPv3dOverlay(), ce qui met selected=true dans l'overlay → panneau visible
        // dès le premier frame (sinon invisible pendant les 1-2 frames RAF de pvSyncSaveRender).
        if (r.blockId) selectPvBlockFrom3d(r.blockId, null);
        onPanelMoveCommit?.();
        refreshPv3dOverlay();
        e.stopPropagation();
      }
    },
    [
      scene.worldConfig,
      pvRoofPlacementEnabled,
      pvLayout3DInteractionMode,
      pvLayout3dOverlayState,
      refreshPv3dOverlay,
      handleExistingPvPanelHitFrom3dImagePoint,
      onPanelMoveCommit,
    ],
  );

  const structuralRidgeHeightEditPanel = useMemo((): StructuralRidgeHeightEditUiModel | null => {
    if (!enableStructuralRidgeHeightEdit || !onStructuralRidgeHeightCommit || structuralHeightSelection == null) {
      return null;
    }
    const rt = debugRuntime ?? roofRawState;
    const refH = readCalpinageStructuralHeightM(rt, structuralHeightSelection);
    if (refH === null) return null;
    const pointLabel =
      structuralHeightSelection.type === "contour"
        ? String(structuralHeightSelection.pointIndex)
        : structuralHeightSelection.pointIndex === 0
          ? "a"
          : "b";
    return {
      structuralKind: structuralHeightSelection.type,
      structuralIndexFiltered: structuralHeightSelection.index,
      pointLabel,
      referenceHeightM: refH,
      heightMinM: STRUCTURAL_RIDGE_HEIGHT_MIN_M,
      heightMaxM: ROOF_VERTEX_EDIT_MAX_M,
      onApplyHeightM: (heightM: number) => {
        onStructuralRidgeHeightCommit({ selection: structuralHeightSelection, heightM });
      },
    };
  }, [
    enableStructuralRidgeHeightEdit,
    onStructuralRidgeHeightCommit,
    structuralHeightSelection,
    debugRuntime,
    roofRawState,
  ]);

  useEffect(() => {
    if (panSelection3DMode && (selectedHit?.kind === "roof_vertex" || selectedHit?.kind === "roof_patch")) {
      setStructuralHeightSelection(null);
    }
  }, [panSelection3DMode, selectedHit]);

  useEffect(() => {
    if (
      inspectMode &&
      inspectionSelection?.kind === "PAN" &&
      inspectionSelection.roofVertexIndexInPatch != null
    ) {
      setStructuralHeightSelection(null);
    }
  }, [inspectMode, inspectionSelection]);

  const roofShellAlignmentLine = useMemo(() => {
    if (!inspectMode || !isCalpinage3DRuntimeDebugEnabled()) return null;
    return formatRoofShellAlignmentOneLine(computeRoofShellAlignmentDiagnostics(scene));
  }, [inspectMode, scene]);

  const diagKey = useMemo(
    () =>
      `${scene.metadata.createdAtIso}|${scene.metadata.integrationNotes ?? ""}|${scene.pvPanels.map((p) => p.id).join(",")}`,
    [scene],
  );

  useEffect(() => {
    logVisualShadingDevDiagnosticsOnce(scene, diagKey);
  }, [scene, diagKey]);

  useEffect(() => {
    if (!roofModelingHistory) return;
    if (!inspectMode && !panSelection3DMode) return;
    const onKey = (e: KeyboardEvent) => {
      const el = e.target;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
        return;
      }
      if (e.defaultPrevented) return;
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;
      const key = e.key.length === 1 ? e.key.toLowerCase() : e.key;
      if (key === "z") {
        if (e.shiftKey) {
          if (roofModelingHistory.canRedo) {
            e.preventDefault();
            roofModelingHistory.onRedo();
          }
        } else if (roofModelingHistory.canUndo) {
          e.preventDefault();
          roofModelingHistory.onUndo();
        }
        return;
      }
      if (key === "y" && roofModelingHistory.canRedo) {
        e.preventDefault();
        roofModelingHistory.onRedo();
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [inspectMode, panSelection3DMode, roofModelingHistory]);

  useEffect(() => {
    if (
      !inspectMode &&
      !panSelection3DMode &&
      !(enableStructuralRidgeHeightEdit && structuralHeightSelection != null) &&
      !pvLayout3DInteractionMode &&
      pvPanelDrag.session == null
    ) {
      return;
    }
    const onKey = (e: KeyboardEvent) => {
      if (pvLayout3DInteractionMode && (e.key === "Delete" || e.key === "Backspace")) {
        const el = e.target;
        if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
          return;
        }
        if (removeSelectedPvPanelFrom3d()) {
          e.preventDefault();
          refreshPv3dOverlay();
        }
        return;
      }
      if (e.key !== "Escape") return;
      if (pvPanelDrag.sessionRef.current) {
        e.preventDefault();
        cancelPvMoveFrom3d();
        pvPanelDrag.end();
        setOrbitSuppressed(false);
        refreshPv3dOverlay();
        return;
      }
      if (zDragGestureActiveRef.current) {
        e.preventDefault();
        finalizeRoofZDragRef.current();
        return;
      }
      if (orbitSuppressed) {
        e.preventDefault();
        setOrbitSuppressed(false);
        return;
      }
      const el = e.target;
      if (el instanceof HTMLInputElement) {
        const t = el.type;
        if (t === "text" || t === "number" || t === "search" || t === "email" || t === "url" || t === "tel") {
          return;
        }
      }
      if (el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) return;
      e.preventDefault();
      setInspectionSelection(null);
      setSelectedHit(null);
      setStructuralHeightSelection(null);
      setRoofPickHover(null);
      setGlCursor("");
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [
    inspectMode,
    panSelection3DMode,
    orbitSuppressed,
    enableStructuralRidgeHeightEdit,
    structuralHeightSelection,
    pvLayout3DInteractionMode,
    pvPanelDrag.session,
    pvPanelDrag.sessionRef,
    pvPanelDrag.end,
    refreshPv3dOverlay,
  ]);

  const legendMode = useMemo(() => {
    if (!showShadingLegend || !showPanelShading) return null;
    return sceneHasAnyPanelVisualShadingData(scene) ? ("active" as const) : ("unavailable" as const);
  }, [showPanelShading, showShadingLegend, scene]);

  const missingHeightAlerts = useMemo(
    () => resolveRoofMissingHeightAlerts(scene),
    [scene],
  );

  const effectiveShowSun =
    showSun && cameraViewMode !== "PLAN_2D" && premiumAssembly.layers.showSun;

  const showTrustStripe =
    showPremiumGeometryTrustStripe !== false &&
    (geometryValidationReport != null ||
      premiumMode === "validation" ||
      showPremiumViewModeToolbar);

  const groundZ = useMemo(
    () => geometryBox.min.z - GROUND_PLANE_CONTACT_OFFSET_M,
    [geometryBox.min.z],
  );

  const pv3dHasSelectedPanel = !!(
    pvLayout3DInteractionMode &&
    pvLayout3dOverlayState?.panels.some((p) => p.selected)
  );
  const pv3dSelectedCount = pvLayout3dOverlayState?.selectedPanelCount ?? 0;
  const pv3dSelectedKwc =
    typeof pvLayout3dOverlayState?.selectedPowerKwc === "number"
      ? pvLayout3dOverlayState.selectedPowerKwc.toLocaleString("fr-FR", {
          minimumFractionDigits: 2,
          maximumFractionDigits: 2,
        })
      : null;
  const renderableObjectCount =
    (showRoof ? scene.roofModel.roofPlanePatches.length : 0) +
    (showPanels ? scene.pvPanels.length : 0) +
    (showObstacles ? scene.obstacleVolumes.length : 0) +
    (showExtensions ? scene.extensionVolumes.length : 0) +
    (scene.buildingShell ? 1 : 0);

  useEffect(() => {
    exposeViewerDebugFacade({
      scene,
      reliability: effectiveReliabilityState,
      qualityMode,
      effectiveQualityTier,
      selectedHit,
      inspectionSelection,
      pvLayoutSelectedCount: pv3dSelectedCount,
    });
  }, [
    scene,
    effectiveReliabilityState,
    qualityMode,
    effectiveQualityTier,
    selectedHit,
    inspectionSelection,
    pv3dSelectedCount,
  ]);

  const sceneStableKey = `${scene.metadata.schemaVersion}|${scene.metadata.createdAtIso}|${scene.metadata.integrationNotes ?? ""}`;
  const viewerRootRef = useRef<HTMLDivElement | null>(null);
  const [lifecycleDiagnostics, setLifecycleDiagnostics] = useState<ViewerLifecycleDiagnostics>(() =>
    readViewerLifecycleDiagnostics(),
  );
  const publishLifecycleDiagnostics = useCallback((diagnostics: ViewerLifecycleDiagnostics) => {
    setLifecycleDiagnostics(diagnostics);
  }, []);

  useLayoutEffect(() => {
    const initial = resetViewerLifecycleDiagnostics();
    setLifecycleDiagnostics(initial);
  }, [sceneStableKey]);

  useEffect(() => {
    const onLifecycle = (event: Event) => {
      setLifecycleDiagnostics((event as CustomEvent<ViewerLifecycleDiagnostics>).detail);
    };
    window.addEventListener("calpinage-3d-lifecycle", onLifecycle);
    return () => window.removeEventListener("calpinage-3d-lifecycle", onLifecycle);
  }, []);

  useLayoutEffect(() => {
    const bounds = boundsLifecycleSnapshot(geometryBox);
    const boundsComputed =
      bounds.min != null &&
      bounds.max != null &&
      !geometryBox.isEmpty();
    setLifecycleDiagnostics(
      updateViewerLifecycleDiagnostics({
        boundsComputed,
        bounds,
      }),
    );
  }, [geometryBox, sceneStableKey]);

  useEffect(() => {
    const node = viewerRootRef.current;
    if (!node) return;

    const publish = () => {
      const rect = node.getBoundingClientRect();
      setLifecycleDiagnostics(
        updateViewerLifecycleDiagnostics({
          containerWidth: Math.round(rect.width),
          containerHeight: Math.round(rect.height),
        }),
      );
    };

    publish();
    if (typeof ResizeObserver === "undefined") {
      window.addEventListener("resize", publish);
      return () => window.removeEventListener("resize", publish);
    }

    const observer = new ResizeObserver(publish);
    observer.observe(node);
    return () => observer.disconnect();
  }, [sceneStableKey]);

  const pvLayout3dA11yDescId = useId();

  return (
    <div
      ref={viewerRootRef}
      className={className}
      style={{
        width: "100%",
        height,
        minHeight: 200,
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
        // touch-action:none sur le wrapper : empêche le browser d'intercepter
        // les gestes (scroll, pinch-zoom natif) avant que pointer events soient dispatched.
        // Complété par gl.domElement.style.touchAction="none" dans onCreated.
        touchAction: "none",
      }}
      {...wrapperPointerProps}
      aria-label={pvLayout3DInteractionMode ? "Vue solaire — implantation photovoltaïque" : undefined}
      aria-describedby={pvLayout3DInteractionMode ? pvLayout3dA11yDescId : undefined}
      data-testid="solar-scene-3d-viewer-root"
      data-canonical-scene-key={sceneStableKey}
      data-camera-view-mode={cameraViewMode}
      data-premium-view-mode={premiumMode}
      data-premium-assembly-schema={premiumAssembly.schemaId}
      data-pan-selection-3d={panSelection3DMode ? "on" : "off"}
      data-selected-hit-kind={panSelection3DMode && selectedHit ? selectedHit.kind : ""}
      data-roof-vertex-z-edit={enableRoofVertexZEdit ? "on" : "off"}
      data-roof-vertex-xy-edit={enableRoofVertexXYEdit ? "on" : "off"}
      data-structural-ridge-height-edit={enableStructuralRidgeHeightEdit ? "on" : "off"}
      data-pv-layout-3d={pvLayout3DInteractionMode ? "on" : "off"}
      data-viewer-reliability={effectiveReliabilityState.kind}
      data-viewer-scene-source={effectiveReliabilityState.source}
      data-geometry-truth-status={effectiveReliabilityState.geometryTruthStatus}
      data-quality-mode={qualityMode}
      data-quality-tier={effectiveQualityTier}
      data-render-frameloop={effectiveFrameloop}
      data-lifecycle-viewer-ready={lifecycleDiagnostics.viewerReady ? "true" : "false"}
      data-lifecycle-viewer-blocked={lifecycleDiagnostics.viewerBlocked ? "true" : "false"}
      data-lifecycle-block-reason={lifecycleDiagnostics.lastBlockReason}
      data-lifecycle-canvas-mounted={lifecycleDiagnostics.canvasMounted ? "true" : "false"}
      data-lifecycle-webgl-initialized={lifecycleDiagnostics.webglInitialized ? "true" : "false"}
      data-lifecycle-camera-initialized={lifecycleDiagnostics.cameraInitialized ? "true" : "false"}
      data-lifecycle-bounds-computed={lifecycleDiagnostics.boundsComputed ? "true" : "false"}
      data-lifecycle-camera-fit-executed={lifecycleDiagnostics.cameraFitExecuted ? "true" : "false"}
      data-lifecycle-scene-attached={lifecycleDiagnostics.sceneAttached ? "true" : "false"}
      data-lifecycle-first-frame-rendered={lifecycleDiagnostics.firstFrameRendered ? "true" : "false"}
      data-lifecycle-frame-count={lifecycleDiagnostics.frameCount}
      data-lifecycle-container-width={lifecycleDiagnostics.containerWidth}
      data-lifecycle-container-height={lifecycleDiagnostics.containerHeight}
      data-lifecycle-canvas-width={lifecycleDiagnostics.canvasWidth}
      data-lifecycle-canvas-height={lifecycleDiagnostics.canvasHeight}
      data-roof-patch-count={scene.roofModel.roofPlanePatches.length}
      data-pv-panel-count={scene.pvPanels.length}
      data-obstacle-volume-count={scene.obstacleVolumes.length}
      data-extension-volume-count={scene.extensionVolumes.length}
    >
      <ViewerReliabilityOverlay reliability={effectiveReliabilityState} />
      {pvLayout3DInteractionMode ? (
        <div
          id={pvLayout3dA11yDescId}
          style={{
            position: "absolute",
            width: 1,
            height: 1,
            padding: 0,
            margin: -1,
            overflow: "hidden",
            clip: "rect(0, 0, 0, 0)",
            whiteSpace: "nowrap",
            border: 0,
          }}
        >
          Implantation PV en trois dimensions : clic sur la surface du pan pour placer un bloc, clic sur un panneau
          solaire pour le déplacer. Touche Échap pour annuler un déplacement en cours.
        </div>
      ) : null}
      {showTrustStripe ? (
        <PremiumGeometryTrustStripe
          validation={premiumAssembly.validation}
          showDiagnosticExcerpt={premiumMode === "validation"}
          compact={!showPremiumViewModeToolbar}
        />
      ) : null}
      {showDebugOverlay && (
        <DebugStatsOverlay
          scene={scene}
          box={geometryBox}
          groundPlaneConfig={groundPlaneConfig}
          groundZ={groundZ}
          extensionVolDebugLevel={extensionVolDebugLevel}
        />
      )}
      {legendMode != null && <ShadingLegend3D mode={legendMode} summary={scene.panelVisualShadingSummary} />}
      <MultiPanDiagnosticsOverlay scene={scene} visible={showRoof && showMultiPanDiagnostics} />
      <MissingHeightAlertsOverlay
        alerts={missingHeightAlerts}
        visible={showRoof && showMissingHeightAlerts}
      />
      <RoofTruthBadgesOverlay badges={roofTruthBadges} visible={showRoof && showRoofTruthBadges} />
      {/* PowerIndicator3D - puissance totale installée, temps réel */}
      <PowerIndicator3D
        totalPowerWc={pvPowerSummary.totalPowerWc}
        panelCount={pvPowerSummary.countablePanelCount}
      />
      {pvLayout3DInteractionMode && pv3dHasSelectedPanel ? (
        <div
          role="toolbar"
          aria-label="Actions panneaux PV"
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 1200,
            display: "flex",
            gap: 6,
            background: "rgba(15,18,24,0.86)",
            border: "1px solid rgba(255,255,255,0.14)",
            borderRadius: 6,
            padding: 6,
            boxShadow: "0 8px 22px rgba(0,0,0,0.26)",
          }}
        >
          <div
            aria-live="polite"
            style={{
              color: "rgba(226,232,240,0.96)",
              fontSize: 12,
              lineHeight: "16px",
              padding: "5px 6px",
              whiteSpace: "nowrap",
            }}
          >
            {pv3dSelectedCount} panneau{pv3dSelectedCount > 1 ? "x" : ""}
            {pv3dSelectedKwc ? ` - ${pv3dSelectedKwc} kWc` : ""}
          </div>
        </div>
      ) : null}
      {inspectMode && inspectionSelection?.kind === "OBSTACLE" && inspectionModel?.hero ? (
        <div
          role="tooltip"
          data-testid="obstacle-inspection-tooltip"
          style={{
            position: "absolute",
            left: 12,
            bottom: 12,
            zIndex: 4,
            maxWidth: "min(360px, calc(100vw - 24px))",
            padding: "9px 11px",
            borderRadius: 8,
            background: "rgba(15, 23, 42, 0.88)",
            border: "1px solid rgba(226,232,240,0.16)",
            boxShadow: "0 12px 32px rgba(0,0,0,0.32)",
            color: "rgba(248,250,252,0.95)",
            pointerEvents: "none",
            backdropFilter: "blur(10px)",
            fontFamily: "system-ui, -apple-system, sans-serif",
          }}
        >
          <div style={{ fontSize: 10, opacity: 0.62, textTransform: "uppercase", letterSpacing: "0.04em" }}>
            {inspectionModel.hero.eyebrow}
          </div>
          <div style={{ marginTop: 2, fontSize: 13, fontWeight: 750 }}>{inspectionModel.hero.title}</div>
          <div style={{ marginTop: 3, fontSize: 11, opacity: 0.74 }}>{inspectionModel.hero.subtitle}</div>
        </div>
      ) : null}
      {(inspectMode ||
        panSelection3DMode ||
        (enableStructuralRidgeHeightEdit && (structuralHeightSelection != null || roofHeightAssistant != null))) && (
        <SceneInspectionPanel3D
          model={inspectMode ? inspectionModel : null}
          pickProvenance2D={pickProvenance2DModel}
          showInspectionEmptyPlaceholder={inspectMode}
          showPanSelectionEmptyPlaceholder={panSelection3DMode && !inspectMode}
          roofShellAlignmentLine={roofShellAlignmentLine}
          roofVertexHeightEdit={roofVertexHeightEdit}
          roofVertexXYEdit={roofVertexXYEdit}
          structuralRidgeHeightEdit={structuralRidgeHeightEditPanel}
          roofHeightAssistant={enableStructuralRidgeHeightEdit ? roofHeightAssistant : null}
          roofModelingHistory={roofModelingHistory}
          onVertexModelingPointerActiveChange={setOrbitSuppressed}
          onDismiss={() => {
            setInspectionSelection(null);
            setSelectedHit(null);
            setStructuralHeightSelection(null);
            setOrbitSuppressed(false);
            setRoofPickHover(null);
            setGlCursor("");
          }}
        />
      )}
      {showPremiumViewModeToolbar && (
        <div
          role="toolbar"
          aria-label="Mode rendu premium"
          style={{
            position: "absolute",
            top: 8,
            right: 8,
            zIndex: 5,
            display: "flex",
            flexWrap: "wrap",
            gap: 4,
            maxWidth: 280,
            justifyContent: "flex-end",
            background: "rgba(15,18,24,0.82)",
            borderRadius: 6,
            padding: 4,
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          {PREMIUM_HOUSE_3D_VIEW_MODES.map((m) => (
            <button
              key={m}
              type="button"
              data-testid={`premium-view-mode-${m}`}
              aria-pressed={premiumMode === m}
              onClick={() => setPremiumMode(m)}
              style={{
                fontSize: 10,
                padding: "5px 8px",
                borderRadius: 4,
                border: "none",
                cursor: "pointer",
                background: premiumMode === m ? "rgba(99,102,241,0.35)" : "transparent",
                color: "rgba(248,250,252,0.92)",
              }}
            >
              {m}
            </button>
          ))}
        </div>
      )}
      {showCameraViewModeToggle && (
        <div
          role="toolbar"
          aria-label="Mode caméra"
          style={{
            position: "absolute",
            top: showPremiumViewModeToolbar ? 52 : 8,
            right: 8,
            zIndex: 6,
            display: "flex",
            gap: 4,
            background: "rgba(15,18,24,0.82)",
            borderRadius: 6,
            padding: 4,
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <button
            type="button"
            data-testid="calpinage-viewer-mode-3d"
            aria-pressed={cameraViewMode === "SCENE_3D"}
            onClick={() => setCameraViewMode("SCENE_3D")}
            style={{
              fontSize: 10,
              padding: "5px 8px",
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
              background: cameraViewMode === "SCENE_3D" ? "rgba(99,102,241,0.35)" : "transparent",
              color: "rgba(248,250,252,0.92)",
            }}
          >
            3D
          </button>
          <button
            type="button"
            data-testid="calpinage-viewer-mode-plan"
            aria-pressed={cameraViewMode === "PLAN_2D"}
            onClick={() => setCameraViewMode("PLAN_2D")}
            style={{
              fontSize: 10,
              padding: "5px 8px",
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
              background: cameraViewMode === "PLAN_2D" ? "rgba(99,102,241,0.35)" : "transparent",
              color: "rgba(248,250,252,0.92)",
            }}
          >
            Plan
          </button>
        </div>
      )}
      {roofPickHover != null && panelHover == null && (
        <div
          role="tooltip"
          data-testid="roof-modeling-hover-tooltip"
          style={{
            position: "fixed",
            left: roofPickHover.clientX + 14,
            top: roofPickHover.clientY + 14,
            zIndex: 10000,
            pointerEvents: "none",
            padding: "8px 10px",
            borderRadius: 6,
            background: "rgba(15,18,24,0.92)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(248,250,252,0.95)",
            fontSize: 12,
            lineHeight: 1.4,
            maxWidth: 280,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {roofPickHover.label}
        </div>
      )}
      <Canvas
        orthographic={cameraViewMode === "PLAN_2D"}
        shadows={qualityProfile.shadows}
        dpr={[qualityProfile.dprMin, qualityProfile.dprMax]}
        frameloop={effectiveFrameloop}
        gl={{
          antialias: qualityProfile.nativeAntialias,
          powerPreference: "high-performance",
          // ACESFilmic + exposure aussi dans applyCanonicalViewerGlOutput (onCreated) — doublon
          // intentionnel pour que R3F initialise le renderer avec les bons paramètres dès la création.
          toneMapping: THREE.ACESFilmicToneMapping,
          toneMappingExposure: 1.15,
          // LOT3-C1 : logarithmicDepthBuffer retiré — incompatible avec polygonOffset sur WebGL
          // (les unités polygonOffset sont définies dans l'espace depth LINÉAIRE ; avec un buffer
          // logarithmique elles ne correspondent plus à rien → polygonOffset devient inopérant
          // → panneaux coplanaires disparaissent derrière le toit à cause du z-fighting non prévenu).
          // Le near/far étendu (0.1 … 5 000) avec le buffer linéaire standard fonctionne correctement
          // car la profondeur visible est limitée à < 200 m en usage résidentiel.
        }}
        camera={
          cameraViewMode === "PLAN_2D"
            ? {
                position: [0, 0, 50],
                near: 0.05,
                // far réduit de 1e6 → 5000 : ratio near/far 1e5 (vs 2e7 avant).
                // Toute scène résidentielle/tertiaire tient dans 5 km.
                // 1000× meilleure précision depth sur 24-bit buffer.
                far: 5000,
                up: [0, 0, 1],
              }
            : {
                /**
                 * Position initiale garantissant camera.y < centre_scène.y (caméra au SUD),
                 * donc camera_right = Est dès le premier frame — sans miroir horizontal.
                 * Même direction que VIEWER_DEFAULT_CAMERA_OFFSET, scalée × 1000 pour être
                 * loin derrière n'importe quelle scène réelle (~27m × quelques dizaines de m).
                 * CameraFramingRig repositionne ensuite précisément via computeViewerFraming.
                 */
                position: [
                  VIEWER_DEFAULT_CAMERA_OFFSET.x * 1000,
                  VIEWER_DEFAULT_CAMERA_OFFSET.y * 1000,
                  VIEWER_DEFAULT_CAMERA_OFFSET.z * 1000,
                ] as [number, number, number],
                fov: VIEWER_CAMERA_FOV_DEG,
                near: 0.1,
                // far réduit de 1e6 → 5000 : ratio near/far 5e4 (vs 1e7 avant).
                // Élimine les artefacts depth sur panneaux / toiture en vue rasante et zénithale.
                far: 5000,
                up: [0, 0, 1],
              }
        }
        onCreated={({ gl, invalidate }) => {
          applyCanonicalViewerGlOutput(gl);
          const next = updateViewerLifecycleDiagnostics({
            canvasMounted: true,
            webglInitialized: true,
            canvasWidth: gl.domElement.width,
            canvasHeight: gl.domElement.height,
          });
          publishLifecycleDiagnostics(next);
          // touch-action:none sur le canvas WebGL : requis pour que Pointer Events
          // (et OrbitControls three-stdlib) reçoivent les gestes tactiles sans que
          // le browser n'intercepte le scroll ou le pinch-zoom au niveau du viewport.
          // Viewport cibles : 375px (iPhone SE) et 820px (iPad Air).
          gl.domElement.style.touchAction = "none";
          // FA-RESIZE-1 — Fix R3F canvas sizing one-shot au montage.
          // Quand le container était display:none au montage, le ResizeObserver R3F reçoit
          // 0×0 et le canvas reste bloqué à 300×150 (défaut navigateur).
          // `window.dispatchEvent(new Event("resize"))` notifie le ResizeObserver interne
          // de R3F (@react-three/fiber/src/core/utils.ts) qui remesure alors le container.
          // Le RAF garantit que le browser a terminé le reflow avant la mesure.
          // Effet de bord maîtrisé : déclenché une seule fois à la création du Canvas,
          // les autres handlers window:resize de l'app sont idempotents sur un canvas déjà
          // correctement dimensionné.
          requestAnimationFrame(() => {
            window.dispatchEvent(new Event("resize"));
            invalidate();
          });
          invalidate();
        }}
        onPointerMissed={() => {
          if (zDragGestureActiveRef.current) return;
          if (pvLayout3DInteractionMode && pvPanelDrag.sessionRef.current == null) {
            clearPvSelectionFrom3d();
            refreshPv3dOverlay();
          }
          if (inspectMode) setInspectionSelection(null);
          if (panSelection3DMode) setSelectedHit(null);
          if (enableStructuralRidgeHeightEdit) setStructuralHeightSelection(null);
          setRoofPickHover(null);
          setGlCursor("");
        }}
      >
        <color attach="background" args={[premiumAssembly.backgroundHex]} />
        <CanvasQualityApplier profile={qualityProfile} dpr={effectiveDpr} />
        <ViewerRenderInvalidator
          sceneKey={sceneStableKey}
          cameraViewMode={cameraViewMode}
          qualityTier={effectiveQualityTier}
          frameloop={effectiveFrameloop}
          reliability={effectiveReliabilityState}
          patchCount={scene.roofModel.roofPlanePatches.length}
          pvPanelCount={scene.pvPanels.length}
          obstacleCount={scene.obstacleVolumes.length}
          extensionCount={scene.extensionVolumes.length}
          pvOverlayEpoch={pv3dOverlayEpoch}
        />
        <ViewerLifecycleFrameProbe
          onDiagnostics={publishLifecycleDiagnostics}
          sceneAttached={
            showRoof ||
            showPanels ||
            showObstacles ||
            showExtensions ||
            scene.roofModel.roofPlanePatches.length > 0
          }
        />
        <ViewerPerformanceMonitor
          mode={qualityMode}
          effectiveTier={effectiveQualityTier}
          profile={qualityProfile}
          setMode={setQualityMode}
          onWindowStats={onViewerPerformanceWindow}
        />
        <GlCursorBinder cursor={glCursor} />
        <LineRaycastThreshold maxDim={maxDim} enabled={enableStructuralRidgeHeightEdit} />
        <ViewerRenderabilityProbe
          box={geometryBox}
          target={center}
          renderableObjectCount={renderableObjectCount}
        />
        <StatsGlProbe enabled={showStatsGl} />
        {showStatsGl ? (
          <StatsGl
            id="calpinage-stats-gl"
            className="calpinage-stats-gl"
            minimal
          />
        ) : null}
        <PvLayout3dScreenOverlayProjector
          overlay={pvLayout3dOverlayState}
          enabled={pvLayout3DInteractionMode}
          projectImagePolygonToWorld={projectPvLayoutImagePolygonToWorld}
          onProjected={setPvLayout3dScreenOverlay}
        />
        <RoofTruthBadgesProjector
          scene={scene}
          enabled={showRoof && showRoofTruthBadges}
          onProjected={setRoofTruthBadges}
        />
        <DynamicCamera mode={cameraViewMode} framingBox={framingBox} />
        <CameraFramingRig
          box={framingBox}
          mode={cameraViewMode}
          framingMargin={premiumAssembly.framingMargin}
          orbitEnabled={!orbitSuppressed}
          orbitControlsInstanceRef={orbitControlsRef}
        />
        <ViewerSceneContent
          scene={scene}
          box={geometryBox}
          assembly={premiumAssembly}
          showRoof={showRoof}
          showRoofEdges={showRoofEdges}
          showObstacles={showObstacles}
          showExtensions={showExtensions}
          showPanels={showPanels}
          showPanelShading={showPanelShading}
          showSun={effectiveShowSun}
          sunDirectionIndex={sunDirectionIndex}
          onPanelHover={setPanelHover}
          inspectMode={inspectMode}
          panSelection3DMode={panSelection3DMode}
          enableRoofVertexZEdit={enableRoofVertexZEdit}
          enableRoofVertexXYEdit={enableRoofVertexXYEdit}
          roofModelingSurfaceUx={enableRoofVertexZEdit || enableRoofVertexXYEdit}
          roofModelingPassThroughOccluders={
            panSelection3DMode && (enableRoofVertexZEdit || enableRoofVertexXYEdit)
          }
          selectedHit={selectedHit}
          inspectionSelection={inspectionSelection}
          onInspectClick={onInspectClick}
          onRoofMeshClick={
            inspectMode || panSelection3DMode || (enableStructuralRidgeHeightEdit && onStructuralRidgeHeightCommit)
              ? onRoofMeshClick
              : undefined
          }
          onRoofModelingPointerUi={
            (inspectMode || panSelection3DMode) && (enableRoofVertexZEdit || enableRoofVertexXYEdit)
              ? onRoofModelingPointerUi
              : undefined
          }
          maxDim={maxDim}
          roofVertexMarker={roofVertexMarker}
          enableStructuralRidgeHeightEdit={enableStructuralRidgeHeightEdit}
          onStructuralRidgeLinePointerDown={
            enableStructuralRidgeHeightEdit && onStructuralRidgeHeightCommit
              ? onStructuralRidgeLinePointerDown
              : undefined
          }
          onRoofTessellationPv3dProbePointerDown={
            scene.worldConfig ? onRoofTessellationPv3dProbePointerDown : undefined
          }
          pvLayout3DInteractionMode={pvLayout3DInteractionMode}
          pvLayout3dOverlayState={pvLayout3dOverlayState}
          onPvPanelPvLayout3dPointerDown={onPvPanelPvLayout3dPointerDown}
          satelliteTexture={satelliteTexture}
          satelliteUvMapper={satelliteUvMapper}
          extensionVolDebugLevel={extensionVolDebugLevel}
          qualityProfile={qualityProfile}
        />
        {/* PanelTooltip3D - label Html drei sur le panneau survole */}
        {inspectMode ? (
          <PanelTooltip3D
            panelId={panelHover?.panelId ?? null}
            panel={hoveredPanel}
            worldPosition={hoveredPanelWorldPos}
            modulePowerWc={pvPowerSummary.unitPowerWc}
          />
        ) : null}
        {/* LOT3-C5 : MagneticGrid3D — garde triple pour éviter l'état interdit "grille seule sans panneaux".
         * `pvLayout3DInteractionMode` seul permettait la grille pendant le rebuild de scène (0 panneaux).
         * `scene.pvPanels.length > 0` : grille invisible si aucun panneau dans la scène courante.
         * `pvLayout3dOverlayState != null` : grille invisible si l'overlay est stale/null (transition). */}
        <MagneticGrid3D
          panId={pvLayoutActivePanId}
          snapPoints={magneticGridSnapPoints}
          visible={!!(
            pvLayout3DInteractionMode &&
            scene.pvPanels.length > 0 &&
            pvLayout3dOverlayState?.isManipulating &&
            magneticGridSnapPoints.length > 0
          )}
        />
        {pvLayout3DInteractionMode && scene.worldConfig && pvPanelDrag.session ? (
          <PvLayout3dDragController
            session={pvPanelDrag.session}
            worldConfig={scene.worldConfig}
            onLiveOffsetImg={onPv3dLiveOffsetImg}
            onSessionEnd={endPv3dDragSession}
          />
        ) : null}
        {enableRoofVertexZEdit && onRoofVertexHeightCommit ? (
          <RoofVertexZDragController
            session={roofZDragSession}
            gestureSessionRef={zDragSessionImmediateRef}
            plan2dMode={cameraViewMode === "PLAN_2D"}
            sceneMaxDim={maxDim}
            onLiveHeightM={liveRoofZCommitFromDrag}
            onSessionEnd={finalizeRoofZDrag}
          />
        ) : null}
        {groundPlaneConfig ? (
          <GroundPlaneTexture
            config={groundPlaneConfig}
            zLevel={groundZ}
            debugMode={showDebugOverlay}
          />
        ) : (
          <Grid
            position={[center.x, center.y, Math.min(geometryBox.min.z - 0.1, 0)]}
            {...viewerFallbackGridProps(maxDim)}
          />
        )}
        {showDebugOverlay && (
          <DebugSceneHelpers box={geometryBox} center={center} maxDim={maxDim} scene={scene} />
        )}
        {(showDebugOverlay || showXYAlignmentOverlay) && (
          <DebugXYAlignmentOverlay scene={scene} zLevel={groundZ} runtime={debugRuntime} />
        )}
        {/* ── Masque d’horizon lointain (far shading) — LineLoop orange ──── */}
        {horizonMask && horizonMask.length > 0 && cameraViewMode !== "PLAN_2D" && (
          <HorizonMaskRing3D mask={horizonMask as HorizonMaskPoint3D[]} center={center} />
        )}
        {/* IBL — overcast sky, background=false, chargement lazy (Suspense).
            environmentIntensity=0.52 : reflections IBL visibles sur zinc, bacs acier, panneaux PV.
            Valeur calibrée pour que les panneaux "brillent" sans surexposer les surfaces mates (ardoise). */}
        <ViewerEnvironment profile={qualityProfile} />
        <ViewerPostProcessing enabled={enablePostProcessing} profile={qualityProfile} />
      </Canvas>
      {/* LOT3-C4 : <PvLayout3dSvgOverlay> monté ici (hors Canvas, position:absolute sur le container).
       * Avant ce fix, pvLayout3dScreenOverlay était calculé par PvLayout3dScreenOverlayProjector
       * (useFrame dans le Canvas) mais jamais rendu → les handles n'apparaissaient JAMAIS.
       * onMovePointerDown / onRotatePointerDown déclenchent beginPv3dHandleDrag via useCallback. */}
      <PvLayout3dSvgOverlay
        overlay={pvLayout3dScreenOverlay}
        onMovePointerDown={onPvMoveHandlePointerDown}
        onRotatePointerDown={onPvRotateHandlePointerDown}
      />
    </div>
  );
}
