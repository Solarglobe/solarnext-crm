/**
 * === SHADING SOURCE OF TRUTH — NEAR (proche) ===
 * Seule source métier éditable pour le raycast near / obstacles.
 * Toute évolution near doit partir d’ici, puis : npm run sync:calpinage-shading-from-shared
 * (near → public sans bannière ; voir docs/shading-governance.md).
 *
 * Module pur Node + navigateur (.cjs). Pas de React/DOM dans ce fichier.
 */

var CIRCLE_SEGMENTS = 16;

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

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
 * Échelle image → sol : 1 px horizontal = metersPerPixel mètres.
 * Le déplacement horizontal du rayon (t * dx, t * dy) est en mètres ; en polygonPx il faut diviser par mpp.
 * @param {number|undefined} mpp
 * @returns {number}
 */
function resolveMetersPerPixel(mpp) {
  if (typeof mpp === "number" && mpp > 0 && Number.isFinite(mpp)) return mpp;
  return 1;
}

/**
 * @param {Object} panel - panneau avec polygonPx/polygon/points
 * @param {number} [panelGridSize] - 2 = 3x3 (9 pts, parité backend), 4 = 5x5 (25 pts, défaut)
 */
function samplePanelPoints(panel, panelGridSize) {
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
  var gridN = (typeof panelGridSize === "number" && panelGridSize >= 1 && panelGridSize <= 10) ? panelGridSize : 4;
  var candidates = [];
  for (var gx = 0; gx <= gridN; gx++) {
    for (var gy = 0; gy <= gridN; gy++) {
      var tx = gx / gridN;
      var ty = gy / gridN;
      candidates.push({ x: minX + tx * (maxX - minX), y: minY + ty * (maxY - minY) });
    }
  }
  var out = [];
  for (var j = 0; j < candidates.length; j++) {
    if (pointInPolygon(candidates[j], polygon)) out.push(candidates[j]);
  }
  return out;
}

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
  var mpp = resolveMetersPerPixel(params && params.metersPerPixel);
  var ix = panelPoint.x + (t * sunDir.dx) / mpp;
  var iy = panelPoint.y + (t * sunDir.dy) / mpp;
  return pointInPolygon({ x: ix, y: iy }, poly);
}

/** Retourne { obstacleId, t, distance } pour le premier obstacle qui bloque, ou null. */
function getFirstBlockingObstacle(params) {
  var panelPoint = params && params.panelPoint;
  var obstacles = params && params.obstacles;
  var sunDir = params && params.sunDir;
  var getZWorldAtXY = params && params.getZWorldAtXY;
  var useZLocal = params && params.useZLocal !== false;
  if (!panelPoint || !obstacles || !sunDir || sunDir.dz <= 0) return null;
  var zPlaneWorld = 0;
  if (useZLocal && getZWorldAtXY) {
    zPlaneWorld = getZWorldAtXY(panelPoint.x, panelPoint.y);
    if (typeof zPlaneWorld !== "number" || !Number.isFinite(zPlaneWorld)) zPlaneWorld = 0;
  }
  for (var k = 0; k < obstacles.length; k++) {
    var obs = obstacles[k];
    if (obs.heightM <= 0) continue;
    var obstacleBaseZ = (typeof obs.baseZ === "number" && Number.isFinite(obs.baseZ)) ? obs.baseZ : (typeof obs.baseZWorld === "number" ? obs.baseZWorld : 0);
    var hit = isPanelPointShadedByObstacle({
      panelPoint: panelPoint,
      obstacle: obs,
      sunDir: sunDir,
      obstacleBaseZ: obstacleBaseZ,
      zPlaneWorld: zPlaneWorld,
      useZLocal: useZLocal,
      metersPerPixel: params && params.metersPerPixel,
    });
    if (hit) {
      var h = typeof obs.heightM === "number" ? obs.heightM : 1;
      var zTopWorld = obstacleBaseZ + h;
      var zTopLocal = useZLocal ? (zTopWorld - zPlaneWorld) : zTopWorld;
      var t = zTopLocal / sunDir.dz;
      return { obstacleId: obs.id != null ? String(obs.id) : "obs-" + k, t: t, distance: t };
    }
  }
  return null;
}

function computePanelShadedFraction(params) {
  var panel = params && params.panel;
  var obstacles = params && params.obstacles;
  var sunDir = params && params.sunDir;
  var getZWorldAtXY = params && params.getZWorldAtXY;
  var useZLocal = params && params.useZLocal !== false;
  var panelGridSize = (params && typeof params.panelGridSize === "number") ? params.panelGridSize : undefined;
  var metersPerPixel = params && params.metersPerPixel;
  if (!panel || !sunDir) return 0;
  if (sunDir.dz <= 0) return 0;
  var pts = samplePanelPoints(panel, panelGridSize);
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
        metersPerPixel: metersPerPixel,
      })) {
        shaded++;
        break;
      }
    }
  }
  return clamp01(shaded / pts.length);
}

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
    var baseZWorld = 0;
    if (typeof o.baseZ === "number" && Number.isFinite(o.baseZ)) {
      baseZWorld = o.baseZ;
    } else if (typeof o.baseZWorld === "number" && Number.isFinite(o.baseZWorld)) {
      baseZWorld = o.baseZWorld;
    } else if (getZWorldAtXY && typeof getZWorldAtXY === "function") {
      baseZWorld = getZWorldAtXY(center.x, center.y);
    }
    if (typeof baseZWorld !== "number" || !Number.isFinite(baseZWorld)) baseZWorld = 0;
    out.push({ id: id, polygonPx: polygonPx, polygon: polygonPx, heightM: heightM, baseZ: baseZWorld, baseZWorld: baseZWorld });
  }
  return out;
}

function computeNearShading(params) {
  var panels = params && params.panels;
  var obstacles = params && params.obstacles;
  var sunVectors = params && params.sunVectors;
  var getZWorldAtXY = params && params.getZWorldAtXY;
  var useZLocal = params && params.useZLocal !== false;
  var debug = params && params.debug === true;
  var panelGridSize = (params && typeof params.panelGridSize === "number") ? params.panelGridSize : undefined;
  if (!Array.isArray(panels) || panels.length === 0) {
    return { totalLossPct: 0, perPanel: [] };
  }
  if (!Array.isArray(sunVectors) || sunVectors.length === 0) {
    return { totalLossPct: 0, perPanel: panels.map(function (p) { return { panelId: p.id, shadedFractionAvg: 0, lossPct: 0 }; }) };
  }
  var normObstacles = normalizeObstacles(obstacles || [], getZWorldAtXY);
  var mppResolved = resolveMetersPerPixel(params && params.metersPerPixel);
  var nearAudit = (typeof window !== "undefined" && window.NEAR_AUDIT === 1);
  if (nearAudit) {
    var log = typeof console !== "undefined" && console.log ? console.log : function () {};
    log("[NEAR_AUDIT] obstacles:", normObstacles.length);
    for (var oi = 0; oi < normObstacles.length; oi++) {
      var o = normObstacles[oi];
      var c = polygonCentroid(o.polygonPx || o.polygon);
      log("  obstacle id=" + (o.id || oi) + " heightM=" + o.heightM + " centroid(cx=" + c.x.toFixed(1) + ",cy=" + c.y.toFixed(1) + ")");
    }
    log("[NEAR_AUDIT] panels:", panels.length);
    for (var pi = 0; pi < panels.length; pi++) {
      var pan = panels[pi];
      var poly = pan.polygonPx || pan.polygon || pan.points;
      var pc = poly && poly.length >= 3 ? polygonCentroid(poly) : { x: 0, y: 0 };
      log("  panel id=" + (pan.id != null ? pan.id : pi) + " centroid(cx=" + pc.x.toFixed(1) + ",cy=" + pc.y.toFixed(1) + ") polygonPx=" + (poly ? poly.length + " pts" : "n/a"));
    }
    var elevMin = 90, elevMax = -90;
    for (var si = 0; si < sunVectors.length; si++) {
      var dz = sunVectors[si] && sunVectors[si].dz;
      if (typeof dz === "number") {
        var elDeg = (Math.asin(Math.max(-1, Math.min(1, dz))) * 180 / Math.PI);
        if (elDeg < elevMin) elevMin = elDeg;
        if (elDeg > elevMax) elevMax = elDeg;
      }
    }
    log("[NEAR_AUDIT] sunVectors: count=" + sunVectors.length + " elevationDeg min=" + (elevMin === 90 ? "n/a" : elevMin.toFixed(1)) + " max=" + (elevMax === -90 ? "n/a" : elevMax.toFixed(1)));
    var indicesByDz = [];
    for (var vi = 0; vi < sunVectors.length; vi++) {
      var d = sunVectors[vi] && sunVectors[vi].dz;
      indicesByDz.push({ i: vi, dz: typeof d === "number" ? d : 0 });
    }
    indicesByDz.sort(function (a, b) { return a.dz - b.dz; });
    var worst10 = indicesByDz.slice(0, Math.min(10, indicesByDz.length));
    for (var wi = 0; wi < worst10.length; wi++) {
      var idx = worst10[wi].i;
      var sunDir = sunVectors[idx];
      if (!sunDir || sunDir.dz <= 0) continue;
      var panel0 = panels[0];
      if (!panel0) continue;
      var pts0 = samplePanelPoints(panel0, panelGridSize);
      var shadedCount = 0;
      var firstBlock = null;
      for (var ptIdx = 0; ptIdx < pts0.length; ptIdx++) {
        var fp = getFirstBlockingObstacle({
          panelPoint: pts0[ptIdx],
          obstacles: normObstacles,
          sunDir: sunDir,
          getZWorldAtXY: getZWorldAtXY,
          useZLocal: useZLocal,
          metersPerPixel: mppResolved,
        });
        if (fp) {
          shadedCount++;
          if (!firstBlock) firstBlock = fp;
        }
      }
      var elevDegWRad = Math.asin(Math.max(-1, Math.min(1, sunDir.dz)));
      var elevDegW = elevDegWRad * 180 / Math.PI;
      var firstBlockStr = firstBlock ? " firstBlock obstacleId=" + firstBlock.obstacleId + " t=" + firstBlock.t.toFixed(1) + " distance=" + firstBlock.distance.toFixed(1) : " (no hit)";
      log("[NEAR_AUDIT] sunVec[" + idx + "] elevation=" + elevDegW.toFixed(1) + " deg panel0 sampleCount=" + pts0.length + " shadedCount=" + shadedCount + firstBlockStr);
    }
  }
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
        panelGridSize: panelGridSize,
        metersPerPixel: mppResolved,
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

var exports = {
  computeNearShading,
  computePanelShadedFraction,
  isPanelPointShadedByObstacle,
  samplePanelPoints,
  pointInPolygon,
  computeSunVector,
  normalizeObstacles,
  polygonCentroid,
  clamp01,
  resolveMetersPerPixel,
};

if (typeof module !== "undefined" && module.exports) {
  module.exports = exports;
}
if (typeof window !== "undefined") {
  window.nearShadingCore = exports;
}
