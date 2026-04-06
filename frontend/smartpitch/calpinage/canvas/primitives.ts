import { Vec2 } from "./canvasEngine";
import { Viewport } from "./viewport";

export function drawPoint(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  p: Vec2,
  r = 4
) {
  const s = vp.worldToScreen(p);
  ctx.beginPath();
  ctx.arc(s.x, s.y, r, 0, Math.PI * 2);
  ctx.fill();
}

export function drawPolygon(
  ctx: CanvasRenderingContext2D,
  vp: Viewport,
  pts: Vec2[]
) {
  if (pts.length < 2) return;
  ctx.beginPath();
  const first = vp.worldToScreen(pts[0]);
  ctx.moveTo(first.x, first.y);
  for (let i = 1; i < pts.length; i++) {
    const p = vp.worldToScreen(pts[i]);
    ctx.lineTo(p.x, p.y);
  }
  ctx.closePath();
  ctx.stroke();
}
