/**
 * Obstacles de toiture (relevé 2D) — module dédié.
 * Formes : cercle, rectangle. Emprise au sol uniquement.
 * Prévoir extensibilité future (hauteur) sans l'implémenter.
 */

export type ObstacleType = "circle" | "rect";

export interface RoofObstacle {
  id: string;
  type: ObstacleType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
}

export interface ObstaclePreview {
  type: ObstacleType;
  x: number;
  y: number;
  w?: number;
  h?: number;
  r?: number;
}

export type ImageToScreen = (p: { x: number; y: number }) => { x: number; y: number };

const STROKE = "#374151";
const FILL = "rgba(156, 163, 175, 0.35)";
const PREVIEW_DASH = [6, 4];

function drawCircle(
  ctx: CanvasRenderingContext2D,
  imageToScreen: ImageToScreen,
  cx: number,
  cy: number,
  r: number,
  dashed: boolean,
  scale: number = 1
) {
  const s = imageToScreen({ x: cx, y: cy });
  const rScreen = Math.abs(r) * scale;
  ctx.beginPath();
  ctx.arc(s.x, s.y, rScreen, 0, Math.PI * 2);
  if (dashed) ctx.setLineDash(PREVIEW_DASH);
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (dashed) ctx.setLineDash([]);
  if (!dashed) {
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.stroke();
  }
}

function drawRect(
  ctx: CanvasRenderingContext2D,
  imageToScreen: ImageToScreen,
  x: number,
  y: number,
  w: number,
  h: number,
  dashed: boolean
) {
  const tl = imageToScreen({ x, y });
  const tr = imageToScreen({ x: x + w, y });
  const br = imageToScreen({ x: x + w, y: y + h });
  const bl = imageToScreen({ x, y: y + h });
  ctx.beginPath();
  ctx.moveTo(tl.x, tl.y);
  ctx.lineTo(tr.x, tr.y);
  ctx.lineTo(br.x, br.y);
  ctx.lineTo(bl.x, bl.y);
  ctx.closePath();
  if (dashed) ctx.setLineDash(PREVIEW_DASH);
  ctx.strokeStyle = STROKE;
  ctx.lineWidth = 2;
  ctx.stroke();
  if (dashed) ctx.setLineDash([]);
  if (!dashed) {
    ctx.fillStyle = FILL;
    ctx.fill();
    ctx.stroke();
  }
}

/**
 * Dessine les obstacles (après les pans, avant les panneaux).
 * Si preview est fourni, dessine en pointillé sans fill.
 * scale = facteur viewport pour rayon cercle (coords image → écran).
 */
export function drawObstacles(
  ctx: CanvasRenderingContext2D,
  obstacles: RoofObstacle[],
  imageToScreen: ImageToScreen,
  preview?: ObstaclePreview | null,
  scale: number = 1
): void {
  const list = obstacles || [];
  for (const o of list) {
    if (o.type === "circle" && typeof o.r === "number") {
      drawCircle(ctx, imageToScreen, o.x, o.y, o.r, false, scale);
    } else if (o.type === "rect" && typeof o.w === "number" && typeof o.h === "number") {
      drawRect(ctx, imageToScreen, o.x, o.y, o.w, o.h, false);
    }
  }
  if (preview) {
    if (preview.type === "circle" && typeof preview.r === "number") {
      drawCircle(ctx, imageToScreen, preview.x, preview.y, preview.r, true, scale);
    } else if (preview.type === "rect" && typeof preview.w === "number" && typeof preview.h === "number") {
      drawRect(ctx, imageToScreen, preview.x, preview.y, preview.w, preview.h, true);
    }
  }
}

/** Hit-test un obstacle en coordonnées écran (tolérance pour formes). scale = viewport pour cercle. */
function hitTestOne(
  screenPt: { x: number; y: number },
  obstacle: RoofObstacle,
  imageToScreen: ImageToScreen,
  tolPx: number,
  scale: number = 1
): boolean {
  if (obstacle.type === "circle" && typeof obstacle.r === "number") {
    const c = imageToScreen({ x: obstacle.x, y: obstacle.y });
    const rScreen = Math.abs(obstacle.r) * scale;
    return Math.hypot(screenPt.x - c.x, screenPt.y - c.y) <= rScreen + tolPx;
  }
  if (obstacle.type === "rect" && typeof obstacle.w === "number" && typeof obstacle.h === "number") {
    const poly = [
      { x: obstacle.x, y: obstacle.y },
      { x: obstacle.x + obstacle.w, y: obstacle.y },
      { x: obstacle.x + obstacle.w, y: obstacle.y + obstacle.h },
      { x: obstacle.x, y: obstacle.y + obstacle.h },
    ].map((p) => imageToScreen(p));
    return pointInPolygon(screenPt, poly) || pointNearPolygon(screenPt, poly, tolPx);
  }
  return false;
}

function _hitTestOneWithScale(
  screenPt: { x: number; y: number },
  obstacle: RoofObstacle,
  imageToScreen: ImageToScreen,
  tolPx: number,
  scale: number
): boolean {
  return hitTestOne(screenPt, obstacle, imageToScreen, tolPx, scale);
}

function pointInPolygon(pt: { x: number; y: number }, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    if (yi === yj) continue;
    if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

function pointNearPolygon(
  pt: { x: number; y: number },
  poly: { x: number; y: number }[],
  tol: number
): boolean {
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[j];
    const b = poly[i];
    const d = distToSegment(pt, a, b);
    if (d <= tol) return true;
  }
  return false;
}

function distToSegment(
  p: { x: number; y: number },
  a: { x: number; y: number },
  b: { x: number; y: number }
): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const len = Math.hypot(dx, dy);
  if (len === 0) return Math.hypot(p.x - a.x, p.y - a.y);
  let t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / (len * len);
  t = Math.max(0, Math.min(1, t));
  const q = { x: a.x + t * dx, y: a.y + t * dy };
  return Math.hypot(p.x - q.x, p.y - q.y);
}

const HIT_TOL_PX = 8;

/**
 * Retourne l'obstacle touché (ordre inverse pour priorité au dernier dessiné).
 * scale = facteur viewport pour hit-test cercle.
 */
export function hitTestObstacles(
  screenPt: { x: number; y: number },
  obstacles: RoofObstacle[],
  imageToScreen: ImageToScreen,
  tolPx: number = HIT_TOL_PX,
  scale: number = 1
): { index: number; obstacle: RoofObstacle } | null {
  const list = obstacles || [];
  for (let i = list.length - 1; i >= 0; i--) {
    if (hitTestOne(screenPt, list[i], imageToScreen, tolPx, scale)) {
      return { index: i, obstacle: list[i] };
    }
  }
  return null;
}
