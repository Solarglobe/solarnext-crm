const EARTH_RADIUS_M = 6371008.8;
const EPSILON = 1e-9;

function finite(value, name) {
  const n = Number(value);
  if (!Number.isFinite(n)) throw new TypeError(`${name} must be finite`);
  return n;
}

function samePoint(a, b, tolerance = EPSILON) {
  return Math.abs(Number(a?.x) - Number(b?.x)) <= tolerance && Math.abs(Number(a?.y) - Number(b?.y)) <= tolerance;
}

function toPoint(point, index = 0) {
  return {
    x: finite(point?.x ?? point?.xM ?? point?.lng, `point[${index}].x`),
    y: finite(point?.y ?? point?.yM ?? point?.lat, `point[${index}].y`),
  };
}

function normalizePolygon(points, { requireClosed = true } = {}) {
  if (!Array.isArray(points) || points.length < 4) {
    return { ok: false, code: "POLYGON_TOO_FEW_POINTS", points: [], errors: ["polygon must contain at least 4 points including closure"] };
  }
  const normalized = points.map(toPoint);
  if (requireClosed && !samePoint(normalized[0], normalized[normalized.length - 1])) {
    return { ok: false, code: "POLYGON_NOT_CLOSED", points: normalized, errors: ["polygon must be closed"] };
  }
  const ring = samePoint(normalized[0], normalized[normalized.length - 1])
    ? normalized.slice(0, -1)
    : normalized;
  if (ring.length < 3) {
    return { ok: false, code: "POLYGON_TOO_FEW_POINTS", points: ring, errors: ["polygon must contain at least 3 distinct vertices"] };
  }
  return { ok: true, points: ring, errors: [] };
}

export function polygonArea(points) {
  const normalized = normalizePolygon(points, { requireClosed: false });
  if (!normalized.ok) return 0;
  let area2 = 0;
  for (let i = 0; i < normalized.points.length; i++) {
    const a = normalized.points[i];
    const b = normalized.points[(i + 1) % normalized.points.length];
    area2 += a.x * b.y - b.x * a.y;
  }
  return Math.abs(area2) / 2;
}

function orientation(a, b, c) {
  const value = (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
  if (Math.abs(value) <= EPSILON) return 0;
  return value > 0 ? 1 : 2;
}

function onSegment(a, b, c) {
  return b.x <= Math.max(a.x, c.x) + EPSILON &&
    b.x + EPSILON >= Math.min(a.x, c.x) &&
    b.y <= Math.max(a.y, c.y) + EPSILON &&
    b.y + EPSILON >= Math.min(a.y, c.y);
}

export function segmentsIntersect(a, b, c, d) {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);

  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a, c, b)) return true;
  if (o2 === 0 && onSegment(a, d, b)) return true;
  if (o3 === 0 && onSegment(c, a, d)) return true;
  return o4 === 0 && onSegment(c, b, d);
}

function hasSelfIntersection(points) {
  for (let i = 0; i < points.length; i++) {
    const a1 = points[i];
    const a2 = points[(i + 1) % points.length];
    for (let j = i + 1; j < points.length; j++) {
      if (Math.abs(i - j) <= 1) continue;
      if (i === 0 && j === points.length - 1) continue;
      const b1 = points[j];
      const b2 = points[(j + 1) % points.length];
      if (segmentsIntersect(a1, a2, b1, b2)) return true;
    }
  }
  return false;
}

export function validatePolygon(points, { minAreaM2 = 0, requireClosed = true } = {}) {
  const normalized = normalizePolygon(points, { requireClosed });
  if (!normalized.ok) return { ok: false, code: normalized.code, errors: normalized.errors, areaM2: 0 };

  if (hasSelfIntersection(normalized.points)) {
    return { ok: false, code: "POLYGON_SELF_INTERSECTION", errors: ["polygon edges must not self-intersect"], areaM2: 0 };
  }

  const areaM2 = polygonArea(normalized.points);
  if (areaM2 < minAreaM2) {
    return { ok: false, code: "POLYGON_AREA_TOO_SMALL", errors: [`polygon area ${areaM2} m2 is below ${minAreaM2} m2`], areaM2 };
  }

  return { ok: true, code: "OK", errors: [], areaM2 };
}

function localMetersFromLatLng(point, origin) {
  const lat = finite(point.lat, "point.lat");
  const lng = finite(point.lng, "point.lng");
  const originLat = finite(origin.lat, "origin.lat");
  const originLng = finite(origin.lng, "origin.lng");
  const meanLatRad = ((lat + originLat) / 2) * Math.PI / 180;
  return {
    x: (lng - originLng) * Math.PI / 180 * EARTH_RADIUS_M * Math.cos(meanLatRad),
    y: (lat - originLat) * Math.PI / 180 * EARTH_RADIUS_M,
  };
}

function latLngFromLocalMeters(point, origin) {
  const originLat = finite(origin.lat, "origin.lat");
  const originLng = finite(origin.lng, "origin.lng");
  const lat = originLat + (point.y / EARTH_RADIUS_M) * 180 / Math.PI;
  const meanLatRad = ((lat + originLat) / 2) * Math.PI / 180;
  const lng = originLng + (point.x / (EARTH_RADIUS_M * Math.cos(meanLatRad))) * 180 / Math.PI;
  return { lat, lng };
}

function readWorldPoint(point, calibration) {
  if (point?.lat != null && point?.lng != null) {
    return localMetersFromLatLng(point, calibration.originGps ?? calibration.originWorld ?? calibration);
  }
  return {
    x: finite(point?.x ?? point?.xM, "point.x"),
    y: finite(point?.y ?? point?.yM, "point.y"),
  };
}

function transformCalibration(calibration = {}) {
  const metersPerPixel = finite(calibration.metersPerPixel ?? calibration.mPerPx, "metersPerPixel");
  if (metersPerPixel <= 0) throw new RangeError("metersPerPixel must be positive");
  const originWorld = calibration.originWorld ?? { x: 0, y: 0 };
  const originImage = calibration.originImage ?? { x: 0, y: 0 };
  const angle = (Number(calibration.rotationDeg ?? 0) * Math.PI) / 180;
  return {
    metersPerPixel,
    originWorld: {
      x: Number(originWorld.x ?? originWorld.xM ?? 0),
      y: Number(originWorld.y ?? originWorld.yM ?? 0),
    },
    originImage: {
      x: Number(originImage.x ?? 0),
      y: Number(originImage.y ?? 0),
    },
    cos: Math.cos(angle),
    sin: Math.sin(angle),
    originGps: calibration.originGps,
  };
}

export function worldToImage(point, calibration = {}) {
  const c = transformCalibration(calibration);
  const world = readWorldPoint(point, calibration);
  const dx = world.x - c.originWorld.x;
  const dy = world.y - c.originWorld.y;
  const rotatedX = dx * c.cos - dy * c.sin;
  const rotatedY = dx * c.sin + dy * c.cos;
  return {
    x: c.originImage.x + rotatedX / c.metersPerPixel,
    y: c.originImage.y - rotatedY / c.metersPerPixel,
  };
}

export function imageToWorld(point, calibration = {}) {
  const c = transformCalibration(calibration);
  const ix = (finite(point?.x, "point.x") - c.originImage.x) * c.metersPerPixel;
  const iy = -(finite(point?.y, "point.y") - c.originImage.y) * c.metersPerPixel;
  const world = {
    x: c.originWorld.x + ix * c.cos + iy * c.sin,
    y: c.originWorld.y - ix * c.sin + iy * c.cos,
  };
  return c.originGps ? { ...world, ...latLngFromLocalMeters(world, c.originGps) } : world;
}

export function pointInPolygon(point, polygon) {
  const p = toPoint(point);
  const normalized = normalizePolygon(polygon, { requireClosed: false });
  if (!normalized.ok) return false;
  let inside = false;
  for (let i = 0, j = normalized.points.length - 1; i < normalized.points.length; j = i++) {
    const a = normalized.points[i];
    const b = normalized.points[j];
    if (segmentsIntersect(p, p, a, b)) return true;
    const intersectsRay = (a.y > p.y) !== (b.y > p.y) &&
      p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
    if (intersectsRay) inside = !inside;
  }
  return inside;
}

function polygonEdges(poly) {
  return poly.map((a, index) => [a, poly[(index + 1) % poly.length]]);
}

function polygonsOverlap(left, right) {
  for (const [a, b] of polygonEdges(left)) {
    for (const [c, d] of polygonEdges(right)) {
      if (segmentsIntersect(a, b, c, d)) return true;
    }
  }
  return left.some((point) => pointInPolygon(point, right)) || right.some((point) => pointInPolygon(point, left));
}

export function validatePanelPlacement(panelPolygon, { roofPolygon, obstacles = [] } = {}) {
  const panel = normalizePolygon(panelPolygon, { requireClosed: false });
  const roof = normalizePolygon(roofPolygon, { requireClosed: false });
  if (!panel.ok) return { ok: false, code: "PANEL_POLYGON_INVALID", errors: panel.errors };
  if (!roof.ok) return { ok: false, code: "ROOF_POLYGON_INVALID", errors: roof.errors };

  if (!panel.points.every((point) => pointInPolygon(point, roof.points))) {
    return { ok: false, code: "PANEL_OUTSIDE_ROOF", errors: ["panel must be fully inside the roof polygon"] };
  }
  for (const [a, b] of polygonEdges(panel.points)) {
    for (const [c, d] of polygonEdges(roof.points)) {
      if (segmentsIntersect(a, b, c, d) && !samePoint(a, c) && !samePoint(a, d) && !samePoint(b, c) && !samePoint(b, d)) {
        return { ok: false, code: "PANEL_OUTSIDE_ROOF", errors: ["panel edge must not cross the roof boundary"] };
      }
    }
  }

  for (const obstacle of obstacles) {
    const obstaclePolygon = normalizePolygon(obstacle.polygon ?? obstacle.polygonPx ?? obstacle.points, { requireClosed: false });
    if (obstaclePolygon.ok && polygonsOverlap(panel.points, obstaclePolygon.points)) {
      return { ok: false, code: "PANEL_ON_OBSTACLE", errors: ["panel must not overlap an obstacle"], obstacleId: obstacle.id ?? null };
    }
  }

  return { ok: true, code: "OK", errors: [] };
}
