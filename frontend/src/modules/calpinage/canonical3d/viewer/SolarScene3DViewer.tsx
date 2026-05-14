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
 */

import { Canvas, type ThreeEvent, useFrame, useThree } from "@react-three/fiber";

/** @react-three/fiber : `gl` / `camera` sur l’événement (types ThreeEvent incomplets selon versions). */
function r3fGl(e: ThreeEvent<PointerEvent | MouseEvent>): THREE.WebGLRenderer {
  return (e as any).gl;
}
import { Grid, Outlines } from "@react-three/drei";
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
  computeSolarSceneBoundingBox,
  extendBoundingBoxWithSatelliteImageFootprint,
} from "./solarSceneBounds";
import { CameraFramingRig } from "./CameraFramingRig";
import { logIfGeometryNormalsSuspect } from "./geometryNormalsAudit";
import { ShadingLegend3D } from "./ShadingLegend3D";
import {
  SceneInspectionPanel3D,
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
  type SceneInspectableKind,
  type SceneInspectionSelection,
  type SceneInspectMeshRole,
  type SceneInspectUserData,
  type ScenePickHit,
} from "./inspection/sceneInspectionTypes";
import { pickInspectableIntersection, pickSceneHitFromIntersections } from "./inspection/pickInspectableIntersection";
import { pickSceneHitForRoofVertexModeling } from "./inspection/pickRoofVertexModelingPick";
import { RoofVertexZDragController, type RoofZDragSession } from "./RoofVertexZDragController";
import { worldZFromPointerOnVerticalThroughXY } from "./roofVertexVerticalPointerMath";
import {
  GROUND_PLANE_CONTACT_OFFSET_M,
  VIEWER_AMBIENT_INTENSITY,
  VIEWER_CAMERA_FOV_DEG,
  VIEWER_DEFAULT_CAMERA_OFFSET,
  VIEWER_FILL_LIGHT_INTENSITY,
  VIEWER_KEY_LIGHT_INTENSITY,
  VIEWER_SHADOW_BIAS,
  VIEWER_SHADOW_MAP_SIZE,
  VIEWER_SHADOW_NORMAL_BIAS,
} from "./viewerConstants";
import {
  applyCanonicalViewerGlOutput,
  getViewerPanVertexSelectionMarkerGeometry,
  viewerFallbackGridProps,
  VIEWER_INSPECT_OUTLINE_HEX,
  VIEWER_OUTLINE_THICKNESS_FACTOR,
  VIEWER_PV_OUTLINE_IDLE_HEX,
  VIEWER_SHELL_MESH_HEX,
} from "./viewerVisualTokens";
import {
  buildingShellGeometry,
  extensionVolumeGeometry,
  obstacleVolumeGeometry,
  panelQuadGeometry,
  roofClosureFacadeGeometry,
  roofEdgesLineGeometry,
  roofPatchGeometry,
  roofRidgesLineGeometry,
} from "./solarSceneThreeGeometry";
import { isValidCanonicalWorldConfig } from "../world/worldConvention";
import {
  buildDormerEdgesGeometry,
  buildDormerMesh,
  type DormerRuntimeExtensionInput,
} from "./dormer/buildDormerMesh";
import { extractRuntimeRoofExtensions } from "./dormer/extractRuntimeRoofExtensions";
import { buildPremiumHouse3DScene } from "./premium/buildPremiumHouse3DScene";
import type { PremiumHouse3DSceneAssembly } from "./premium/premiumHouse3DSceneTypes";
import { PremiumGeometryTrustStripe } from "./premium/PremiumGeometryTrustStripe";
import type { PremiumHouse3DViewMode } from "./premium/premiumHouse3DViewModes";

/** En mode édition sommet toit : laisse le rayon atteindre le maillage toiture (ignore PV / obstacles / extensions). */
function roofModelingSkipOccluderRaycast(
  this: THREE.Object3D,
  _raycaster: THREE.Raycaster,
  _intersects: THREE.Intersection[],
): void {
  void this;
  void _raycaster;
  void _intersects;
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
  finalizePvMoveFrom3d,
  hitTestPvBlockPanelFromImagePoint,
  readPvLayout3dOverlayState,
  removePvPanelFrom3d,
  removeSelectedPvPanelFrom3d,
  selectPvBlockFrom3d,
  type PvLayout3dOverlayState,
} from "../../runtime/pvPlacement3dProduct";
import { PvLayout3dDragController, type PvLayout3dDragSession } from "./PvLayout3dDragController";
import {
  compute3DRuntimeVerdict,
  dump3DRuntimeViewerGeoCompare,
  getLastAutopsySnapshot,
  log3DRuntimeVerdictFinal,
  type AutopsyLegacyRoofPath,
} from "../dev/runtime3DAutopsy";

/** Audit runtime temporaire — activer : `window.__CALPINAGE_DORMER_AUDIT__ = true` puis recharger. */
function dormerPremiumAuditLog(msg: string, detail?: Record<string, unknown>): void {
  if (typeof window === "undefined") return;
  const w = window as unknown as { __CALPINAGE_DORMER_AUDIT__?: boolean };
  if (w.__CALPINAGE_DORMER_AUDIT__ !== true) return;
  if (detail && Object.keys(detail).length > 0) {
    console.log("[DORMER_AUDIT]", msg, detail);
  } else {
    console.log("[DORMER_AUDIT]", msg);
  }
}

export interface SolarScene3DViewerProps {
  /**
   * Scène canonique `SolarScene3D` — **ou** `runtimeScene` si vous préférez ce nom côté appelant.
   * Au moins l’un des deux doit être fourni.
   */
  readonly scene?: SolarScene3D;
  /** Alias de `scene` (même type). Si `scene` est défini, il prime. */
  readonly runtimeScene?: SolarScene3D;
  readonly className?: string;
  readonly height?: number | string;
  readonly showRoof?: boolean;
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
  /**
   * Pass 5 — interaction pose / déplacement PV en 3D (phase `PV_LAYOUT`, vue 3D, flag `__CALPINAGE_3D_PV_LAYOUT_MODE__`).
   * Même chaîne legacy que le 2D (`pvSyncSaveRender`).
   */
  readonly pvLayout3DInteractionMode?: boolean;
}

function formatPanelTooltip(panelId: string, scene: SolarScene3D): string {
  const eff = getEffectivePanelVisualShading(panelId, scene);
  const title = `Panneau ${panelId}`;
  if (eff.state === "AVAILABLE" && eff.lossPct != null) {
    const pct = eff.lossPct.toLocaleString("fr-FR", {
      maximumFractionDigits: 1,
      minimumFractionDigits: Number.isInteger(eff.lossPct) ? 0 : 1,
    });
    if (eff.provenance === "near_snapshot_mean_fraction") {
      return `${title}\nIndicateur d'ombrage (scène 3D) : ${pct} %`;
    }
    return `${title}\nPerte shading : ${pct} %`;
  }
  return `${title}\nDonnée shading non disponible`;
}

function panelSurfaceMaterial(
  scene: SolarScene3D,
  panelId: string,
  showShading: boolean,
  inspectSelected: boolean,
  emissiveBonus: number,
): { color: number; emissive: number; emissiveIntensity: number } {
  if (!showShading) {
    const c = blendPvSurfaceColor(premiumTintHexForQualityScore(null), 0.2);
    const em = new THREE.Color(c);
    return {
      color: c,
      emissive: em.getHex(),
      // 0.12 : plancher d'émissivité pour que les panneaux restent visibles
      // même sans données d'ombrage (fond sombre, ACES tonemapping).
      emissiveIntensity: 0.12 + emissiveBonus + (inspectSelected ? 0.06 : 0),
    };
  }
  const eff = getEffectivePanelVisualShading(panelId, scene);
  const tintHex = premiumTintHexForQualityScore(
    eff.state === "AVAILABLE" ? eff.qualityScore01 : null,
  );
  const color = blendPvSurfaceColor(tintHex, eff.state === "AVAILABLE" ? 0.46 : 0.24);
  const em = new THREE.Color(tintHex);
  return {
    color,
    emissive: em.getHex(),
    emissiveIntensity:
      (eff.state === "AVAILABLE" ? 0.05 : 0.028) + emissiveBonus + (inspectSelected ? 0.07 : 0),
  };
}

function inspectData(kind: SceneInspectableKind, id: string, meshRole?: SceneInspectMeshRole): Record<string, unknown> {
  const payload: SceneInspectUserData =
    meshRole != null ? { kind, id: String(id), meshRole } : { kind, id: String(id) };
  return { [INSPECT_USERDATA_KEY]: payload };
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

function isInspectSelected(
  sel: SceneInspectionSelection | null,
  kind: SceneInspectableKind,
  id: string,
): boolean {
  return sel != null && sel.kind === kind && String(sel.id) === String(id);
}

function isPanHittingPatchId(hit: ScenePickHit | null, panId: string): boolean {
  if (hit == null) return false;
  if (hit.kind === "roof_patch") return String(hit.roofPlanePatchId) === String(panId);
  if (hit.kind === "roof_vertex") return String(hit.roofPlanePatchId) === String(panId);
  return false;
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
  return geo;
}

type PvLayout3dScreenPoint = { readonly x: number; readonly y: number };

type PvLayout3dProjectedPanel = {
  readonly id: string;
  readonly selected: boolean;
  readonly invalid: boolean;
  readonly enabled: boolean;
  readonly points: readonly PvLayout3dScreenPoint[];
};

type PvLayout3dProjectedGhost = {
  readonly id: string;
  readonly valid: boolean;
  readonly excluded: boolean;
  readonly source?: "expansion" | "autofill";
  readonly points: readonly PvLayout3dScreenPoint[];
};

type PvLayout3dProjectedSafeZone = {
  readonly id: string;
  readonly points: readonly PvLayout3dScreenPoint[];
};

type PvLayout3dProjectedHandles = {
  readonly blockId: string;
  readonly rotate: PvLayout3dScreenPoint;
  readonly move: PvLayout3dScreenPoint;
  readonly topOfBlock: PvLayout3dScreenPoint;
  readonly rotateImg: { readonly x: number; readonly y: number };
  readonly moveImg: { readonly x: number; readonly y: number };
};

type PvLayout3dScreenOverlayState = {
  readonly width: number;
  readonly height: number;
  readonly panels: readonly PvLayout3dProjectedPanel[];
  readonly ghosts: readonly PvLayout3dProjectedGhost[];
  readonly safeZones: readonly PvLayout3dProjectedSafeZone[];
  readonly handles: PvLayout3dProjectedHandles | null;
};

type PvLayout3dHandleUi = PvLayout3dProjectedHandles;

function projectWorldToScreenPoint(
  world: THREE.Vector3,
  camera: THREE.Camera,
  width: number,
  height: number,
): PvLayout3dScreenPoint | null {
  const p = world.clone().project(camera);
  if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) return null;
  return {
    x: ((p.x + 1) / 2) * width,
    y: ((-p.y + 1) / 2) * height,
  };
}

function pointsToSvg(points: readonly PvLayout3dScreenPoint[]): string {
  return points.map((p) => `${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(" ");
}

function overlaySignature(o: PvLayout3dScreenOverlayState | null): string {
  if (!o) return "null";
  const h = o.handles
    ? `${o.handles.blockId}:${o.handles.rotate.x.toFixed(1)},${o.handles.rotate.y.toFixed(1)}:${o.handles.move.x.toFixed(1)},${o.handles.move.y.toFixed(1)}`
    : "none";
  const panels = o.panels
    .filter((p) => p.selected || p.invalid)
    .map((p) => `${p.id}:${p.selected ? 1 : 0}:${p.invalid ? 1 : 0}:${p.points.map((pt) => `${pt.x.toFixed(0)},${pt.y.toFixed(0)}`).join(";")}`)
    .join("|");
  const ghosts = o.ghosts
    .map((g) => `${g.id}:${g.valid ? 1 : 0}:${g.excluded ? 1 : 0}:${g.points.map((pt) => `${pt.x.toFixed(0)},${pt.y.toFixed(0)}`).join(";")}`)
    .join("|");
  const safeZones = o.safeZones
    .map((z) => `${z.id}:${z.points.map((pt) => `${pt.x.toFixed(0)},${pt.y.toFixed(0)}`).join(";")}`)
    .join("|");
  return `${o.width}x${o.height}|${h}|${panels}|${ghosts}|${safeZones}`;
}

function PvLayout3dScreenOverlayProjector({
  scene,
  overlay,
  enabled,
  onProjected,
}: {
  readonly scene: SolarScene3D;
  readonly overlay: PvLayout3dOverlayState | null;
  readonly enabled: boolean;
  readonly onProjected: (overlay: PvLayout3dScreenOverlayState | null) => void;
}) {
  const { camera, gl } = useThree();
  const lastSigRef = useRef("");

  useEffect(() => {
    if (!enabled || !overlay) onProjected(null);
  }, [enabled, overlay, onProjected]);

  useFrame(() => {
    if (!enabled || !overlay) {
      if (lastSigRef.current !== "null") {
        lastSigRef.current = "null";
        onProjected(null);
      }
      return;
    }
    const rect = gl.domElement.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const projectImagePoly = (
      points: readonly { readonly x: number; readonly y: number }[],
      panId: string | null | undefined,
      offsetM: number,
    ): PvLayout3dScreenPoint[] => {
      const world = imagePolygonToRoofWorldPoints(scene, points, panId, offsetM);
      const projected: PvLayout3dScreenPoint[] = [];
      for (const w of world) {
        const p = projectWorldToScreenPoint(w, camera, width, height);
        if (!p) return [];
        projected.push(p);
      }
      return projected;
    };

    const panels = overlay.panels
      .map((p) => ({
        id: p.id,
        selected: p.selected,
        invalid: p.invalid,
        enabled: p.enabled,
        points: projectImagePoly(p.points, p.panId, 0.24),
      }))
      .filter((p) => p.points.length >= 3);
    const ghosts = overlay.ghosts
      .map((g) => ({
        id: g.id,
        valid: g.valid !== false,
        excluded: !!g.excluded,
        source: g.source,
        points: projectImagePoly(g.points, g.panId, 0.26),
      }))
      .filter((g) => g.points.length >= 3);
    const safeZones = overlay.safeZones.flatMap((z) =>
      z.polygons
        .map((poly, index) => ({
          id: `${z.panId}-${index}`,
          points: projectImagePoly(poly, z.panId, 0.28),
        }))
        .filter((z2) => z2.points.length >= 3),
    );

    let handles: PvLayout3dProjectedHandles | null = null;
    if (overlay.handles) {
      const selectedPanId = overlay.panels.find((p) => p.selected)?.panId ?? null;
      const [rotateW, moveW, topW] = imagePolygonToRoofWorldPoints(
        scene,
        [overlay.handles.rotate, overlay.handles.move, overlay.handles.topOfBlock],
        selectedPanId,
        0.32,
      );
      const rotate = rotateW ? projectWorldToScreenPoint(rotateW, camera, width, height) : null;
      const move = moveW ? projectWorldToScreenPoint(moveW, camera, width, height) : null;
      const topOfBlock = topW ? projectWorldToScreenPoint(topW, camera, width, height) : null;
      if (rotate && move && topOfBlock) {
        handles = {
          blockId: overlay.handles.blockId,
          rotate,
          move,
          topOfBlock,
          rotateImg: overlay.handles.rotate,
          moveImg: overlay.handles.move,
        };
      }
    }
    if (!handles) {
      const selectedPanels = overlay.panels.filter((p) => p.selected && p.points.length >= 3);
      const selectedProjected = panels.filter((p) => p.selected && p.points.length >= 3);
      if (overlay.focusBlockId && selectedPanels.length > 0 && selectedProjected.length > 0) {
        const screenPts = selectedProjected.flatMap((p) => p.points);
        const imagePts = selectedPanels.flatMap((p) => p.points);
        const minX = Math.min(...screenPts.map((p) => p.x));
        const maxX = Math.max(...screenPts.map((p) => p.x));
        const minY = Math.min(...screenPts.map((p) => p.y));
        const maxY = Math.max(...screenPts.map((p) => p.y));
        const imgMinY = Math.min(...imagePts.map((p) => p.y));
        const imgMaxY = Math.max(...imagePts.map((p) => p.y));
        const cx = screenPts.reduce((sum, p) => sum + p.x, 0) / screenPts.length;
        const cy = screenPts.reduce((sum, p) => sum + p.y, 0) / screenPts.length;
        const imgCx = imagePts.reduce((sum, p) => sum + p.x, 0) / imagePts.length;
        const imgCy = imagePts.reduce((sum, p) => sum + p.y, 0) / imagePts.length;
        const screenOffset = Math.max(36, Math.min(56, (maxY - minY) * 0.35 || 48));
        const imgOffset = Math.max(20, Math.min(90, (imgMaxY - imgMinY) * 0.45 || 48));
        handles = {
          blockId: overlay.focusBlockId,
          rotate: { x: Math.min(Math.max(cx, minX), maxX), y: cy - screenOffset },
          move: { x: Math.min(Math.max(cx, minX), maxX), y: cy + screenOffset },
          topOfBlock: { x: cx, y: cy },
          rotateImg: { x: imgCx, y: imgCy - imgOffset },
          moveImg: { x: imgCx, y: imgCy + imgOffset },
        };
      }
    }

    const projected: PvLayout3dScreenOverlayState = { width, height, panels, ghosts, safeZones, handles };
    const sig = overlaySignature(projected);
    if (sig !== lastSigRef.current) {
      lastSigRef.current = sig;
      onProjected(projected);
    }
  });

  return null;
}

function PvLayout3dSvgOverlay({
  overlay,
  onMovePointerDown,
  onRotatePointerDown,
}: {
  readonly overlay: PvLayout3dScreenOverlayState | null;
  readonly onMovePointerDown: (e: ReactPointerEvent<Element>, h: PvLayout3dHandleUi) => void;
  readonly onRotatePointerDown: (e: ReactPointerEvent<Element>, h: PvLayout3dHandleUi) => void;
}) {
  if (!overlay) return null;
  const h = overlay.handles;
  return (
    <svg
      aria-hidden="true"
      width={overlay.width}
      height={overlay.height}
      viewBox={`0 0 ${overlay.width} ${overlay.height}`}
      style={{
        position: "absolute",
        inset: 0,
        zIndex: 6,
        pointerEvents: "none",
        overflow: "hidden",
      }}
    >
      {h ? (
        <g>
          <line
            x1={h.topOfBlock.x}
            y1={h.topOfBlock.y}
            x2={h.rotate.x}
            y2={h.rotate.y}
            stroke="rgba(255,255,255,0.34)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <line
            x1={h.topOfBlock.x}
            y1={h.topOfBlock.y}
            x2={h.move.x}
            y2={h.move.y}
            stroke="rgba(255,255,255,0.34)"
            strokeWidth={1}
            vectorEffect="non-scaling-stroke"
          />
          <circle
            cx={h.rotate.x}
            cy={h.rotate.y}
            r={24}
            fill="transparent"
            style={{ pointerEvents: "auto", cursor: "grab" }}
            onPointerDown={(e) => onRotatePointerDown(e, h)}
          />
          <circle cx={h.rotate.x} cy={h.rotate.y} r={9} fill="#6366F1" stroke="rgba(0,0,0,0.35)" strokeWidth={1} />
          <path
            d={`M ${(h.rotate.x - 4.6).toFixed(1)} ${(h.rotate.y + 2.6).toFixed(1)} A 5 5 0 1 1 ${(h.rotate.x + 4.7).toFixed(1)} ${(h.rotate.y - 1.8).toFixed(1)}`}
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={1}
          />
          <path
            d={`M ${(h.rotate.x + 4.7).toFixed(1)} ${(h.rotate.y - 1.8).toFixed(1)} l -0.4 3.0 l -2.5 -1.7`}
            fill="none"
            stroke="rgba(0,0,0,0.55)"
            strokeWidth={1}
          />
          <circle
            cx={h.move.x}
            cy={h.move.y}
            r={22}
            fill="transparent"
            style={{ pointerEvents: "auto", cursor: "move" }}
            onPointerDown={(e) => onMovePointerDown(e, h)}
          />
          <circle cx={h.move.x} cy={h.move.y} r={6} fill="#ffffff" stroke="#6366F1" strokeWidth={1.25} />
          <path
            d={`M ${(h.move.x - 3.5).toFixed(1)} ${h.move.y.toFixed(1)} L ${(h.move.x + 3.5).toFixed(1)} ${h.move.y.toFixed(1)} M ${h.move.x.toFixed(1)} ${(h.move.y - 3.5).toFixed(1)} L ${h.move.x.toFixed(1)} ${(h.move.y + 3.5).toFixed(1)}`}
            stroke="#6366F1"
            strokeWidth={1}
          />
        </g>
      ) : null}
    </svg>
  );
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
          polygonOffsetFactor={-1}
          polygonOffsetUnits={-1}
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

/** Lumières : racine séparée du contenu géométrique. */
function CanonicalViewerLights({
  center,
  maxDim,
  ambientScale,
  keyScale,
  fillScale,
  shadowMapSize,
}: {
  readonly center: THREE.Vector3;
  readonly maxDim: number;
  readonly ambientScale: number;
  readonly keyScale: number;
  readonly fillScale: number;
  readonly shadowMapSize: number;
}) {
  const cx = center.x;
  const cy = center.y;
  const cz = center.z;
  const m = maxDim;

  return (
    <>
      <ambientLight intensity={VIEWER_AMBIENT_INTENSITY * ambientScale} />
      <directionalLight
        position={[cx + m * 1.65, cy + m * 1.35, cz + m * 2.15]}
        intensity={VIEWER_KEY_LIGHT_INTENSITY * keyScale}
        castShadow
        shadow-mapSize={[shadowMapSize, shadowMapSize]}
        shadow-bias={VIEWER_SHADOW_BIAS}
        shadow-normalBias={VIEWER_SHADOW_NORMAL_BIAS}
      />
      <directionalLight
        position={[cx - m * 1.25, cy - m * 0.95, cz + m * 0.55]}
        intensity={VIEWER_FILL_LIGHT_INTENSITY * fillScale}
      />
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
  enableRoofVertexZEdit,
  enableRoofVertexXYEdit,
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
  debugRuntime,
  satelliteTexture,
  satelliteUvMapper,
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
  /** Runtime brut (ex. CALPINAGE_STATE) — champs 2D lucarne pour rendu dormer premium (couche visuelle). */
  readonly debugRuntime?: unknown;
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
}) {
  const pvPanelRaycastPassThrough = roofModelingPassThroughOccluders && !pvLayout3DInteractionMode;
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
    return scene.obstacleVolumes.map((v) => ({ id: v.id, geo: obstacleVolumeGeometry(v) }));
  }, [scene.obstacleVolumes]);

  const dormerPremiumLayer = useMemo(() => {
    const wc = scene.worldConfig;
    const patches = scene.roofModel.roofPlanePatches;
    const volumeRows = scene.extensionVolumes.map((v, index) => ({
      index,
      id: String(v.id),
    }));
    dormerPremiumAuditLog("canonical extensionVolumes[]", { volumes: volumeRows });

    if (!wc || !isValidCanonicalWorldConfig(wc) || !patches?.length) {
      dormerPremiumAuditLog("premium layer early_exit", {
        hasWc: !!wc,
        wcValid: !!(wc && isValidCanonicalWorldConfig(wc)),
        patchCount: patches?.length ?? 0,
      });
      return {
        meshes: [] as { id: string; geo: THREE.BufferGeometry; edges: THREE.BufferGeometry | null }[],
        replaceKey: "",
        premiumIds: new Set<string>(),
      };
    }
    const roofModel = { world: wc, roofPlanePatches: patches };
    const rawList = extractRuntimeRoofExtensions(debugRuntime);
    dormerPremiumAuditLog("roofExtensions[] count", { count: rawList.length });
    const volIdSet = new Set(scene.extensionVolumes.map((v) => String(v.id)));
    const volIdsArr = [...volIdSet];
    const replaceIds: string[] = [];
    const meshes: { id: string; geo: THREE.BufferGeometry; edges: THREE.BufferGeometry | null }[] = [];

    for (let ri = 0; ri < rawList.length; ri++) {
      const raw = rawList[ri];
      if (!raw || typeof raw !== "object") continue;
      const rec = raw as Record<string, unknown>;
      const id = rec.id != null ? String(rec.id) : "";
      const ridge = rec.ridge as { a?: unknown; b?: unknown } | undefined;
      const ridgePresent =
        !!ridge?.a &&
        !!ridge?.b &&
        typeof (ridge.a as { x?: number })?.x === "number" &&
        typeof (ridge.a as { y?: number })?.y === "number" &&
        typeof (ridge.b as { x?: number })?.x === "number" &&
        typeof (ridge.b as { y?: number })?.y === "number";
      const contourPts = (rec.contour as { points?: unknown[] } | undefined)?.points;
      const contourCount = Array.isArray(contourPts) ? contourPts.length : 0;
      dormerPremiumAuditLog("roofExtension candidate", {
        index: ri,
        runtimeId: id || "(empty)",
        type: rec.type,
        kind: rec.kind,
        dormerType: rec.dormerType,
        ridgeHeightRelM: rec.ridgeHeightRelM,
        contourPointsCount: contourCount,
        ridgePresent: ridgePresent ? "OUI" : "NON",
      });

      if (!id) {
        dormerPremiumAuditLog("MATCH FAIL: empty runtime id", {
          index: ri,
          volumeIds: volIdsArr,
        });
        continue;
      }
      if (!volIdSet.has(id)) {
        dormerPremiumAuditLog("MATCH FAIL: runtime id not in extensionVolumes", {
          runtimeId: id,
          volumeIds: volIdsArr,
        });
        continue;
      }
      dormerPremiumAuditLog("MATCH OK", { id });
      dormerPremiumAuditLog("CALLED buildDormerMesh", { id });
      const geo = buildDormerMesh(rec as DormerRuntimeExtensionInput, roofModel);
      if (!geo) {
        dormerPremiumAuditLog("RESULT: null (voir GUARD [DORMER_AUDIT] ci-dessus dans buildDormerMesh)", {
          id,
        });
        continue;
      }
      dormerPremiumAuditLog("RESULT: geometry (viewer)", { id });
      const edges = buildDormerEdgesGeometry(geo);
      replaceIds.push(id);
      meshes.push({ id, geo, edges });
    }
    replaceIds.sort();
    const premiumIds = new Set(meshes.map((m) => String(m.id)));
    return { meshes, replaceKey: replaceIds.join("|"), premiumIds };
  }, [debugRuntime, scene.worldConfig, scene.roofModel.roofPlanePatches, scene.extensionVolumes]);

  const extGeos = useMemo(() => {
    const premiumIds = dormerPremiumLayer.premiumIds;
    if (typeof window !== "undefined") {
      const w = window as unknown as { __CALPINAGE_DORMER_AUDIT__?: boolean };
      if (w.__CALPINAGE_DORMER_AUDIT__ === true) {
        console.log("[DORMER_REPLACE]", {
          premiumIds: Array.from(premiumIds),
          extensionVolumes: scene.extensionVolumes.map((v) => v.id),
        });
      }
    }
    return scene.extensionVolumes
      .filter((v) => !premiumIds.has(String(v.id)))
      .map((v) => ({ id: v.id, geo: extensionVolumeGeometry(v) }));
  }, [scene.extensionVolumes, dormerPremiumLayer.premiumIds]);

  const panelGeos = useMemo(() => {
    return scene.pvPanels.map((p) => ({
      id: String(p.id),
      geo: panelQuadGeometry(p),
    }));
  }, [scene.pvPanels]);

  const pv3dOverlayPanelById = useMemo(() => {
    const m = new Map<string, PvLayout3dOverlayState["panels"][number]>();
    if (!pvLayout3dOverlayState) return m;
    for (const panel of pvLayout3dOverlayState.panels) m.set(String(panel.id), panel);
    return m;
  }, [pvLayout3dOverlayState]);

  const pv3dLivePanelGeos = useMemo(() => {
    if (!pvLayout3DInteractionMode || !pvLayout3dOverlayState) return [];
    return pvLayout3dOverlayState.panels.flatMap((p) => {
      if (!p.selected) return [];
      const fill = imagePolygonToRoofMeshGeometry(scene, p.points, p.panId, 0.075);
      const line = imagePolygonToRoofLineGeometry(scene, p.points, p.panId, 0.082);
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

  const pv3dGhostGeos = useMemo(() => {
    if (!pvLayout3DInteractionMode || !pvLayout3dOverlayState) return [];
    return pvLayout3dOverlayState.ghosts.flatMap((g) => {
      const fill = imagePolygonToRoofMeshGeometry(scene, g.points, g.panId, 0.052);
      const line = imagePolygonToRoofLineGeometry(scene, g.points, g.panId, 0.06);
      return fill || line
        ? [{ id: g.id, fill, line, valid: g.valid !== false, excluded: !!g.excluded, source: g.source }]
        : [];
    });
  }, [scene, pvLayout3DInteractionMode, pvLayout3dOverlayState]);

  const pv3dSafeZoneGeos = useMemo(() => {
    if (!pvLayout3DInteractionMode || !pvLayout3dOverlayState) return [];
    return pvLayout3dOverlayState.safeZones.flatMap((z) =>
      z.polygons.flatMap((poly, index) => {
        const line = imagePolygonToRoofLineGeometry(scene, poly, z.panId, 0.04);
        return line ? [{ id: `${z.panId}-${index}`, line }] : [];
      }),
    );
  }, [scene, pvLayout3DInteractionMode, pvLayout3dOverlayState]);

  const allGeos = useMemo(
    () => [
      ...(shellGeo ? [shellGeo] : []),
      ...roofGeos.map((x) => x.geo),
      ...(roofClosureGeo ? [roofClosureGeo] : []),
      ...(edgeGeo ? [edgeGeo] : []),
      ...(ridgeGeo ? [ridgeGeo] : []),
      ...dormerPremiumLayer.meshes.flatMap((m) => [m.geo, ...(m.edges ? [m.edges] : [])]),
      ...obsGeos.map((x) => x.geo),
      ...extGeos.map((x) => x.geo),
      ...panelGeos.map((x) => x.geo),
      ...pv3dLivePanelGeos.flatMap((x) => [x.fill, x.line].filter((g): g is THREE.BufferGeometry => g != null)),
      ...pv3dGhostGeos.flatMap((x) => [x.fill, x.line].filter((g): g is THREE.BufferGeometry => g != null)),
      ...pv3dSafeZoneGeos.map((x) => x.line),
    ],
    [
      shellGeo,
      roofGeos,
      roofClosureGeo,
      edgeGeo,
      ridgeGeo,
      dormerPremiumLayer.meshes,
      obsGeos,
      extGeos,
      panelGeos,
      pv3dLivePanelGeos,
      pv3dGhostGeos,
      pv3dSafeZoneGeos,
    ],
  );

  const solidGeosForNormalsAudit = useMemo(
    () => [
      ...(shellGeo ? [shellGeo] : []),
      ...roofGeos.map((x) => x.geo),
      ...(roofClosureGeo ? [roofClosureGeo] : []),
      ...dormerPremiumLayer.meshes.map((m) => m.geo),
      ...obsGeos.map((x) => x.geo),
      ...extGeos.map((x) => x.geo),
      ...panelGeos.map((x) => x.geo),
    ],
    [shellGeo, roofGeos, roofClosureGeo, dormerPremiumLayer.meshes, obsGeos, extGeos, panelGeos],
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
  const visDormerPremium = visExt && dormerPremiumLayer.meshes.length > 0;
  const showDormerDebugWire =
    typeof window !== "undefined" &&
    (window as unknown as { __CALPINAGE_DORMER_DEBUG__?: boolean }).__CALPINAGE_DORMER_DEBUG__ === true;
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
      <CanonicalViewerLights
        center={center}
        maxDim={maxDimLocal}
        ambientScale={assembly.lighting.ambientScale}
        keyScale={assembly.lighting.keyScale}
        fillScale={assembly.lighting.fillScale}
        shadowMapSize={assembly.lighting.shadowMapSize}
      />
      {shellGeo && (
        <mesh
          geometry={shellGeo}
          castShadow
          receiveShadow
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
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
            emissive={shellInspectSelected ? "#4a3f6b" : "#000000"}
            emissiveIntensity={shellInspectSelected ? 0.12 : 0}
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
      {visRoof &&
        roofGeos.map(({ id, geo }) => {
          const sid = String(id);
          const inspectPan = inspectMode && isInspectSelected(inspectionSelection, "PAN", sid);
          const pan3d = panSelection3DMode && isPanHittingPatchId(selectedHit, sid);
          const panHighlighted = inspectPan || pan3d;
          const emissiveHex = inspectPan ? "#3d5a80" : pan3d ? "#6a4c9c" : "#000000";
          const emissiveIntensity = panHighlighted ? (inspectPan ? 0.22 : 0.2) : 0;
          const outlineHex = inspectPan ? VIEWER_INSPECT_OUTLINE_HEX.pan : VIEWER_INSPECT_OUTLINE_HEX.panSelection3d;
          return (
            <mesh
              key={`roof-${id}`}
              userData={inspectData("PAN", sid, "roof_tessellation")}
              geometry={geo}
              castShadow
              receiveShadow
              position={[0, 0, 0]}
              onClick={onRoofMeshClick ?? (inspectMode ? onInspectClick : undefined)}
              onPointerMove={
                showRoofModelingHoverUx
                  ? (e) => {
                      e.stopPropagation();
                      const ne = e.nativeEvent;
                      const gl = r3fGl(e);
                      const cam = e.camera;
                      let hit = null as ReturnType<typeof pickSceneHitFromIntersections>;
                      if (panSelection3DMode && cam && gl?.domElement) {
                        hit = pickSceneHitForRoofVertexModeling(e.intersections, {
                          camera: cam,
                          canvasRect: gl.domElement.getBoundingClientRect(),
                          clientX: ne.clientX,
                          clientY: ne.clientY,
                        });
                        if (!hit) {
                          onRoofModelingPointerUi!(null);
                          return;
                        }
                      } else {
                        hit = pickSceneHitFromIntersections(e.intersections);
                        if (!hit || (hit.kind !== "roof_patch" && hit.kind !== "roof_vertex")) {
                          onRoofModelingPointerUi!(null);
                          return;
                        }
                      }
                      const label =
                        hit.kind === "roof_vertex"
                          ? "Sommet — glisser le point orange (vertical) ou panneau pour la hauteur"
                          : "Pan toiture — clic pour sélectionner";
                      onRoofModelingPointerUi!({
                        clientX: ne.clientX,
                        clientY: ne.clientY,
                        label,
                        cursor: "pointer",
                      });
                    }
                  : undefined
              }
              onPointerOut={showRoofModelingHoverUx ? () => onRoofModelingPointerUi!(null) : undefined}
              onPointerDown={onRoofTessellationPv3dProbePointerDown}
            >
              {satelliteTexture && !autopsyDevColors ? (
                /* emissiveMap : affiche la texture satellite sans dépendance lumière
                   (même pipeline meshStandardMaterial → pas de conflit depth-buffer avec les panneaux).
                   color="#000000" : zéro diffus — seul l'emissive (= texture satellite) s'affiche. */
                <meshStandardMaterial
                  emissiveMap={satelliteTexture}
                  emissive={panHighlighted ? "#5577bb" : "#ffffff"}
                  emissiveIntensity={panHighlighted ? 0.7 : 1}
                  color="#000000"
                  metalness={0}
                  roughness={1}
                  side={THREE.DoubleSide}
                  polygonOffset
                  polygonOffsetFactor={1}
                  polygonOffsetUnits={1}
                />
              ) : (
                <meshStandardMaterial
                  color={autopsyDevColors ? "#00ffff" : mRoof.color}
                  metalness={mRoof.metalness}
                  roughness={mRoof.roughness}
                  flatShading={mRoof.flatShading ?? false}
                  side={THREE.DoubleSide}
                  polygonOffset
                  polygonOffsetFactor={1}
                  polygonOffsetUnits={1}
                  emissive={emissiveHex}
                  emissiveIntensity={emissiveIntensity}
                />
              )}
              {panHighlighted && (
                <Outlines
                  thickness={outlineThickness}
                  color={outlineHex}
                  opacity={0.95}
                  toneMapped={false}
                />
              )}
            </mesh>
          );
        })}
      {panVertexSelectionMarker}
      {visRoof && roofClosureGeo && (
        <mesh geometry={roofClosureGeo} castShadow receiveShadow position={[0, 0, 0]}>
          <meshStandardMaterial
            color={autopsyDevColors ? "#6666ee" : mRoof.color}
            metalness={mRoof.metalness}
            roughness={Math.min(1, (mRoof.roughness ?? 0.7) + 0.06)}
            flatShading={mRoof.flatShading ?? false}
            side={THREE.DoubleSide}
            polygonOffset
            polygonOffsetFactor={1}
            polygonOffsetUnits={1}
          />
        </mesh>
      )}
      {visRoofEdges && edgeGeo && (
        <lineSegments geometry={edgeGeo}>
          <lineBasicMaterial
            color={mEdge.color}
            transparent={mEdge.opacity < 1}
            opacity={mEdge.opacity}
          />
        </lineSegments>
      )}
      {visRidges && ridgeGeo && (
        <lineSegments
          geometry={ridgeGeo}
          onPointerDown={
            enableStructuralRidgeHeightEdit && onStructuralRidgeLinePointerDown
              ? (e) => {
                  e.stopPropagation();
                  onStructuralRidgeLinePointerDown(e);
                }
              : undefined
          }
        >
          <lineBasicMaterial
            color={mRidge.color}
            transparent={mRidge.opacity < 1}
            opacity={mRidge.opacity}
          />
        </lineSegments>
      )}
      {visDormerPremium &&
        dormerPremiumLayer.meshes.map(({ id, geo, edges }) => {
          const sid = String(id);
          const sel = isInspectSelected(inspectionSelection, "EXTENSION", sid);
          return (
            <group key={`dormer-premium-${id}`}>
              <mesh
                userData={inspectData("EXTENSION", sid, "volume_surface")}
                geometry={geo}
                castShadow
                receiveShadow
                raycast={roofModelingPassThroughOccluders ? roofModelingSkipOccluderRaycast : undefined}
                onClick={inspectMode ? onInspectClick : undefined}
              >
                <meshStandardMaterial
                  color={mExt.color}
                  metalness={mExt.metalness}
                  roughness={mExt.roughness}
                  flatShading={mExt.flatShading ?? false}
                  side={THREE.DoubleSide}
                  emissive={sel ? "#33691e" : "#000000"}
                  emissiveIntensity={sel ? 0.32 : 0}
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
              {showDormerDebugWire && edges && (
                <lineSegments geometry={edges}>
                  <lineBasicMaterial color="#33e6ff" toneMapped={false} depthTest />
                </lineSegments>
              )}
            </group>
          );
        })}
      {visObs &&
        obsGeos.map(({ id, geo }) => {
          const sid = String(id);
          const sel = isInspectSelected(inspectionSelection, "OBSTACLE", sid);
          return (
            <mesh
              key={`obs-${id}`}
              userData={inspectData("OBSTACLE", sid)}
              geometry={geo}
              castShadow
              receiveShadow
              raycast={roofModelingPassThroughOccluders ? roofModelingSkipOccluderRaycast : undefined}
              onClick={inspectMode ? onInspectClick : undefined}
            >
              <meshStandardMaterial
                color={mObs.color}
                metalness={mObs.metalness}
                roughness={mObs.roughness}
                flatShading={mObs.flatShading ?? false}
                emissive={sel ? "#6d4c41" : "#000000"}
                emissiveIntensity={sel ? 0.35 : 0}
              />
              {inspectMode && sel && (
                <Outlines
                  thickness={outlineThickness}
                  color={VIEWER_INSPECT_OUTLINE_HEX.obstacle}
                  opacity={0.95}
                  toneMapped={false}
                />
              )}
            </mesh>
          );
        })}
      {visExt &&
        extGeos.map(({ id, geo }) => {
          const sid = String(id);
          const sel = isInspectSelected(inspectionSelection, "EXTENSION", sid);
          return (
            <mesh
              key={`ext-${id}`}
              userData={inspectData("EXTENSION", sid)}
              geometry={geo}
              castShadow
              receiveShadow
              raycast={roofModelingPassThroughOccluders ? roofModelingSkipOccluderRaycast : undefined}
              onClick={inspectMode ? onInspectClick : undefined}
            >
              <meshStandardMaterial
                color={mExt.color}
                metalness={mExt.metalness}
                roughness={mExt.roughness}
                flatShading={mExt.flatShading ?? false}
                emissive={sel ? "#33691e" : "#000000"}
                emissiveIntensity={sel ? 0.32 : 0}
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
          );
        })}
      {pvLayout3DInteractionMode &&
        pv3dSafeZoneGeos.map(({ id, line }) => (
          <lineSegments key={`pv3d-safe-${id}`} geometry={line} renderOrder={21}>
            <lineBasicMaterial color="#ef4444" transparent opacity={0.95} toneMapped={false} depthTest />
          </lineSegments>
        ))}
      {pvLayout3DInteractionMode &&
        pv3dGhostGeos.map(({ id, fill, line, valid, excluded }) => (
          <group key={`pv3d-ghost-${id}`}>
            {fill ? (
              <mesh geometry={fill} renderOrder={22}>
                <meshBasicMaterial
                  color={valid ? (excluded ? "#a1a1aa" : "#94a3b8") : "#ef4444"}
                  transparent
                  opacity={valid ? (excluded ? 0.12 : 0.28) : 0.2}
                  side={THREE.DoubleSide}
                  depthWrite={false}
                  depthTest
                  toneMapped={false}
                />
              </mesh>
            ) : null}
            {line ? (
              <lineSegments geometry={line} renderOrder={23}>
                <lineBasicMaterial
                  color={valid ? (excluded ? "#71717a" : "#cbd5e1") : "#ef4444"}
                  transparent
                  opacity={valid ? 0.78 : 0.92}
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
                  color={invalid ? "#dc2626" : selected ? "#30396f" : "#2c334a"}
                  emissive={invalid ? "#ef4444" : selected ? "#6366f1" : "#111827"}
                  emissiveIntensity={invalid ? 0.5 : selected ? 0.26 : 0.1}
                  metalness={pvB.panelMetalness}
                  roughness={pvB.panelRoughness}
                  transparent={enabled === false}
                  opacity={enabled === false ? 0.42 : 1}
                  side={THREE.DoubleSide}
                  polygonOffset
                  polygonOffsetFactor={-4}
                  polygonOffsetUnits={-4}
                  depthTest
                />
              </mesh>
            ) : null}
            {line ? (
              <lineSegments geometry={line} renderOrder={31}>
                <lineBasicMaterial
                  color={invalid ? "#f87171" : "#6366f1"}
                  transparent
                  opacity={invalid ? 0.98 : 0.92}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
          </group>
        ))}
      {visPanels &&
        panelGeos.map(({ id, geo }) => {
          const pvSel = isInspectSelected(inspectionSelection, "PV_PANEL", id);
          const pv3dPanel = pvLayout3DInteractionMode ? pv3dOverlayPanelById.get(id) : null;
          const pv3dSelected = !!pv3dPanel?.selected;
          const pv3dInvalid = !!pv3dPanel?.invalid;
          if (pvLayout3DInteractionMode && pv3dSelectedLivePanelIds.has(String(id))) return null;
          const mat = panelSurfaceMaterial(scene, id, visPanelShading, pvSel || pv3dSelected, pvB.panelEmissiveIntensityBonus);
          const thinOutline =
            pv3dInvalid ? (
              <Outlines
                thickness={outlineThickness * 1.35}
                color="#f59e0b"
                opacity={0.96}
                toneMapped={false}
              />
            ) : pv3dSelected ? (
              <Outlines
                thickness={outlineThickness * 1.25}
                color="#6366f1"
                opacity={0.95}
                toneMapped={false}
              />
            ) : pvB.outlinePanelsWhenNotInspecting && !inspectMode ? (
              <Outlines
                thickness={outlineThickness * 0.85}
                color={VIEWER_PV_OUTLINE_IDLE_HEX}
                opacity={0.35}
                toneMapped={false}
              />
            ) : null;
          return (
            <mesh
              key={`pv-${id}`}
              userData={inspectData("PV_PANEL", id)}
              geometry={geo}
              castShadow
              receiveShadow
              renderOrder={pvLayout3DInteractionMode ? 20 : 0}
              raycast={pvPanelRaycastPassThrough ? roofModelingSkipOccluderRaycast : undefined}
              onClick={inspectMode ? onInspectClick : undefined}
              onPointerDown={
                pvLayout3DInteractionMode && onPvPanelPvLayout3dPointerDown
                  ? (e) => {
                      onPvPanelPvLayout3dPointerDown(e, String(id));
                    }
                  : undefined
              }
              onPointerOver={(e) => {
                e.stopPropagation();
                onPanelHover?.({ panelId: id, clientX: e.clientX, clientY: e.clientY });
              }}
              onPointerOut={(e) => {
                e.stopPropagation();
                onPanelHover?.(null);
              }}
              onPointerMove={(e) => {
                e.stopPropagation();
                onPanelHover?.({ panelId: id, clientX: e.clientX, clientY: e.clientY });
              }}
            >
              <meshStandardMaterial
                color={pv3dInvalid ? "#d97706" : mat.color}
                emissive={pv3dInvalid ? "#f59e0b" : pv3dSelected ? "#6366f1" : mat.emissive}
                emissiveIntensity={pv3dInvalid ? 0.34 : pv3dSelected ? mat.emissiveIntensity + 0.22 : mat.emissiveIntensity}
                metalness={pvB.panelMetalness}
                roughness={pvB.panelRoughness}
                side={THREE.DoubleSide}
                polygonOffset
                polygonOffsetFactor={pvLayout3DInteractionMode ? -3 : -1}
                polygonOffsetUnits={pvLayout3DInteractionMode ? -3 : -1}
              />
              {thinOutline}
              {inspectMode && pvSel && (
                <Outlines
                  thickness={outlineThickness}
                  color={VIEWER_INSPECT_OUTLINE_HEX.pvPanelSelected}
                  opacity={0.9}
                  toneMapped={false}
                />
              )}
            </mesh>
          );
        })}
      {visSun && <primitive object={arrowRef} />}
    </>
  );
}

function DebugSceneHelpers({
  box,
  center,
  maxDim,
  scene,
}: {
  readonly box: THREE.Box3;
  readonly center: THREE.Vector3;
  readonly maxDim: number;
  readonly scene: SolarScene3D;
}) {
  const axisSize = Math.max(maxDim * 0.35, 3);
  const boxHelper = useMemo(() => {
    const h = new THREE.Box3Helper(box, new THREE.Color("#ff8800"));
    return h;
  }, [box]);

  useEffect(() => {
    return () => { boxHelper.dispose(); };
  }, [boxHelper]);

  const gridZ = Math.min(box.min.z - 0.15, 0);
  const groundCenter = useMemo(
    () => new THREE.Vector3(center.x, center.y, gridZ),
    [center.x, center.y, gridZ],
  );
  const upArrow = useMemo(() => {
    const dir = new THREE.Vector3(0, 0, 1);
    const len = axisSize * 0.6;
    return new THREE.ArrowHelper(dir, groundCenter, len, 0x4488ff, len * 0.12, len * 0.06);
  }, [groundCenter, axisSize]);

  useEffect(() => {
    return () => { upArrow.dispose(); };
  }, [upArrow]);

  return (
    <>
      <axesHelper args={[axisSize]} position={[center.x, center.y, center.z]} />
      <primitive object={boxHelper} />
      <primitive object={upArrow} />
    </>
  );
}

function DebugStatsOverlay({
  scene,
  box,
  groundPlaneConfig,
  groundZ,
}: {
  readonly scene: SolarScene3D;
  readonly box: THREE.Box3;
  readonly groundPlaneConfig?: { metersPerPixel: number; northAngleDeg: number; image: GroundPlaneImageData } | null;
  readonly groundZ?: number;
}) {
  const patches = scene.roofModel.roofPlanePatches.length;
  const panels = scene.pvPanels.length;
  const obs = scene.obstacleVolumes.length;
  const ext = scene.extensionVolumes.length;
  const edges = scene.roofModel.roofEdges.length;
  const ridges = scene.roofModel.roofRidges?.length ?? 0;
  const s = new THREE.Vector3();
  box.getSize(s);
  const zRange = `${box.min.z.toFixed(2)}..${box.max.z.toFixed(2)}`;

  return (
    <div
      style={{
        position: "absolute",
        bottom: 8,
        left: 8,
        zIndex: 5,
        padding: "8px 10px",
        background: "rgba(0,0,0,0.78)",
        borderRadius: 6,
        border: "1px solid rgba(255,180,0,0.35)",
        color: "rgba(255,220,140,0.95)",
        fontFamily: "ui-monospace, monospace",
        fontSize: 11,
        lineHeight: 1.5,
        pointerEvents: "none",
        maxWidth: 320,
      }}
      data-testid="viewer-debug-stats"
    >
      <div><strong>DEBUG 3D</strong></div>
      <div>
        Pans: {patches} | Shell: {scene.buildingShell ? 1 : 0} | Panels: {panels} | Obs: {obs} | Ext: {ext}
      </div>
      {scene.metadata.buildGuards != null && scene.metadata.buildGuards.length > 0 ? (
        <div style={{ marginTop: 6, borderTop: "1px solid rgba(255,180,0,0.25)", paddingTop: 6 }}>
          <div>
            <strong>NIVEAU 0</strong>
          </div>
          {scene.metadata.buildGuards.map((g) => (
            <div key={g.code} style={{ marginTop: 3, fontSize: 10, opacity: 0.9 }}>
              [{g.severity}] {g.code}: {g.message}
            </div>
          ))}
        </div>
      ) : null}
      <div>Edges: {edges} | Ridges: {ridges}</div>
      <div>BBox size: {s.x.toFixed(1)}×{s.y.toFixed(1)}×{s.z.toFixed(1)} m</div>
      <div>Z range: {zRange} m</div>
      <div style={{ marginTop: 2, opacity: 0.75 }}>
        Axes: <span style={{ color: "#ff4444" }}>X=Est</span>{" "}
        <span style={{ color: "#44ff44" }}>Y=Nord</span>{" "}
        <span style={{ color: "#4488ff" }}>Z=Haut</span>
      </div>
      {groundPlaneConfig && (
        <div style={{ marginTop: 4, borderTop: "1px solid rgba(255,180,0,0.2)", paddingTop: 4 }}>
          <div><strong>FOND PLAN</strong></div>
          <div>Image: {groundPlaneConfig.image.widthPx}×{groundPlaneConfig.image.heightPx} px</div>
          <div>mpp: {groundPlaneConfig.metersPerPixel.toFixed(4)} | nord: {groundPlaneConfig.northAngleDeg.toFixed(1)}°</div>
          <div>Emprise: {(groundPlaneConfig.image.widthPx * groundPlaneConfig.metersPerPixel).toFixed(1)}×{(groundPlaneConfig.image.heightPx * groundPlaneConfig.metersPerPixel).toFixed(1)} m</div>
          {groundZ != null && <div>Z sol: {groundZ.toFixed(2)} m</div>}
          <div style={{ opacity: 0.75, fontSize: 10 }}>
            Coins: <span style={{ color: "#00ff00" }}>TL(0,0)</span>{" "}
            <span style={{ color: "#ff4444" }}>TR</span>{" "}
            <span style={{ color: "#4488ff" }}>BL</span>{" "}
            <span style={{ color: "#ff8800" }}>BR</span>
          </div>
        </div>
      )}
    </div>
  );
}

function SolarScene3DViewer({
  scene: sceneProp,
  runtimeScene,
  className,
  height = 420,
  showRoof = true,
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
  cameraViewMode: cameraViewModeControlled,
  onCameraViewModeChange,
  defaultCameraViewMode,
  showCameraViewModeToggle: _showCameraViewModeToggle,
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
  pvLayout3DInteractionMode = false,
}: SolarScene3DViewerProps) {
  const baseScene = sceneProp ?? runtimeScene;
  if (baseScene == null) {
    throw new Error("[SolarScene3DViewer] Fournir `scene` ou `runtimeScene` (SolarScene3D).");
  }
  const scene = baseScene;

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
    (m: CameraViewMode) => {
      onCameraViewModeChange?.(m);
      if (cameraViewModeControlled === undefined) setInternalViewMode(m);
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

  const geometryBox = useMemo(() => computeSolarSceneBoundingBox(scene), [scene]);

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
  const zDragSessionRef = useRef<RoofZDragSession | null>(null);
  const zDragSessionImmediateRef = useRef<RoofZDragSession | null>(null);
  const zDragGestureActiveRef = useRef(false);
  const [pv3dDragSession, setPv3dDragSession] = useState<PvLayout3dDragSession | null>(null);
  const pv3dDragSessionRef = useRef<PvLayout3dDragSession | null>(null);
  useEffect(() => {
    pv3dDragSessionRef.current = pv3dDragSession;
  }, [pv3dDragSession]);
  const zDragLiveCommitRafRef = useRef<number | null>(null);
  const zDragLivePendingHeightRef = useRef<number | null>(null);
  const zEditUnarmedLoggedRef = useRef(false);
  const zDragCommitTargetRef = useRef<{ readonly panId: string; readonly vertexIndex: number } | null>(
    null,
  );
  const orbitControlsRef = useRef<OrbitControlsImpl | null>(null);
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
        const rt =
          debugRuntime ??
          (typeof window !== "undefined"
            ? (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE
            : null);
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
      zDragSessionRef.current = null;
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
      zDragSessionRef.current = session;
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

  useEffect(() => {
    zDragSessionRef.current = roofZDragSession;
  }, [roofZDragSession]);

  useEffect(() => {
    if (zDragGestureActiveRef.current) return;
    if (zDragLiveCommitRafRef.current != null) {
      cancelAnimationFrame(zDragLiveCommitRafRef.current);
      zDragLiveCommitRafRef.current = null;
    }
    zDragLivePendingHeightRef.current = null;
    setRoofZDragSession(null);
    setRoofZDragPreviewM(null);
    zDragSessionRef.current = null;
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
      const rt =
        debugRuntime ??
        (typeof window !== "undefined"
          ? (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE
          : null);
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
    [debugRuntime, scene.worldConfig],
  );

  const calpinageRuntimeForPv = useMemo(
    () =>
      debugRuntime ??
      (typeof window !== "undefined" ? (window as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE : null),
    [debugRuntime],
  );

  const pvRoofPlacementEnabled = useMemo(() => {
    const probe =
      typeof window !== "undefined" &&
      (window as unknown as { __CALPINAGE_3D_PV_PLACE_PROBE__?: boolean }).__CALPINAGE_3D_PV_PLACE_PROBE__ === true;
    const rt = calpinageRuntimeForPv;
    const phaseOk =
      rt != null && typeof rt === "object" && (rt as { currentPhase?: string }).currentPhase === "PV_LAYOUT";
    return (probe || pvLayout3DInteractionMode) && phaseOk;
  }, [calpinageRuntimeForPv, pvLayout3DInteractionMode]);

  const [pv3dOverlayEpoch, setPv3dOverlayEpoch] = useState(0);
  const pv3dOverlayRefreshTimerRef = useRef<number | null>(null);
  const refreshPv3dOverlay = useCallback(() => {
    setPv3dOverlayEpoch((n) => n + 1);
  }, []);
  const refreshPv3dOverlayThrottled = useCallback(() => {
    if (pv3dOverlayRefreshTimerRef.current != null) return;
    pv3dOverlayRefreshTimerRef.current = window.setTimeout(() => {
      pv3dOverlayRefreshTimerRef.current = null;
      refreshPv3dOverlay();
    }, 16);
  }, [refreshPv3dOverlay]);

  useEffect(() => {
    return () => {
      if (pv3dOverlayRefreshTimerRef.current != null) {
        window.clearTimeout(pv3dOverlayRefreshTimerRef.current);
        pv3dOverlayRefreshTimerRef.current = null;
      }
    };
  }, []);

  useEffect(() => {
    if (!pvLayout3DInteractionMode) return;
    const onOverlayChange = () => refreshPv3dOverlay();
    window.addEventListener("calpinage:pv3d-overlay-changed", onOverlayChange);
    window.addEventListener("calpinage:ph3-handles-changed", onOverlayChange);
    return () => {
      window.removeEventListener("calpinage:pv3d-overlay-changed", onOverlayChange);
      window.removeEventListener("calpinage:ph3-handles-changed", onOverlayChange);
    };
  }, [pvLayout3DInteractionMode, refreshPv3dOverlay]);

  const pvLayout3dOverlayState = useMemo(
    () => (pvLayout3DInteractionMode ? readPvLayout3dOverlayState() : null),
    [pvLayout3DInteractionMode, pv3dOverlayEpoch, scene],
  );
  const [pvLayout3dScreenOverlay, setPvLayout3dScreenOverlay] = useState<PvLayout3dScreenOverlayState | null>(null);

  const onPv3dLiveOffsetImg = useCallback((dxImg: number, dyImg: number, rotationDeg = 0) => {
    if (pv3dDragSessionRef.current?.mode === "rotate") {
      applyPvTransformLiveFrom3d(0, 0, rotationDeg);
    } else {
      applyPvMoveLiveFrom3d(dxImg, dyImg);
    }
    refreshPv3dOverlayThrottled();
  }, [refreshPv3dOverlayThrottled]);

  const endPv3dDragSession = useCallback(() => {
    const s = pv3dDragSessionRef.current;
    finalizePvMoveFrom3d({ pointerId: s?.pointerId ?? null, releaseCaptureEl: null });
    setPv3dDragSession(null);
    setOrbitSuppressed(false);
    refreshPv3dOverlay();
  }, [refreshPv3dOverlay]);

  const onPvPanelPvLayout3dPointerDown = useCallback(
    (e: ThreeEvent<PointerEvent>, panelIdFromMesh: string) => {
      if (!pvLayout3DInteractionMode) return;
      if (e.button !== 0) return;
      e.stopPropagation();
      const wc = scene.worldConfig;
      if (!wc) return;
      const rt =
        debugRuntime ??
        (typeof window !== "undefined"
          ? (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE
          : null);
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
        pv3dDragSessionRef.current == null;
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
    [pvLayout3DInteractionMode, scene.worldConfig, debugRuntime, pvLayout3dOverlayState, refreshPv3dOverlay],
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
        pv3dDragSessionRef.current == null;
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
        setPv3dDragSession({ blockId, pointerId: ptr, startImg: { x: img.x, y: img.y }, mode: "rotate", centerImg: r.centerImg });
      } else {
        const r = beginPvMoveFrom3d(blockId, img, ptr);
        if (!r.ok) {
          if (import.meta.env.DEV) console.warn("[CALPINAGE][PV_3D_MOVE]", r);
          return;
        }
        setPv3dDragSession({ blockId, pointerId: ptr, startImg: { x: img.x, y: img.y }, mode: "move" });
      }
      setOrbitSuppressed(true);
      e.stopPropagation();
    },
    [pvLayout3DInteractionMode, scene.worldConfig],
  );

  const onPvMoveHandlePointerDown = useCallback(
    (e: ReactPointerEvent<Element>, h: PvLayout3dHandleUi) => beginPv3dHandleDrag(e, "move", h),
    [beginPv3dHandleDrag],
  );

  const onPvRotateHandlePointerDown = useCallback(
    (e: ReactPointerEvent<Element>, h: PvLayout3dHandleUi) => beginPv3dHandleDrag(e, "rotate", h),
    [beginPv3dHandleDrag],
  );

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
    ],
  );

  const structuralRidgeHeightEditPanel = useMemo((): StructuralRidgeHeightEditUiModel | null => {
    if (!enableStructuralRidgeHeightEdit || !onStructuralRidgeHeightCommit || structuralHeightSelection == null) {
      return null;
    }
    const rt =
      debugRuntime ??
      (typeof window !== "undefined"
        ? (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE
        : null);
    const refH = readCalpinageStructuralHeightM(rt, structuralHeightSelection) ?? 7;
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
      pv3dDragSession == null
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
      if (pv3dDragSessionRef.current) {
        e.preventDefault();
        cancelPvMoveFrom3d();
        setPv3dDragSession(null);
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
    pv3dDragSession,
    refreshPv3dOverlay,
  ]);

  const legendMode = useMemo(() => {
    if (!showShadingLegend || !showPanelShading) return null;
    return sceneHasAnyPanelVisualShadingData(scene) ? ("active" as const) : ("unavailable" as const);
  }, [showPanelShading, showShadingLegend, scene]);

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

  const tooltipText = panelHover ? formatPanelTooltip(panelHover.panelId, scene) : null;
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

  const sceneStableKey = `${scene.metadata.schemaVersion}|${scene.metadata.createdAtIso}|${scene.metadata.integrationNotes ?? ""}`;

  const pvLayout3dA11yDescId = useId();

  return (
    <div
      className={className}
      style={{
        width: "100%",
        height,
        minHeight: 200,
        borderRadius: 8,
        overflow: "hidden",
        position: "relative",
      }}
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
    >
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
        />
      )}
      {legendMode != null && <ShadingLegend3D mode={legendMode} summary={scene.panelVisualShadingSummary} />}
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
      {(inspectMode ||
        panSelection3DMode ||
        (enableStructuralRidgeHeightEdit && structuralHeightSelection != null)) && (
        <SceneInspectionPanel3D
          model={inspectMode ? inspectionModel : null}
          pickProvenance2D={pickProvenance2DModel}
          showInspectionEmptyPlaceholder={inspectMode}
          showPanSelectionEmptyPlaceholder={panSelection3DMode && !inspectMode}
          roofShellAlignmentLine={roofShellAlignmentLine}
          roofVertexHeightEdit={roofVertexHeightEdit}
          roofVertexXYEdit={roofVertexXYEdit}
          structuralRidgeHeightEdit={structuralRidgeHeightEditPanel}
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
      {tooltipText != null && panelHover != null && (
        <div
          role="tooltip"
          style={{
            position: "fixed",
            left: panelHover.clientX + 14,
            top: panelHover.clientY + 14,
            zIndex: 10000,
            pointerEvents: "none",
            padding: "8px 10px",
            borderRadius: 6,
            background: "rgba(15,18,24,0.92)",
            border: "1px solid rgba(255,255,255,0.1)",
            color: "rgba(248,250,252,0.95)",
            fontSize: 12,
            lineHeight: 1.4,
            maxWidth: 260,
            boxShadow: "0 8px 24px rgba(0,0,0,0.35)",
            fontFamily: "system-ui, sans-serif",
          }}
        >
          {tooltipText.split("\n").map((line, i) => (
            <div key={i}>{line}</div>
          ))}
        </div>
      )}
      <Canvas
        key={cameraViewMode}
        orthographic={cameraViewMode === "PLAN_2D"}
        shadows
        dpr={[1, 2]}
        gl={{ antialias: true, powerPreference: "high-performance" }}
        camera={
          cameraViewMode === "PLAN_2D"
            ? {
                position: [0, 0, 50],
                near: 0.05,
                far: 1e6,
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
                far: 1e6,
                up: [0, 0, 1],
              }
        }
        onCreated={({ gl }) => {
          applyCanonicalViewerGlOutput(gl);
          // Fix R3F canvas sizing : quand le container était display:none au montage,
          // le ResizeObserver reçoit 0×0 et le canvas reste à 300×150 (défaut navigateur).
          // Un requestAnimationFrame laisse le browser calculer le layout (reflow) avant
          // que R3F mesure les dimensions réelles du container via son ResizeObserver.
          requestAnimationFrame(() => {
            window.dispatchEvent(new Event("resize"));
          });
        }}
        onPointerMissed={() => {
          if (zDragGestureActiveRef.current) return;
          if (pvLayout3DInteractionMode && pv3dDragSessionRef.current == null) {
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
        <GlCursorBinder cursor={glCursor} />
        <LineRaycastThreshold maxDim={maxDim} enabled={enableStructuralRidgeHeightEdit} />
        <PvLayout3dScreenOverlayProjector
          scene={scene}
          overlay={pvLayout3dOverlayState}
          enabled={pvLayout3DInteractionMode}
          onProjected={setPvLayout3dScreenOverlay}
        />
        <CameraFramingRig
          box={framingBox}
          mode={cameraViewMode}
          framingMargin={premiumAssembly.framingMargin}
          orbitEnabled={!orbitSuppressed}
          orbitControlsInstanceRef={orbitControlsRef}
        />
        <ViewerSceneContent
          key={scene.metadata.createdAtIso}
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
          debugRuntime={debugRuntime}
          satelliteTexture={satelliteTexture}
          satelliteUvMapper={satelliteUvMapper}
        />
        {pvLayout3DInteractionMode && scene.worldConfig && pv3dDragSession ? (
          <PvLayout3dDragController
            session={pv3dDragSession}
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
            position={[center.x, center.y, Math.min(geometryBox.min.z - 0.15, 0)]}
            {...viewerFallbackGridProps(maxDim)}
          />
        )}
        {showDebugOverlay && (
          <DebugSceneHelpers box={geometryBox} center={center} maxDim={maxDim} scene={scene} />
        )}
        {(showDebugOverlay || showXYAlignmentOverlay) && (
          <DebugXYAlignmentOverlay scene={scene} zLevel={groundZ} runtime={debugRuntime} />
        )}
      </Canvas>
      <PvLayout3dSvgOverlay
        overlay={pvLayout3DInteractionMode ? pvLayout3dScreenOverlay : null}
        onMovePointerDown={onPvMoveHandlePointerDown}
        onRotatePointerDown={onPvRotateHandlePointerDown}
      />
    </div>
  );
}

export { SolarScene3DViewer };
export default SolarScene3DViewer;
