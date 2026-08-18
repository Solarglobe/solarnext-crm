import { useFrame, useThree } from "@react-three/fiber";
import { useEffect, useRef, type PointerEvent as ReactPointerEvent } from "react";
import * as THREE from "three";
import type { PvLayout3dOverlayState } from "../../runtime/pvPlacement3dProduct";

export type PvLayout3dScreenPoint = { readonly x: number; readonly y: number };

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
  readonly labelPoint: PvLayout3dScreenPoint;
  readonly label: string;
};

type PvLayout3dProjectedSafeZone = {
  readonly id: string;
  readonly points: readonly PvLayout3dScreenPoint[];
  readonly labelPoint: PvLayout3dScreenPoint;
};

type PvLayout3dProjectedHandles = {
  readonly blockId: string;
  readonly rotate: PvLayout3dScreenPoint;
  readonly move: PvLayout3dScreenPoint;
  readonly topOfBlock: PvLayout3dScreenPoint;
  readonly rotateImg: { readonly x: number; readonly y: number };
  readonly moveImg: { readonly x: number; readonly y: number };
};

export type PvLayout3dScreenOverlayState = {
  readonly width: number;
  readonly height: number;
  readonly panels: readonly PvLayout3dProjectedPanel[];
  readonly ghosts: readonly PvLayout3dProjectedGhost[];
  readonly safeZones: readonly PvLayout3dProjectedSafeZone[];
  readonly handles: PvLayout3dProjectedHandles | null;
};

export type PvLayout3dHandleUi = PvLayout3dProjectedHandles;

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

function screenPolygonCentroid(points: readonly PvLayout3dScreenPoint[]): PvLayout3dScreenPoint {
  if (points.length === 0) return { x: 0, y: 0 };
  return {
    x: points.reduce((sum, p) => sum + p.x, 0) / points.length,
    y: points.reduce((sum, p) => sum + p.y, 0) / points.length,
  };
}

function pv3dGhostLabel(g: { readonly valid?: boolean; readonly excluded?: boolean; readonly source?: "expansion" | "autofill" }): string {
  if (g.excluded) return "Retire";
  if (g.valid === false) return "Refuse";
  return g.source === "autofill" ? "Auto" : "OK";
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
    .map((g) => `${g.id}:${g.valid ? 1 : 0}:${g.excluded ? 1 : 0}:${g.label}:${g.points.map((pt) => `${pt.x.toFixed(0)},${pt.y.toFixed(0)}`).join(";")}`)
    .join("|");
  const safeZones = o.safeZones
    .map((z) => `${z.id}:${z.points.map((pt) => `${pt.x.toFixed(0)},${pt.y.toFixed(0)}`).join(";")}`)
    .join("|");
  return `${o.width}x${o.height}|${h}|${panels}|${ghosts}|${safeZones}`;
}

export function PvLayout3dScreenOverlayProjector({
  overlay,
  enabled,
  projectImagePolygonToWorld,
  onProjected,
}: {
  readonly overlay: PvLayout3dOverlayState | null;
  readonly enabled: boolean;
  readonly projectImagePolygonToWorld: (
    points: readonly { readonly x: number; readonly y: number }[],
    panId: string | null | undefined,
    offsetM: number,
  ) => readonly THREE.Vector3[];
  readonly onProjected: (overlay: PvLayout3dScreenOverlayState | null) => void;
}) {
  const { camera, gl } = useThree();
  const lastSigRef = useRef("");
  const projectionAccRef = useRef(0);

  useEffect(() => {
    if (!enabled || !overlay) onProjected(null);
  }, [enabled, overlay, onProjected]);

  useFrame((_, delta) => {
    if (!enabled || !overlay) {
      if (lastSigRef.current !== "null") {
        lastSigRef.current = "null";
        onProjected(null);
      }
      return;
    }
    projectionAccRef.current += delta;
    if (projectionAccRef.current < 0.033) return;
    projectionAccRef.current = 0;
    const rect = gl.domElement.getBoundingClientRect();
    const width = Math.max(1, rect.width);
    const height = Math.max(1, rect.height);
    const projectImagePoly = (
      points: readonly { readonly x: number; readonly y: number }[],
      panId: string | null | undefined,
      offsetM: number,
    ): PvLayout3dScreenPoint[] => {
      const world = projectImagePolygonToWorld(points, panId, offsetM);
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
      .map((g) => {
        const points = projectImagePoly(g.points, g.panId, 0.26);
        return {
          id: g.id,
          valid: g.valid !== false,
          excluded: !!g.excluded,
          source: g.source,
          points,
          labelPoint: screenPolygonCentroid(points),
          label: pv3dGhostLabel(g),
        };
      })
      .filter((g) => g.points.length >= 3);
    const safeZones = overlay.safeZones.flatMap((z) =>
      z.polygons
        .map((poly, index) => {
          const points = projectImagePoly(poly, z.panId, 0.28);
          return {
            id: `${z.panId}-${index}`,
            points,
            labelPoint: screenPolygonCentroid(points),
          };
        })
        .filter((z2) => z2.points.length >= 3),
    );

    let handles: PvLayout3dProjectedHandles | null = null;
    if (overlay.handles) {
      const selectedPanId = overlay.panels.find((p) => p.selected)?.panId ?? null;
      const [rotateW, moveW, topW] = projectImagePolygonToWorld(
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

export function PvLayout3dSvgOverlay({
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
      role="img"
      aria-label="Aide visuelle pose photovoltaïque 3D"
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
