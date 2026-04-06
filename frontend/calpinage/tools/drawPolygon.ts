/**
 * Outil "Pans de toiture" : dessin et édition de polygones sur l'image calibrée.
 * Coordonnées uniquement en référentiel IMAGE.
 * Pas de logique panneau, pas de calcul solaire.
 */

import type { Pan, ActivePoint } from "../state/panState";
import { ensurePanPhysical } from "../state/panPhysical";

const MIN_POINTS = 3;
const SNAP_TOLERANCE_PX = 6;
const VERTEX_HIT_RADIUS_PX = 8;
/** Déplacement sous ce seuil (px) au relâchement = clic (sélection sommet), pas glissement. */
const CLICK_DRAG_THRESHOLD_PX = 4;

type PointImage = { x: number; y: number };

export type DrawPolygonConfig = {
  imgW: number;
  imgH: number;
  screenToImage: (screen: { x: number; y: number }) => PointImage;
  imageToScreen: (pt: PointImage) => { x: number; y: number };
  panState: { pans: Pan[]; activePanId: string | null; activePoint: ActivePoint };
  onRedraw: () => void;
  setCursor: (cursor: "crosshair" | "pointer" | "default") => void;
};

function distImage(a: PointImage, b: PointImage): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function hitPointImage(
  p: PointImage,
  mouseImage: PointImage,
  tolPx: number
): boolean {
  return distImage(p, mouseImage) <= tolPx;
}

function pointInPolygonImage(poly: PointImage[], pt: PointImage): boolean {
  let inside = false;
  const n = poly.length;
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    if (yj === yi) continue;
    const intersect =
      yi > pt.y !== yj > pt.y &&
      pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

/** Snap optionnel : retourne un point image (éventuellement snapé) ou null si hors tolérance. */
function snapToVertex(
  target: PointImage,
  allPans: Pan[],
  excludePanId: string | null,
  excludeIndex: number
): PointImage {
  let best: PointImage | null = null;
  let bestDist = SNAP_TOLERANCE_PX;
  for (const pan of allPans) {
    for (let i = 0; i < pan.points.length; i++) {
      if (pan.id === excludePanId && i === excludeIndex) continue;
      const d = distImage(target, pan.points[i]);
      if (d < bestDist) {
        bestDist = d;
        best = { x: pan.points[i].x, y: pan.points[i].y };
      }
    }
  }
  return best ?? target;
}

function generatePanId(): string {
  return "pan-" + Date.now() + "-" + Math.random().toString(36).slice(2, 9);
}

export type DrawPolygonTool = {
  onMouseDown: (screen: { x: number; y: number }) => void;
  onMouseMove: (screen: { x: number; y: number }) => void;
  onMouseUp: () => void;
  onDoubleClick: (screen: { x: number; y: number }) => void;
  render: (
    ctx: CanvasRenderingContext2D,
    imageToScreen: (pt: PointImage) => { x: number; y: number }
  ) => void;
  getCursor: () => "crosshair" | "pointer" | "default";
};

export function createDrawPolygonTool(config: DrawPolygonConfig): DrawPolygonTool {
  const {
    imgW,
    imgH,
    screenToImage,
    imageToScreen,
    panState,
    onRedraw,
    setCursor,
  } = config;

  let drawingPoints: PointImage[] | null = null;
  let addPointTimeoutId: ReturnType<typeof setTimeout> | null = null;

  let dragging:
    | { kind: "vertex"; panId: string; index: number }
    | null = null;
  let dragStartImage: PointImage | null = null;

  let hoverVertex: { panId: string; index: number } | null = null;
  let lastMouseImage: PointImage | null = null;

  function clampToImage(pt: PointImage): PointImage {
    return {
      x: Math.max(0, Math.min(imgW, pt.x)),
      y: Math.max(0, Math.min(imgH, pt.y)),
    };
  }

  function allVertices(): { pan: Pan; index: number; pt: PointImage }[] {
    const out: { pan: Pan; index: number; pt: PointImage }[] = [];
    for (const pan of panState.pans) {
      pan.points.forEach((pt, index) => out.push({ pan, index, pt }));
    }
    return out;
  }

  function hitVertex(mouseImage: PointImage): { panId: string; index: number } | null {
    for (const { pan, index, pt } of allVertices()) {
      if (hitPointImage(pt, mouseImage, VERTEX_HIT_RADIUS_PX)) {
        return { panId: pan.id, index };
      }
    }
    return null;
  }

  function hitPan(mouseImage: PointImage): Pan | null {
    for (let i = panState.pans.length - 1; i >= 0; i--) {
      const pan = panState.pans[i];
      if (pointInPolygonImage(pan.points, mouseImage)) return pan;
    }
    return null;
  }

  function commitDrawing() {
    if (!drawingPoints || drawingPoints.length < MIN_POINTS) return;
    const raw = drawingPoints.slice();
    drawingPoints = null;
    const points = raw.map((p) => ({ x: p.x, y: p.y, h: 0 }));
    const pan: Pan = {
      id: generatePanId(),
      points,
      azimuthDeg: null,
      tiltDeg: null,
    };
    ensurePanPhysical(pan);
    panState.pans.push(pan);
    panState.activePanId = pan.id;
    onRedraw();
  }

  function cancelAddPointTimeout() {
    if (addPointTimeoutId !== null) {
      clearTimeout(addPointTimeoutId);
      addPointTimeoutId = null;
    }
  }

  function getCursor(): "crosshair" | "pointer" | "default" {
    if (hoverVertex) return "pointer";
    if (drawingPoints !== null) return "crosshair";
    return "default";
  }

  return {
    onMouseDown(screen) {
      const mouseImage = clampToImage(screenToImage(screen));

      if (dragging) return;

      const vertex = hitVertex(mouseImage);
      if (vertex) {
        dragging = { kind: "vertex", panId: vertex.panId, index: vertex.index };
        const pan = panState.pans.find((p) => p.id === vertex.panId);
        if (pan) dragStartImage = { x: pan.points[vertex.index].x, y: pan.points[vertex.index].y };
        return;
      }

      if (drawingPoints !== null) {
        cancelAddPointTimeout();
        addPointTimeoutId = setTimeout(() => {
          addPointTimeoutId = null;
          drawingPoints!.push({ ...mouseImage });
          onRedraw();
        }, 200);
        return;
      }

      const hit = hitPan(mouseImage);
      if (hit) {
        panState.activePanId = hit.id;
        panState.activePoint = null;
        onRedraw();
        return;
      }

      panState.activePanId = null;
      panState.activePoint = null;
      onRedraw();
    },

    onMouseMove(screen) {
      const mouseImage = clampToImage(screenToImage(screen));
      lastMouseImage = mouseImage;

      if (dragging && dragStartImage) {
        const pan = panState.pans.find((p) => p.id === dragging!.panId);
        if (pan && dragging.kind === "vertex") {
          const snapped = snapToVertex(
            mouseImage,
            panState.pans,
            pan.id,
            dragging.index
          );
          pan.points[dragging.index].x = snapped.x;
          pan.points[dragging.index].y = snapped.y;
        }
        onRedraw();
        return;
      }

      if (drawingPoints !== null) {
        setCursor("crosshair");
        onRedraw();
        return;
      }

      const v = hitVertex(mouseImage);
      hoverVertex = v;
      setCursor(v ? "pointer" : "default");
      onRedraw();
    },

    onMouseUp() {
      if (dragging) {
        if (dragging.kind === "vertex" && dragStartImage) {
          const pan = panState.pans.find((p) => p.id === dragging!.panId);
          if (pan) {
            const pt = pan.points[dragging.index];
            const moved = distImage(dragStartImage, { x: pt.x, y: pt.y });
            if (moved < CLICK_DRAG_THRESHOLD_PX) {
              panState.activePanId = dragging.panId;
              panState.activePoint = { panId: dragging.panId, index: dragging.index };
            }
          }
        }
        dragging = null;
        dragStartImage = null;
        onRedraw();
      }
    },

    onDoubleClick(screen) {
      cancelAddPointTimeout();
      if (drawingPoints !== null) {
        if (drawingPoints.length >= MIN_POINTS) {
          commitDrawing();
        }
        drawingPoints = null;
        setCursor("default");
        onRedraw();
      }
    },

    render(ctx, imageToScreen) {
      const drawPolygonScreen = (
        points: PointImage[],
        fillStyle: string,
        strokeStyle: string,
        lineWidth: number
      ) => {
        if (points.length < 2) return;
        ctx.save();
        ctx.fillStyle = fillStyle;
        ctx.strokeStyle = strokeStyle;
        ctx.lineWidth = lineWidth;
        ctx.beginPath();
        const first = imageToScreen(points[0]);
        ctx.moveTo(first.x, first.y);
        for (let i = 1; i < points.length; i++) {
          const p = imageToScreen(points[i]);
          ctx.lineTo(p.x, p.y);
        }
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      };

      const drawVertex = (pt: PointImage, radius: number) => {
        const s = imageToScreen(pt);
        ctx.beginPath();
        ctx.arc(s.x, s.y, radius, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      };

      for (const pan of panState.pans) {
        const isActive = pan.id === panState.activePanId;
        drawPolygonScreen(
          pan.points,
          isActive ? "rgba(201, 164, 73, 0.25)" : "rgba(201, 164, 73, 0.15)",
          isActive ? "rgba(161, 124, 33, 0.9)" : "rgba(161, 124, 33, 0.6)",
          2
        );
        if (isActive) {
          ctx.save();
          const ap = panState.activePoint;
          const isActivePanPoint = ap && ap.panId === pan.id;
          for (let i = 0; i < pan.points.length; i++) {
            const pt = pan.points[i];
            const isSelected = isActivePanPoint && ap!.index === i;
            ctx.fillStyle = isSelected ? "#1a1a1a" : "#c9a449";
            ctx.strokeStyle = isSelected ? "#c9a449" : "#1a1a1a";
            ctx.lineWidth = isSelected ? 2 : 1.5;
            drawVertex(pt, isSelected ? 7 : 5);
          }
          ctx.restore();
        }
      }

      if (drawingPoints !== null && drawingPoints.length > 0) {
        drawPolygonScreen(
          drawingPoints,
          "rgba(201, 164, 73, 0.2)",
          "rgba(161, 124, 33, 0.8)",
          2
        );
        ctx.save();
        ctx.fillStyle = "#c9a449";
        ctx.strokeStyle = "#1a1a1a";
        ctx.lineWidth = 1.5;
        for (const pt of drawingPoints) {
          drawVertex(pt, 5);
        }
        ctx.restore();

        if (lastMouseImage && drawingPoints.length >= 1) {
          const last = drawingPoints[drawingPoints.length - 1];
          const cur = imageToScreen(last);
          const mouse = imageToScreen(lastMouseImage);
          ctx.save();
          ctx.strokeStyle = "rgba(161, 124, 33, 0.7)";
          ctx.setLineDash([4, 4]);
          ctx.lineWidth = 1.5;
          ctx.beginPath();
          ctx.moveTo(cur.x, cur.y);
          ctx.lineTo(mouse.x, mouse.y);
          ctx.stroke();
          ctx.restore();
        }
      }
    },

    getCursor,
  };
}
