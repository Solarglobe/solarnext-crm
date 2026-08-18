import { useMemo, useEffect } from "react";
import * as THREE from "three";
import type { SolarScene3D } from "../types/solarScene3d";
import type { GroundPlaneImageData } from "./GroundPlaneTexture";

export function DebugSceneHelpers({
  box,
  center,
  maxDim,
}: {
  readonly box: THREE.Box3;
  readonly center: THREE.Vector3;
  readonly maxDim: number;
  readonly scene: SolarScene3D;
}) {
  const axisSize = Math.max(maxDim * 0.35, 3);
  const boxHelper = useMemo(() => new THREE.Box3Helper(box, new THREE.Color("#ff8800")), [box]);

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

export function DebugStatsOverlay({
  scene,
  box,
  groundPlaneConfig,
  groundZ,
  extensionVolDebugLevel = 0,
}: {
  readonly scene: SolarScene3D;
  readonly box: THREE.Box3;
  readonly groundPlaneConfig?: { metersPerPixel: number; northAngleDeg: number; image: GroundPlaneImageData } | null;
  readonly groundZ?: number;
  readonly extensionVolDebugLevel?: 0 | 1 | 2;
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
      {import.meta.env.DEV && (
        <div style={{ marginTop: 4, opacity: 0.85, fontSize: 10 }}>
          Ext debug (dev):{" "}
          {extensionVolDebugLevel === 0
            ? "off"
            : extensionVolDebugLevel === 1
              ? "fil de fer cyan"
              : "fil de fer + normales jaunes"}{" "}
          - <kbd style={{ opacity: 0.9 }}>Shift+Alt+E</kbd>
        </div>
      )}
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
      <div>BBox size: {s.x.toFixed(1)}x{s.y.toFixed(1)}x{s.z.toFixed(1)} m</div>
      <div>Z range: {zRange} m</div>
      <div style={{ marginTop: 2, opacity: 0.75 }}>
        Axes: <span style={{ color: "#ff4444" }}>X=Est</span>{" "}
        <span style={{ color: "#44ff44" }}>Y=Nord</span>{" "}
        <span style={{ color: "#4488ff" }}>Z=Haut</span>
      </div>
      {groundPlaneConfig && (
        <div style={{ marginTop: 4, borderTop: "1px solid rgba(255,180,0,0.2)", paddingTop: 4 }}>
          <div><strong>FOND PLAN</strong></div>
          <div>Image: {groundPlaneConfig.image.widthPx}x{groundPlaneConfig.image.heightPx} px</div>
          <div>mpp: {groundPlaneConfig.metersPerPixel.toFixed(4)} | nord: {groundPlaneConfig.northAngleDeg.toFixed(1)}°</div>
          <div>Emprise: {(groundPlaneConfig.image.widthPx * groundPlaneConfig.metersPerPixel).toFixed(1)}x{(groundPlaneConfig.image.heightPx * groundPlaneConfig.metersPerPixel).toFixed(1)} m</div>
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
