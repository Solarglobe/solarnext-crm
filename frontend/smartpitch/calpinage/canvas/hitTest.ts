import { Vec2 } from "./canvasEngine";

export function dist(a: Vec2, b: Vec2): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

export function hitPoint(
  p: Vec2,
  mouseWorld: Vec2,
  tolMeters = 0.15
): boolean {
  return dist(p, mouseWorld) <= tolMeters;
}

export function hitPolygon(poly: Vec2[], mouseWorld: Vec2): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x,
      yi = poly[i].y;
    const xj = poly[j].x,
      yj = poly[j].y;
    if (yj === yi) continue;
    const intersect =
      yi > mouseWorld.y !== yj > mouseWorld.y &&
      mouseWorld.x < ((xj - xi) * (mouseWorld.y - yi)) / (yj - yi) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}
