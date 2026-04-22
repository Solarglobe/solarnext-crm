/**
 * Moteur de shading proche — module pur Node-compatible.
 * Aucune dépendance DOM/window/console. Testable en Node.
 */

var CIRCLE_SEGMENTS = 16;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Point-in-polygon (ray casting).
 * @param {{x: number, y: number}} pt
 * @param {Array<{x: number, y: number}>} polygon
 * @returns {boolean}
 */
function pointInPolygon(pt, polygon) {
  if (!pt || !polygon || polygon.length < 3) return false;
  var x = pt.x, y = pt.y;
  var n = polygon.length;
  var inside = false;
  for (var i = 0, j = n - 1; i < n; j = i++) {
    var xi = polygon[i].x, yi = polygon[i].y;
    var xj = polygon[j].x, yj = polygon[j].y;
    if (yi === yj) continue;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/**
 * Calcule le centroïde d'un polygone.
 */
function polygonCentroid(polygon) {
  if (!polygon || polygon.length < 3) return { x: 0, y: 0 };
  var sumX = 0, sumY = 0;
  for (var i = 0; i < polygon.length; i++) {
    sumX += polygon[i].x;
    sumY += polygon[i].y;
  }
  return { x: sumX / polygon.length, y: sumY / polygon.length };
}

function circleToPolygon(cx, cy, radius, n) {
  var pts = [];
  for (var i = 0; i < n; i++) {
    var a = (i / n) * Math.PI * 2;
    pts.push({ x: cx + radius * Math.cos(a), y: cy + radius * Math.sin(a) });
  }
  return pts;
}

/**
 * Vecteur direction 3D normalisé (azimuth 0°=Nord, 90°=Est).
 * @param {number} azimuthDeg
 * @param {number} elevationDeg
 * @returns {{dx: number, dy: number, dz: number}}
 */
function computeSunVector(azimuthDeg, elevationDeg) {
  var azRad = deg2rad(azimuthDeg);
  var elRad = deg2rad(elevationDeg);
  var dx = Math.sin(azRad) * Math.cos(elRad);
  var dy = Math.cos(azRad) * Math.cos(elRad);
  var dz = Math.sin(elRad);
  var len = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (len < 1e-12) return { dx: 0, dy: 0, dz: 1 };
  return { dx: dx / len, dy: dy / len, dz: dz / len };
}

/**
 * Génère un maillage 5x5 dans le polygone du panneau.
 */
function samplePanelPoints(panel) {
  if (!panel) return [];
  var polygon = panel.polygonPx || panel.polygon || panel.points || (panel.projection && panel.projection.points);
  if (!Array.isArray(polygon) || polygon.length < 3) return [];

  var minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
  for (var i = 0; i < polygon.length; i++) {
    var p = polygon[i];
    var px = typeof p.x === "number" ? p.x : 0;
    var py = typeof p.y === "number" ? p.y : 0;
    if (px < minX) minX = px;
    if (px > maxX) maxX = px;
    if (py < minY) minY = py;
    if (py > maxY) maxY = py;
  }
  if (minX >= maxX || minY >= maxY) return [];

  var gridN = 4;
  var candidates = [];
  for (var gx = 0; gx <= gridN; gx++) {
    for (var gy = 0; gy <= gridN; gy++) {
      var tx = gx / gridN;
      var ty = gy / gridN;
      candidates.push({
        x: minX + tx * (maxX - minX),
        y: minY + ty * (maxY - minY)
      });
    }
  }
  var out = [];
  for (var j = 0; j < candidates.length; j++) {
    if (pointInPolygon(candidates[j], polygon)) out.push(candidates[j]);
  }
  return out;
}

/**
 * Test si le point panneau est ombragé par l'obstacle (prisme vertical).
 * Z_LOCAL : zTopLocal = (baseZWorld + heightM) - zPlaneWorld => invariant au décalage Z global.
 */
function isPanelPointShadedByObstacle(params) {
  var panelPoint = params && params.panelPoint;
  var obstacle = params && params.obstacle;
  var sunDir = params && params.sunDir;
  var obstacleBaseZ = typeof params.obstacleBaseZ === "number" ? params.obstacleBaseZ : 0;
  var zPlaneWorld = typeof params.zPlaneWorld === "number" ? params.zPlaneWorld : 0;
  var useZLocal = params && params.useZLocal === true;

  if (!panelPoint || !obstacle || !sunDir) return false;
  var poly = obstacle.polygonPx || obstacle.polygon;
  if (!poly || poly.length < 3) return false;
  if (sunDir.dz <= 0) return false;
  var h = typeof obstacle.heightM === "number" ? obstacle.heightM : 1;
  if (h <= 0) return false;

  var zTopWorld = obstacleBaseZ + h;
  var zTopLocal = useZLocal ? (zTopWorld - zPlaneWorld) : zTopWorld;
  if (zTopLocal <= 0) return false;
  var t = zTopLocal / sunDir.dz;
  if (t <= 0) return false;

  var ix = panelPoint.x + t * sunDir.dx;
  var iy = panelPoint.y + t * sunDir.dy;
  return pointInPolygon({ x: ix, y: iy }, poly);
}

/**
 * Calcule la fraction ombrée d'un panneau pour une direction solaire donnée.
 */
function computePanelShadedFraction(params) {
  var panel = params && params.panel;
  var obstacles = params && params.obstacles;
  var sunDir = params && params.sunDir;
  var getZWorldAtXY = params && params.getZWorldAtXY;
  var useZLocal = params && params.useZLocal !== false;

  if (!panel || !sunDir) return 0;
  if (sunDir.dz <= 0) return 0;

  var pts = samplePanelPoints(panel);
  if (pts.length === 0) return 0;

  if (!Array.isArray(obstacles) || obstacles.length === 0) return 0;

  var shaded = 0;
  for (var i = 0; i < pts.length; i++) {
    var panelPoint = pts[i];
    var zPlaneWorld = 0;
    if (useZLocal && getZWorldAtXY) {
      zPlaneWorld = getZWorldAtXY(panelPoint.x, panelPoint.y);
      if (typeof zPlaneWorld !== "number" || !Number.isFinite(zPlaneWorld)) zPlaneWorld = 0;
    }
    for (var k = 0; k < obstacles.length; k++) {
      var obs = obstacles[k];
      if (obs.heightM <= 0) continue;
      if (isPanelPointShadedByObstacle({
        panelPoint: panelPoint,
        obstacle: obs,
        sunDir: sunDir,
        obstacleBaseZ: (typeof obs.baseZ === "number" && Number.isFinite(obs.baseZ)) ? obs.baseZ : (typeof obs.baseZWorld === "number" ? obs.baseZWorld : 0),
        zPlaneWorld: zPlaneWorld,
        useZLocal: useZLocal,
      })) {
        shaded++;
        break;
      }
    }
  }
  return clamp01(shaded / pts.length);
}

/**
 * Normalise les obstacles pour le raycast (pur, sans computeObjectZ).
 */
function normalizeObstacles(obstacles, getZWorldAtXY) {
  if (!Array.isArray(obstacles)) return [];
  var out = [];
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    if (!o || typeof o !== "object") continue;
    var id = (o.id != null && String(o.id)) || "obs-" + i;
    var polygonPx = null;
    var heightM = 0;

    if (Array.isArray(o.polygonPx) && o.polygonPx.length >= 3) {
      polygonPx = o.polygonPx.map(function (p) {
        return { x: typeof p.x === "number" ? p.x : 0, y: typeof p.y === "number" ? p.y : 0 };
      });
    } else {
      var shape = (o.shape || (o.meta && o.meta.type) || o.type || (o.shapeMeta && o.shapeMeta.originalType) || "").toLowerCase();
      if (shape === "circle") {
        var m = o.shapeMeta || {};
        var cx = typeof m.centerX === "number" ? m.centerX : (typeof o.x === "number" ? o.x : 0);
        var cy = typeof m.centerY === "number" ? m.centerY : (typeof o.y === "number" ? o.y : 0);
        var r = typeof m.radius === "number" ? m.radius : (typeof o.r === "number" ? o.r : 0);
        if (r > 0) polygonPx = circleToPolygon(cx, cy, r, CIRCLE_SEGMENTS);
      } else {
        var pts = o.points || o.polygon || (o.contour && o.contour.points);
        if (Array.isArray(pts) && pts.length >= 3) {
          polygonPx = pts.map(function (p) {
            return { x: typeof p.x === "number" ? p.x : 0, y: typeof p.y === "number" ? p.y : 0 };
          });
        }
      }
    }

    if (!polygonPx || polygonPx.length < 3) continue;

    var h = o.height;
    if (h && typeof h === "object" && typeof h.heightM === "number" && h.heightM >= 0) {
      heightM = h.heightM;
    } else if (typeof o.heightM === "number" && o.heightM >= 0) {
      heightM = o.heightM;
    } else if (typeof o.heightRelM === "number" && o.heightRelM >= 0) {
      heightM = o.heightRelM;
    } else if (typeof o.height === "number" && o.height >= 0) {
      heightM = o.height;
    } else if (o.ridgeHeightRelM != null && typeof o.ridgeHeightRelM === "number" && o.ridgeHeightRelM >= 0) {
      heightM = o.ridgeHeightRelM;
    }
    if (heightM <= 0) heightM = 1;

    var center = polygonCentroid(polygonPx);
    var baseZWorld = (getZWorldAtXY && typeof getZWorldAtXY === "function")
      ? getZWorldAtXY(center.x, center.y)
      : 0;
    if (typeof baseZWorld !== "number" || !Number.isFinite(baseZWorld)) baseZWorld = 0;

    out.push({
      id: id,
      polygonPx: polygonPx,
      polygon: polygonPx,
      heightM: heightM,
      baseZ: baseZWorld,
      baseZWorld: baseZWorld,
    });
  }
  return out;
}

/**
 * API principale : calcule la perte d'ombrage proche.
 * @param {{
 *   panels: Array,
 *   obstacles: Array,
 *   sunVectors: Array<{dx:number,dy:number,dz:number}>,
 *   getZWorldAtXY?: function(x:number,y:number):number,
 *   useZLocal?: boolean,
 *   debug?: boolean
 * }} params
 * @returns {{totalLossPct: number, perPanel: Array, debugInfo?: object}}
 */
function computeNearShading(params) {
  var panels = params && params.panels;
  var obstacles = params && params.obstacles;
  var sunVectors = params && params.sunVectors;
  var getZWorldAtXY = params && params.getZWorldAtXY;
  var useZLocal = params && params.useZLocal !== false;
  var debug = params && params.debug === true;

  if (!Array.isArray(panels) || panels.length === 0) {
    return { totalLossPct: 0, perPanel: [] };
  }
  if (!Array.isArray(sunVectors) || sunVectors.length === 0) {
    return {
      totalLossPct: 0,
      perPanel: panels.map(function (p) {
        return { panelId: p.id, shadedFractionAvg: 0, lossPct: 0 };
      }),
    };
  }

  var normObstacles = normalizeObstacles(obstacles || [], getZWorldAtXY);

  var totalWeightedFraction = 0;
  var totalWeight = 0;
  var panelWeightedSum = new Array(panels.length);
  var panelWeightSum = new Array(panels.length);
  var panelShadedSamples = new Array(panels.length);
  for (var i = 0; i < panels.length; i++) {
    panelWeightedSum[i] = 0;
    panelWeightSum[i] = 0;
    panelShadedSamples[i] = 0;
  }

  for (var s = 0; s < sunVectors.length; s++) {
    var sunDir = sunVectors[s];
    var weight = (sunDir && typeof sunDir.dz === "number") ? Math.max(0, sunDir.dz) : 0;
    if (weight <= 0) continue;

    for (var p = 0; p < panels.length; p++) {
      var fraction = computePanelShadedFraction({
        panel: panels[p],
        obstacles: normObstacles,
        sunDir: sunDir,
        getZWorldAtXY: getZWorldAtXY,
        useZLocal: useZLocal,
      });
      totalWeightedFraction += fraction * weight;
      totalWeight += weight;
      panelWeightedSum[p] += fraction * weight;
      panelWeightSum[p] += weight;
      if (fraction > 0) panelShadedSamples[p]++;
    }
  }

  var lossNear = (totalWeight <= 0) ? 0 : clamp01(totalWeightedFraction / totalWeight);
  var totalLossPct = lossNear * 100;

  var perPanel = panels.map(function (pan, i) {
    var shadedFractionAvg = (panelWeightSum[i] <= 0) ? 0 : clamp01(panelWeightedSum[i] / panelWeightSum[i]);
    return {
      panelId: pan.id,
      shadedFractionAvg: shadedFractionAvg,
      lossPct: shadedFractionAvg * 100,
      shadedSamplesCount: panelShadedSamples[i],
    };
  });

  var result = { totalLossPct: totalLossPct, perPanel: perPanel };
  if (debug) {
    result.debugInfo = {
      totalWeight: totalWeight,
      totalWeightedFraction: totalWeightedFraction,
      obstacleCount: normObstacles.length,
      panelCount: panels.length,
      sunVectorCount: sunVectors.length,
    };
  }
  return result;
}

module.exports = {
  computeNearShading,
  computePanelShadedFraction,
  isPanelPointShadedByObstacle,
  samplePanelPoints,
  pointInPolygon,
  computeSunVector,
  normalizeObstacles,
  polygonCentroid,
  clamp01,
};
