/**
 * Aligne `pan.polygonPx` sur `pan.points` (x, y, et h / heightM si présents sur le sommet).
 * Sans effet si `points` est absent ou a moins de 3 sommets — ne supprime pas `polygonPx` dans ce cas.
 */

export function syncPolygonPxFromPoints(pan: Record<string, unknown>): void {
  const pts = pan.points;
  if (!Array.isArray(pts) || pts.length < 3) return;
  pan.polygonPx = pts.map((pt) => {
    if (!pt || typeof pt !== "object") {
      return { x: 0, y: 0 };
    }
    const p = pt as Record<string, unknown>;
    const x = typeof p.x === "number" ? p.x : 0;
    const y = typeof p.y === "number" ? p.y : 0;
    const o: Record<string, unknown> = { x, y };
    if (typeof p.h === "number" && Number.isFinite(p.h)) {
      o.h = p.h;
    }
    if (typeof p.heightM === "number" && Number.isFinite(p.heightM)) {
      o.heightM = p.heightM;
    }
    return o;
  });
}
