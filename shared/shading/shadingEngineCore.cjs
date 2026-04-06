/**
 * === SHADING SOURCE OF TRUTH — ANNUAL / FAR + HORIZON (pondération annuelle) ===
 * Seule source métier éditable pour computeAnnualShadingLoss, getAnnualSunVectors, raycast 3×3 ici.
 * Artefact navigateur : frontend/calpinage/shading/shadingEngine.js = GÉNÉRÉ (ne pas éditer à la main).
 * Sync : npm run sync:calpinage-shading-from-shared — docs/shading-governance.md
 *
 * Near « officiel » étude reste nearShadingCore.cjs ; ce fichier ne remplace pas le near persisté backend.
 */

/** Lazy pour éviter TDZ. Browser: pas de require → window.__SHADING_SOLAR_POSITION__. Node: require("./solarPosition.cjs"). */
function getComputeSunPosition() {
  if (typeof require === "function" && typeof module !== "undefined") {
    var m = require("./solarPosition.cjs");
    return m && m.computeSunPosition;
  }
  var w = typeof window !== "undefined" && window.__SHADING_SOLAR_POSITION__;
  return w && (w.getSunPosition || w.computeSunPosition);
}
/** Browser: window.__SHADING_HORIZON_MASK_SAMPLER__. Node: require("./horizonMaskSampler.cjs"). */
var _horizonMaskSampler = (function () {
  if (typeof require === "function" && typeof module !== "undefined") {
    return require("./horizonMaskSampler.cjs");
  }
  return (typeof window !== "undefined" && window.__SHADING_HORIZON_MASK_SAMPLER__) || {};
})();
var isSunBlockedByHorizonMaskSafe = _horizonMaskSampler.isSunBlockedByHorizonMaskSafe || function () { return false; };
var logDebugSampler = _horizonMaskSampler.logDebugSampler || function () {};

var CIRCLE_SEGMENTS = 16;

function deg2rad(deg) {
  return (deg * Math.PI) / 180;
}

/**
 * Normalise les obstacles 2D en structure exploitable pour raycast.
 * @param {Array} obstacles - Obstacle2D[]
 * @returns {Array<{id: string, polygon: Array<{x:number,y:number}>, heightM: number}>}
 */
function normalizeObstacles(obstacles) {
  if (!Array.isArray(obstacles)) return [];
  var out = [];
  for (var i = 0; i < obstacles.length; i++) {
    var o = obstacles[i];
    if (!o || typeof o !== "object") continue;
    var id = (o.id != null && String(o.id)) || "obs-" + i;
    var shape = (o.shape || (o.meta && o.meta.type) || o.type || (o.shapeMeta && o.shapeMeta.originalType) || "").toLowerCase();
    var polygon = null;
    var heightM = 0;

    if (shape === "circle") {
      var m = o.shapeMeta || {};
      var cx = typeof m.centerX === "number" ? m.centerX : (typeof o.x === "number" ? o.x : 0);
      var cy = typeof m.centerY === "number" ? m.centerY : (typeof o.y === "number" ? o.y : 0);
      var r = typeof m.radius === "number" ? m.radius : (typeof o.r === "number" ? o.r : 0);
      if (r > 0) {
        polygon = circleToPolygon(cx, cy, r, CIRCLE_SEGMENTS);
      }
    } else if (shape === "rect" || shape === "polygon" || shape === "poly") {
      var pts = o.points || o.polygon || o.polygonPx;
      if (Array.isArray(pts) && pts.length >= 3) {
        polygon = pts.map(function (p) {
          return { x: typeof p.x === "number" ? p.x : 0, y: typeof p.y === "number" ? p.y : 0 };
        });
      }
    } else {
      var ptsFallback = o.points || o.polygon || o.polygonPx;
      if (Array.isArray(ptsFallback) && ptsFallback.length >= 3) {
        polygon = ptsFallback.map(function (p) {
          return { x: typeof p.x === "number" ? p.x : 0, y: typeof p.y === "number" ? p.y : 0 };
        });
      }
    }

    if (!polygon || polygon.length < 3) continue;

    var h = o.height;
    if (h && typeof h === "object" && typeof h.heightM === "number" && h.heightM >= 0) {
      heightM = h.heightM;
    } else if (typeof o.heightM === "number" && o.heightM >= 0) {
      heightM = o.heightM;
    }

    out.push({ id: id, polygon: polygon, heightM: heightM });
  }
  return out;
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
 * Vecteur direction 3D normalisé pour le raycast ombre.
 * x=Est, y=Nord, z=vertical. azimuth 0°=Nord, 90°=Est. elevation=angle au-dessus horizon.
 * @param {number} azimuthDeg
 * @param {number} elevationDeg
 * @returns {{dx: number, dy: number, dz: number}}
 */
function computeShadowRayDirection(azimuthDeg, elevationDeg) {
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

function clamp01(x) {
  return Math.max(0, Math.min(1, x));
}

/**
 * Génère un maillage 3x3 (9 points) dans le polygone du panneau.
 * @param {Object} panel - Panneau avec polygon/points/projection.points
 * @returns {Array<{x: number, y: number}>}
 */
function samplePanelPoints(panel) {
  if (!panel) return [];
  var polygon = panel.polygon || panel.polygonPx || panel.points || (panel.projection && panel.projection.points);
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

  var x0 = minX, x1 = (minX + maxX) / 2, x2 = maxX;
  var y0 = minY, y1 = (minY + maxY) / 2, y2 = maxY;
  var candidates = [
    { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x2, y: y0 },
    { x: x0, y: y1 }, { x: x1, y: y1 }, { x: x2, y: y1 },
    { x: x0, y: y2 }, { x: x1, y: y2 }, { x: x2, y: y2 },
  ];
  var out = [];
  for (var j = 0; j < candidates.length; j++) {
    if (pointInPolygon(candidates[j], polygon)) out.push(candidates[j]);
  }
  return out;
}

/**
 * Calcule la fraction ombrée d'un panneau pour une direction solaire donnée.
 * @param {{panel: Object, obstacles: Array, sunDir: {dx:number,dy:number,dz:number}}} params
 * @returns {number} Fraction entre 0 et 1
 */
function computePanelShadedFraction(params) {
  var panel = params && params.panel;
  var obstacles = params && params.obstacles;
  var sunDir = params && params.sunDir;
  var metersPerPixel = params && params.metersPerPixel;
  if (!panel || !sunDir) return 0;
  if (sunDir.dz <= 0) return 0;

  var pts = samplePanelPoints(panel);
  if (pts.length === 0) return 0;

  if (!Array.isArray(obstacles) || obstacles.length === 0) return 0;

  var shaded = 0;
  for (var i = 0; i < pts.length; i++) {
    var panelPoint = pts[i];
    for (var k = 0; k < obstacles.length; k++) {
      var obs = obstacles[k];
      if (obs.heightM <= 0) continue;
      if (isPanelPointShadedByObstacle({
        panelPoint: panelPoint,
        obstacle: obs,
        sunDir: sunDir,
        obstacleBaseZ: 0,
        metersPerPixel: metersPerPixel,
      })) {
        shaded++;
        break;
      }
    }
  }
  return clamp01(shaded / pts.length);
}

/**
 * Test si le point panneau est ombragé par l'obstacle (prisme vertical).
 * Toit = plan z=0. Obstacle = prisme vertical base polygon, hauteur heightM.
 * @param {{panelPoint: {x:number,y:number}, obstacle: {polygon:Array,heightM:number}, sunDir: {dx:number,dy:number,dz:number}, obstacleBaseZ: number}} params
 * @returns {boolean}
 */
function isPanelPointShadedByObstacle(params) {
  var panelPoint = params && params.panelPoint;
  var obstacle = params && params.obstacle;
  var sunDir = params && params.sunDir;
  var obstacleBaseZ = typeof params.obstacleBaseZ === "number" ? params.obstacleBaseZ : 0;

  if (!panelPoint || !obstacle || !sunDir) return false;
  if (!obstacle.polygon || obstacle.polygon.length < 3) return false;
  if (sunDir.dz <= 0) return false;
  if (obstacle.heightM <= 0) return false;

  var zTop = obstacleBaseZ + obstacle.heightM;
  var t = zTop / sunDir.dz;
  if (t <= 0) return false;

  var mpp = (params && typeof params.metersPerPixel === "number" && params.metersPerPixel > 0 && Number.isFinite(params.metersPerPixel))
    ? params.metersPerPixel
    : 1;
  var ix = panelPoint.x + (t * sunDir.dx) / mpp;
  var iy = panelPoint.y + (t * sunDir.dy) / mpp;
  return pointInPolygon({ x: ix, y: iy }, obstacle.polygon);
}

/**
 * Cache annuel des échantillons solaires (même clé = même lat/lon/year/step/seuil).
 * Évite de recalculer des milliers de positions pour chaque panneau / chaque appel.
 */
var _annualSolarSampleCache = typeof Map !== "undefined" ? new Map() : null;
var _annualSolarSampleCacheMax = 48;

/**
 * Grille temporelle annuelle en **UTC civil** (Date.UTC) : identique sur tout navigateur / serveur.
 * computeSunPosition interprète l’instant via getUTC* → position physique correcte pour ce timestamp.
 * (Évite la dépendance au fuseau du runtime pour la séquence des échantillons.)
 *
 * @param {{year?: number, stepMinutes?: number, minSunElevationDeg?: number}} opts
 * @param {number} latDeg
 * @param {number} lonDeg
 * @returns {{samples: Array<{date: Date, azimuthDeg: number, elevationDeg: number}>, totalCount: number}}
 */
function generateAnnualSamples(opts, latDeg, lonDeg) {
  var year = (opts && typeof opts.year === "number") ? opts.year : 2026;
  var stepMinutes = (opts && typeof opts.stepMinutes === "number" && opts.stepMinutes > 0)
    ? opts.stepMinutes : 30;
  var minSunElevationDeg = (opts && typeof opts.minSunElevationDeg === "number")
    ? Math.max(0, opts.minSunElevationDeg) : 5;

  var cacheKey =
    year + "|" + stepMinutes + "|" + minSunElevationDeg + "|" +
    (typeof latDeg === "number" ? latDeg.toFixed(5) : "") + "|" +
    (typeof lonDeg === "number" ? lonDeg.toFixed(5) : "");
  if (_annualSolarSampleCache && _annualSolarSampleCache.has(cacheKey)) {
    return _annualSolarSampleCache.get(cacheKey);
  }

  var samples = [];
  var startMs = Date.UTC(year, 0, 1, 0, 0, 0, 0);
  var endMs = Date.UTC(year, 11, 31, 23, 59, 0, 0);
  var stepMs = stepMinutes * 60 * 1000;

  var computeSunPosition = getComputeSunPosition();
  if (!computeSunPosition) return { samples: [], totalCount: 0 };
  for (var t = startMs; t <= endMs; t += stepMs) {
    var date = new Date(t);
    var sunPos = computeSunPosition(date, latDeg, lonDeg);
    if (!sunPos) continue;
    if (sunPos.elevationDeg < minSunElevationDeg) continue;
    samples.push({
      date: date,
      azimuthDeg: sunPos.azimuthDeg,
      elevationDeg: sunPos.elevationDeg,
    });
  }

  var out = { samples: samples, totalCount: samples.length };
  if (_annualSolarSampleCache) {
    if (_annualSolarSampleCache.size >= _annualSolarSampleCacheMax) {
      var firstK = _annualSolarSampleCache.keys().next().value;
      _annualSolarSampleCache.delete(firstK);
    }
    _annualSolarSampleCache.set(cacheKey, out);
  }
  return out;
}

/**
 * Retourne les vecteurs solaires annuels pour lat/lon/config (pour nearShadingCore).
 * @param {number} latDeg
 * @param {number} lonDeg
 * @param {{ year?: number, stepMinutes?: number, minSunElevationDeg?: number }} config
 * @returns {Array<{ dx: number, dy: number, dz: number }>}
 */
function getAnnualSunVectors(latDeg, lonDeg, config) {
  var year = (config && typeof config.year === "number") ? config.year : 2026;
  var stepMinutes = (config && typeof config.stepMinutes === "number") ? config.stepMinutes : 30;
  var minSunElevationDeg = (config && typeof config.minSunElevationDeg === "number")
    ? Math.max(0, config.minSunElevationDeg) : 5;
  var effectiveMin = Math.max(minSunElevationDeg, 3);
  var result = generateAnnualSamples(
    { year: year, stepMinutes: stepMinutes, minSunElevationDeg: effectiveMin },
    latDeg,
    lonDeg
  );
  if (!result.samples || result.samples.length === 0) return [];
  var out = [];
  for (var i = 0; i < result.samples.length; i++) {
    var s = result.samples[i];
    out.push(computeShadowRayDirection(s.azimuthDeg, s.elevationDeg));
  }
  return out;
}

/**
 * API principale : calcule la perte annuelle d'ombrage (near shading uniquement).
 * P5/7 : raycast panneau + fraction ombrée, annualLossPercent calculé.
 * @param {{latDeg?: number, lonDeg?: number, roofPans?: Array, panels?: Array, obstacles?: Array, config?: object, [key: string]: any}} params
 * @returns {ShadingLossResult|null} Résultat ou null si lat/lon invalides
 */
function computeAnnualShadingLoss(params) {
  var latDeg = params && params.latDeg;
  var lonDeg = params && params.lonDeg;
  if (typeof latDeg !== "number" || typeof lonDeg !== "number") return null;
  if (latDeg < -90 || latDeg > 90 || lonDeg < -180 || lonDeg > 180) return null;

  var metersPerPixel =
    params && typeof params.metersPerPixel === "number" && params.metersPerPixel > 0 && Number.isFinite(params.metersPerPixel)
      ? params.metersPerPixel
      : 1;

  var config = params && params.config;
  var year = (config && typeof config.year === "number") ? config.year : 2026;
  var stepMinutes = (config && typeof config.stepMinutes === "number") ? config.stepMinutes : 30;

  var roofPans = params && params.roofPans;
  var panels = params && params.panels;
  var obstacles = params && params.obstacles;
  var totalSolarSamples = 0;

  if (!Array.isArray(panels) || panels.length === 0) {
    return {
      annualLossPercent: Number(0),
      /** Non calculé en V1 : pas de production kWh de référence dans ce pipeline (uniquement % pondéré). */
      annualLossKWh: undefined,
      meta: {
        samples: totalSolarSamples,
        model: "annual-raycast-weighted-v2",
        year: year,
        stepMinutes: stepMinutes,
      },
      panelStats: [],
    };
  }
  if (!Array.isArray(obstacles)) obstacles = [];
  if (!Array.isArray(roofPans)) roofPans = [];

  var normObstacles = normalizeObstacles(obstacles);

  if (typeof window !== "undefined" && window.SHADING_DEBUG) {
    var totalSampleCount = 0;
    for (var pi = 0; pi < panels.length; pi++) totalSampleCount += samplePanelPoints(panels[pi]).length;
    console.log("[SHADING_DEBUG] panel sampleCount total:", totalSampleCount, "normObstacles.length:", normObstacles.length);
  }

  var minSunElevationDeg = (config && typeof config.minSunElevationDeg === "number")
    ? config.minSunElevationDeg : 5;
  var effectiveMinElevation = Math.max(minSunElevationDeg, 3);

  var result = generateAnnualSamples(
    { year: year, stepMinutes: stepMinutes, minSunElevationDeg: effectiveMinElevation },
    latDeg,
    lonDeg
  );

  var totalWeightedFraction = 0;
  var totalWeight = 0;
  // Aligné backend : baseline = tous les samples, farNear = au-dessus horizon (pour totalLoss)
  var totalWeightBaseline = 0;
  var totalWeightFarNear = 0;
  var samples = result.samples;

  var panelWeightedSum = new Array(panels.length);
  var panelWeightSum = new Array(panels.length);
  var panelShadedSamples = new Array(panels.length);
  for (var i = 0; i < panels.length; i++) {
    panelWeightedSum[i] = 0;
    panelWeightSum[i] = 0;
    panelShadedSamples[i] = 0;
  }

  // Log debug (dev only) une fois par run si horizonMask présent
  var horizonMaskParam = params && params.horizonMask;
  if (horizonMaskParam) logDebugSampler(horizonMaskParam);

  for (var s = 0; s < samples.length; s++) {
    var sample = samples[s];
    var azDeg = sample.azimuthDeg;
    var elDeg = sample.elevationDeg;

    var sunDir = computeShadowRayDirection(azDeg, elDeg);
    var weight = Math.max(0, sunDir.dz);
    if (weight <= 0) continue;
    totalWeightBaseline += weight;

    // OMBRAGE LOINTAIN — masque d'horizon (params.horizonMask, interpolation alignée backend)
    if (isSunBlockedByHorizonMaskSafe(horizonMaskParam, azDeg, elDeg)) {
      continue; // Soleil masqué → pas de contribution à farNear ni near
    }

    totalSolarSamples++;
    var panelFractionSum = 0;
    for (var p = 0; p < panels.length; p++) {
      var fraction = computePanelShadedFraction({
        panel: panels[p],
        obstacles: normObstacles,
        sunDir: sunDir,
        metersPerPixel: metersPerPixel,
      });
      panelFractionSum += fraction;
      totalWeightedFraction += fraction * weight;
      totalWeight += weight;
      panelWeightedSum[p] += fraction * weight;
      panelWeightSum[p] += weight;
      if (fraction > 0) panelShadedSamples[p]++;
    }
    var avgFraction = panels.length > 0 ? panelFractionSum / panels.length : 0;
    totalWeightFarNear += weight * (1 - avgFraction);
  }

  // Même formule que backend : totalLossPct = 100 * (1 - totalWeightFarNear / totalWeightBaseline)
  var annualLossPercent =
    (totalWeightBaseline <= 0)
      ? 0
      : clamp01(1 - totalWeightFarNear / totalWeightBaseline) * 100;

  var panelStats = panels.map(function (p, i) {
    var shadedFractionAvg =
      (panelWeightSum[i] <= 0)
        ? 0
        : clamp01(panelWeightedSum[i] / panelWeightSum[i]);
    var shadedHours = panelShadedSamples[i] * (stepMinutes / 60);
    return {
      panelId: p.id,
      shadedFractionAvg: shadedFractionAvg,
      shadedHours: shadedHours,
    };
  });

  return {
    annualLossPercent: Number(annualLossPercent.toFixed(3)),
    annualLossKWh: undefined,
    meta: {
      samples: totalSolarSamples,
      model: "annual-raycast-weighted-v2",
      year: year,
      stepMinutes: stepMinutes,
    },
    panelStats: panelStats.map(function (p) {
      return {
        panelId: p.panelId,
        shadedFractionAvg: Number(p.shadedFractionAvg.toFixed(4)),
        shadedHours: Number(p.shadedHours.toFixed(2)),
      };
    }),
  };
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = {
    computeAnnualShadingLoss,
    getAnnualSunVectors,
    normalizeObstacles,
    computeShadowRayDirection,
    isPanelPointShadedByObstacle,
  };
}
function getSunPositionAt(date, latDeg, lonDeg) {
  var fn = getComputeSunPosition();
  return fn ? fn(date, latDeg, lonDeg) : null;
}if (typeof window !== "undefined") {
  window.computeAnnualShadingLoss = computeAnnualShadingLoss;
  window.getAnnualSunVectors = getAnnualSunVectors;
  // Contract: used by runNearWorstCase()
  window.getSunPositionAt = function (date, latDeg, lonDeg) {
    var solar = window.__SHADING_SOLAR_POSITION__;
    if (!solar || typeof solar.getSunPosition !== "function") {
      throw new Error("[SHADING] __SHADING_SOLAR_POSITION__.getSunPosition missing");
    }
    var r = solar.getSunPosition(date, latDeg, lonDeg);
    return { azimuthDeg: r.azimuthDeg, elevationDeg: r.elevationDeg };
  };
}
