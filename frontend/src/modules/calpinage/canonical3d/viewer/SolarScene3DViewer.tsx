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
 * Mode `inspectMode` : sélection clic + panneau métadonnées — strictement lecture, pas d’édition.
 *
 * Prompt 34 — `cameraViewMode` : même `scene`, projection plan orthographique (dessus) ou perspective (orbite).
 */

import { Canvas, type ThreeEvent } from "@react-three/fiber";
import { Grid, Outlines } from "@react-three/drei";
import { useCallback, useEffect, useMemo, useState } from "react";
import * as THREE from "three";
import type { SolarScene3D } from "../types/solarScene3d";
import {
  computeSolarSceneBoundingBox,
  extendBoundingBoxWithSatelliteImageFootprint,
} from "./solarSceneBounds";
import { CameraFramingRig } from "./CameraFramingRig";
import { logIfGeometryNormalsSuspect } from "./geometryNormalsAudit";
import { ShadingLegend3D } from "./ShadingLegend3D";
import { SceneInspectionPanel3D } from "./SceneInspectionPanel3D";
import { buildSceneInspectionViewModel } from "./inspection/buildSceneInspectionViewModel";
import { INSPECT_USERDATA_KEY, type SceneInspectionSelection, type SceneInspectableKind } from "./inspection/sceneInspectionTypes";
import { pickInspectableIntersection } from "./inspection/pickInspectableIntersection";
import {
  GROUND_PLANE_CONTACT_OFFSET_M,
  VIEWER_AMBIENT_INTENSITY,
  VIEWER_CAMERA_FOV_DEG,
  VIEWER_FILL_LIGHT_INTENSITY,
  VIEWER_KEY_LIGHT_INTENSITY,
  VIEWER_SHADOW_BIAS,
  VIEWER_SHADOW_MAP_SIZE,
  VIEWER_SHADOW_NORMAL_BIAS,
} from "./viewerConstants";
import {
  extensionVolumeGeometry,
  obstacleVolumeGeometry,
  panelQuadGeometry,
  roofEdgesLineGeometry,
  roofPatchGeometry,
} from "./solarSceneThreeGeometry";
import { GroundPlaneTexture, type GroundPlaneImageData } from "./GroundPlaneTexture";
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

export interface SolarScene3DViewerProps {
  readonly scene: SolarScene3D;
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
   * Runtime CALPINAGE_STATE brut — utilisé UNIQUEMENT par le debug overlay XY
   * pour extraire les polygones 2D source et les comparer aux contours 3D.
   */
  readonly debugRuntime?: unknown;
  readonly cameraViewMode?: CameraViewMode;
  readonly onCameraViewModeChange?: (mode: CameraViewMode) => void;
  readonly defaultCameraViewMode?: CameraViewMode;
  readonly showCameraViewModeToggle?: boolean;
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
): { color: number; emissive: number; emissiveIntensity: number } {
  if (!showShading) {
    const c = blendPvSurfaceColor(premiumTintHexForQualityScore(null), 0.2);
    const em = new THREE.Color(c);
    return {
      color: c,
      emissive: em.getHex(),
      emissiveIntensity: 0.02 + (inspectSelected ? 0.06 : 0),
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
    emissiveIntensity: (eff.state === "AVAILABLE" ? 0.05 : 0.028) + (inspectSelected ? 0.07 : 0),
  };
}

function inspectData(kind: SceneInspectableKind, id: string): Record<string, unknown> {
  return { [INSPECT_USERDATA_KEY]: { kind, id: String(id) } };
}

function isInspectSelected(
  sel: SceneInspectionSelection | null,
  kind: SceneInspectableKind,
  id: string,
): boolean {
  return sel != null && sel.kind === kind && String(sel.id) === String(id);
}

/** Lumières : racine séparée du contenu géométrique. */
function CanonicalViewerLights({
  center,
  maxDim,
}: {
  readonly center: THREE.Vector3;
  readonly maxDim: number;
}) {
  const cx = center.x;
  const cy = center.y;
  const cz = center.z;
  const m = maxDim;

  return (
    <>
      <ambientLight intensity={VIEWER_AMBIENT_INTENSITY} />
      <directionalLight
        position={[cx + m * 1.65, cy + m * 1.35, cz + m * 2.15]}
        intensity={VIEWER_KEY_LIGHT_INTENSITY}
        castShadow
        shadow-mapSize={[VIEWER_SHADOW_MAP_SIZE, VIEWER_SHADOW_MAP_SIZE]}
        shadow-bias={VIEWER_SHADOW_BIAS}
        shadow-normalBias={VIEWER_SHADOW_NORMAL_BIAS}
      />
      <directionalLight position={[cx - m * 1.25, cy - m * 0.95, cz + m * 0.55]} intensity={VIEWER_FILL_LIGHT_INTENSITY} />
    </>
  );
}

type PanelHover = { readonly panelId: string; readonly clientX: number; readonly clientY: number } | null;

const OUTLINE_THICKNESS_FACTOR = 0.001;

/** Contenu géométrique + soleil — dispose explicite des BufferGeometry créées ici. */
function ViewerSceneContent({
  scene,
  box,
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
  inspectionSelection,
  onInspectClick,
  maxDim,
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
  >
> & {
  readonly box: THREE.Box3;
  sunDirectionIndex: number;
  readonly onPanelHover?: (h: PanelHover) => void;
  readonly inspectionSelection: SceneInspectionSelection | null;
  readonly onInspectClick: (e: ThreeEvent<MouseEvent>) => void;
  readonly maxDim: number;
}) {
  const center = useMemo(() => box.getCenter(new THREE.Vector3()).clone(), [box]);
  const maxDimLocal = useMemo(() => {
    const s = new THREE.Vector3();
    box.getSize(s);
    return Math.max(s.x, s.y, s.z, 1);
  }, [box]);

  const outlineThickness = Math.max(0.0008, maxDim * OUTLINE_THICKNESS_FACTOR);

  const roofGeos = useMemo(() => {
    return scene.roofModel.roofPlanePatches.map((p) => ({
      id: p.id,
      geo: roofPatchGeometry(p),
    }));
  }, [scene.roofModel.roofPlanePatches]);

  const edgeGeo = useMemo(() => roofEdgesLineGeometry(scene.roofModel), [scene.roofModel]);

  const obsGeos = useMemo(() => {
    return scene.obstacleVolumes.map((v) => ({ id: v.id, geo: obstacleVolumeGeometry(v) }));
  }, [scene.obstacleVolumes]);

  const extGeos = useMemo(() => {
    return scene.extensionVolumes.map((v) => ({ id: v.id, geo: extensionVolumeGeometry(v) }));
  }, [scene.extensionVolumes]);

  const panelGeos = useMemo(() => {
    return scene.pvPanels.map((p) => ({
      id: String(p.id),
      geo: panelQuadGeometry(p),
    }));
  }, [scene.pvPanels]);

  const allGeos = useMemo(
    () => [
      ...roofGeos.map((x) => x.geo),
      ...(edgeGeo ? [edgeGeo] : []),
      ...obsGeos.map((x) => x.geo),
      ...extGeos.map((x) => x.geo),
      ...panelGeos.map((x) => x.geo),
    ],
    [roofGeos, edgeGeo, obsGeos, extGeos, panelGeos],
  );

  const solidGeosForNormalsAudit = useMemo(
    () => [...roofGeos.map((x) => x.geo), ...obsGeos.map((x) => x.geo), ...extGeos.map((x) => x.geo), ...panelGeos.map((x) => x.geo)],
    [roofGeos, obsGeos, extGeos, panelGeos],
  );

  useEffect(() => {
    logIfGeometryNormalsSuspect(solidGeosForNormalsAudit, "viewer-meshes");
  }, [solidGeosForNormalsAudit]);

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

  return (
    <>
      <CanonicalViewerLights center={center} maxDim={maxDimLocal} />
      {showRoof &&
        roofGeos.map(({ id, geo }) => {
          const sid = String(id);
          const sel = isInspectSelected(inspectionSelection, "PAN", sid);
          return (
            <mesh
              key={`roof-${id}`}
              userData={inspectData("PAN", sid)}
              geometry={geo}
              castShadow
              receiveShadow
              position={[0, 0, 0]}
              onClick={inspectMode ? onInspectClick : undefined}
            >
              <meshStandardMaterial
                color="#5c6b7a"
                metalness={0.12}
                roughness={0.78}
                side={THREE.DoubleSide}
                emissive={sel ? "#3d5a80" : "#000000"}
                emissiveIntensity={sel ? 0.22 : 0}
              />
              {inspectMode && sel && (
                <Outlines thickness={outlineThickness} color="#d6c28a" opacity={0.95} toneMapped={false} />
              )}
            </mesh>
          );
        })}
      {showRoofEdges && edgeGeo && (
        <lineSegments geometry={edgeGeo}>
          <lineBasicMaterial color="#ffcc80" />
        </lineSegments>
      )}
      {showObstacles &&
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
              onClick={inspectMode ? onInspectClick : undefined}
            >
              <meshStandardMaterial
                color="#8d6e63"
                metalness={0.05}
                roughness={0.9}
                flatShading
                emissive={sel ? "#6d4c41" : "#000000"}
                emissiveIntensity={sel ? 0.35 : 0}
              />
              {inspectMode && sel && (
                <Outlines thickness={outlineThickness} color="#e8c4a0" opacity={0.95} toneMapped={false} />
              )}
            </mesh>
          );
        })}
      {showExtensions &&
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
              onClick={inspectMode ? onInspectClick : undefined}
            >
              <meshStandardMaterial
                color="#558b2f"
                metalness={0.05}
                roughness={0.85}
                flatShading
                emissive={sel ? "#33691e" : "#000000"}
                emissiveIntensity={sel ? 0.32 : 0}
              />
              {inspectMode && sel && (
                <Outlines thickness={outlineThickness} color="#c5e1a5" opacity={0.95} toneMapped={false} />
              )}
            </mesh>
          );
        })}
      {showPanels &&
        panelGeos.map(({ id, geo }) => {
          const mat = panelSurfaceMaterial(scene, id, showPanelShading, isInspectSelected(inspectionSelection, "PV_PANEL", id));
          return (
            <mesh
              key={`pv-${id}`}
              userData={inspectData("PV_PANEL", id)}
              geometry={geo}
              castShadow
              receiveShadow
              onClick={inspectMode ? onInspectClick : undefined}
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
                color={mat.color}
                emissive={mat.emissive}
                emissiveIntensity={mat.emissiveIntensity}
                metalness={0.22}
                roughness={0.48}
                side={THREE.DoubleSide}
              />
              {inspectMode && isInspectSelected(inspectionSelection, "PV_PANEL", id) && (
                <Outlines thickness={outlineThickness} color="#f0e6c8" opacity={0.9} toneMapped={false} />
              )}
            </mesh>
          );
        })}
      {showSun && <primitive object={arrowRef} />}
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
      <div>Pans: {patches} | Panels: {panels} | Obs: {obs} | Ext: {ext}</div>
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
  scene,
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
  showSun = true,
  sunDirectionIndex = 0,
  showDebugOverlay = false,
  showXYAlignmentOverlay = false,
  groundImage,
  debugRuntime,
  cameraViewMode: cameraViewModeControlled,
  onCameraViewModeChange,
  defaultCameraViewMode = DEFAULT_CAMERA_VIEW_MODE,
  showCameraViewModeToggle = false,
}: SolarScene3DViewerProps) {
  const [internalViewMode, setInternalViewMode] = useState<CameraViewMode>(defaultCameraViewMode);
  const cameraViewMode = cameraViewModeControlled ?? internalViewMode;
  const setCameraViewMode = useCallback(
    (m: CameraViewMode) => {
      onCameraViewModeChange?.(m);
      if (cameraViewModeControlled === undefined) setInternalViewMode(m);
    },
    [cameraViewModeControlled, onCameraViewModeChange],
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

  useEffect(() => {
    if (!inspectMode) setInspectionSelection(null);
  }, [inspectMode]);

  const onInspectClick = useCallback(
    (e: ThreeEvent<MouseEvent>) => {
      if (!inspectMode) return;
      e.stopPropagation();
      const picked = pickInspectableIntersection(e.intersections);
      if (picked) setInspectionSelection(picked);
    },
    [inspectMode],
  );

  const inspectionModel = useMemo(() => {
    if (!inspectMode || !inspectionSelection) return null;
    return buildSceneInspectionViewModel(scene, inspectionSelection);
  }, [inspectMode, inspectionSelection, scene]);

  const diagKey = useMemo(
    () =>
      `${scene.metadata.createdAtIso}|${scene.metadata.integrationNotes ?? ""}|${scene.pvPanels.map((p) => p.id).join(",")}`,
    [scene],
  );

  useEffect(() => {
    logVisualShadingDevDiagnosticsOnce(scene, diagKey);
  }, [scene, diagKey]);

  const legendMode = useMemo(() => {
    if (!showShadingLegend || !showPanelShading) return null;
    return sceneHasAnyPanelVisualShadingData(scene) ? ("active" as const) : ("unavailable" as const);
  }, [showPanelShading, showShadingLegend, scene]);

  const effectiveShowSun = showSun && cameraViewMode !== "PLAN_2D";

  const groundZ = useMemo(
    () => geometryBox.min.z - GROUND_PLANE_CONTACT_OFFSET_M,
    [geometryBox.min.z],
  );

  const tooltipText = panelHover ? formatPanelTooltip(panelHover.panelId, scene) : null;

  const sceneStableKey = `${scene.metadata.schemaVersion}|${scene.metadata.createdAtIso}|${scene.metadata.integrationNotes ?? ""}`;

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
      data-testid="solar-scene-3d-viewer-root"
      data-canonical-scene-key={sceneStableKey}
      data-camera-view-mode={cameraViewMode}
    >
      {showDebugOverlay && (
        <DebugStatsOverlay
          scene={scene}
          box={geometryBox}
          groundPlaneConfig={groundPlaneConfig}
          groundZ={groundZ}
        />
      )}
      {legendMode != null && <ShadingLegend3D mode={legendMode} />}
      {inspectMode && (
        <SceneInspectionPanel3D
          model={inspectionModel}
          onDismiss={() => setInspectionSelection(null)}
        />
      )}
      {showCameraViewModeToggle && (
        <div
          role="toolbar"
          aria-label="Mode d’affichage"
          style={{
            position: "absolute",
            top: 8,
            left: 8,
            zIndex: 5,
            display: "flex",
            gap: 6,
            background: "rgba(15,18,24,0.82)",
            borderRadius: 6,
            padding: 4,
            border: "1px solid rgba(255,255,255,0.12)",
          }}
        >
          <button
            type="button"
            data-testid="calpinage-viewer-mode-plan"
            aria-pressed={cameraViewMode === "PLAN_2D"}
            onClick={() => setCameraViewMode("PLAN_2D")}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
              background: cameraViewMode === "PLAN_2D" ? "rgba(59,130,246,0.35)" : "transparent",
              color: "rgba(248,250,252,0.95)",
            }}
          >
            Plan
          </button>
          <button
            type="button"
            data-testid="calpinage-viewer-mode-3d"
            aria-pressed={cameraViewMode === "SCENE_3D"}
            onClick={() => setCameraViewMode("SCENE_3D")}
            style={{
              fontSize: 12,
              padding: "6px 10px",
              borderRadius: 4,
              border: "none",
              cursor: "pointer",
              background: cameraViewMode === "SCENE_3D" ? "rgba(59,130,246,0.35)" : "transparent",
              color: "rgba(248,250,252,0.95)",
            }}
          >
            Vue 3D
          </button>
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
                position: [0, 0, 10],
                fov: VIEWER_CAMERA_FOV_DEG,
                near: 0.1,
                far: 1e6,
                up: [0, 0, 1],
              }
        }
        onCreated={({ gl }) => {
          gl.shadowMap.enabled = true;
          gl.shadowMap.type = THREE.PCFSoftShadowMap;
        }}
        onPointerMissed={() => {
          if (inspectMode) setInspectionSelection(null);
        }}
      >
        <color attach="background" args={["#12151c"]} />
        <CameraFramingRig box={framingBox} mode={cameraViewMode} />
        <ViewerSceneContent
          scene={scene}
          box={geometryBox}
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
          inspectionSelection={inspectionSelection}
          onInspectClick={onInspectClick}
          maxDim={maxDim}
        />
        {groundPlaneConfig ? (
          <GroundPlaneTexture
            config={groundPlaneConfig}
            zLevel={groundZ}
            debugMode={showDebugOverlay}
          />
        ) : (
          <Grid
            position={[center.x, center.y, Math.min(geometryBox.min.z - 0.15, 0)]}
            args={[maxDim * 4, maxDim * 4]}
            cellSize={maxDim * 0.05}
            cellThickness={0.6}
            sectionSize={maxDim * 0.25}
            sectionThickness={1}
            fadeDistance={maxDim * 10}
            infiniteGrid
            cellColor="#334155"
            sectionColor="#475569"
          />
        )}
        {showDebugOverlay && (
          <DebugSceneHelpers box={geometryBox} center={center} maxDim={maxDim} scene={scene} />
        )}
        {(showDebugOverlay || showXYAlignmentOverlay) && (
          <DebugXYAlignmentOverlay scene={scene} zLevel={groundZ} runtime={debugRuntime} />
        )}
      </Canvas>
    </div>
  );
}

export { SolarScene3DViewer };
