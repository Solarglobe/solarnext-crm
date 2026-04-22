/**
 * Aligne `pan.points` sur `pan.polygonPx` (x, y, h / heightM si présents).
 * Sans effet si `polygonPx` est absent ou a moins de 3 sommets — n’efface pas `points` dans ce cas.
 */

export function syncPointsFromPolygonPx(pan: Record<string, unknown>): void {
  const px = pan.polygonPx;
  if (!Array.isArray(px) || px.length < 3) return;
  const panId = typeof pan.id === "string" ? pan.id : "pan";
  pan.points = px.map((pt, idx) => {
    if (!pt || typeof pt !== "object") {
      return { x: 0, y: 0, id: `${panId}-${idx}` };
    }
    const p = pt as Record<string, unknown>;
    const x = typeof p.x === "number" ? p.x : 0;
    const y = typeof p.y === "number" ? p.y : 0;
    const o: Record<string, unknown> = { x, y, id: typeof p.id === "string" && p.id.length > 0 ? p.id : `${panId}-${idx}` };
    if (typeof p.h === "number" && Number.isFinite(p.h)) {
      o.h = p.h;
    }
    if (typeof p.heightM === "number" && Number.isFinite(p.heightM)) {
      o.heightM = p.heightM;
    }
    return o;
  });
}
