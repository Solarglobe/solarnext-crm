/**
 * Sonde Lot A — rectangle + 1 faîtage (sans attach structurel).
 * Alignée sur computePansFromGeometryCore (split → merge → walk → filtre).
 * Exécution : node scripts/topo-rectangle-ridge-probe.mjs
 */
import { collectMandatoryContourSplitPointsFromStructuralEndpoints } from "../src/modules/calpinage/legacy/pansTopologyPhase2.js";

const contour = {
  id: "c1",
  roofRole: "main",
  closed: true,
  points: [
    { x: 0, y: 0 },
    { x: 100, y: 0 },
    { x: 100, y: 100 },
    { x: 0, y: 100 },
  ],
};

const vpScale = 2;
const snapImg = Math.max(0.5, 10 / vpScale);
const MERGE_EPS_IMG = snapImg * 0.75;
const TOL = 1e-9;
const AREA_EPS = 4;

function distImg(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}
function projectPointOnSegment(pt, a, b) {
  var ax = a.x,
    ay = a.y,
    bx = b.x,
    by = b.y,
    px = pt.x,
    py = pt.y;
  var abx = bx - ax,
    aby = by - ay;
  var t = (abx * (px - ax) + aby * (py - ay)) / (abx * abx + aby * aby + 1e-20);
  t = Math.max(0, Math.min(1, t));
  return { x: ax + t * abx, y: ay + t * aby };
}
function pointOnSegment(pt, a, b, eps) {
  var proj = projectPointOnSegment(pt, a, b);
  return distImg(pt, proj) <= eps;
}
function segmentIntersection(a1, a2, b1, b2, extendT) {
  var ax = a2.x - a1.x,
    ay = a2.y - a1.y;
  var bx = b2.x - b1.x,
    by = b2.y - b1.y;
  var denom = ax * by - ay * bx;
  if (Math.abs(denom) < 1e-12) return null;
  var cx = b1.x - a1.x,
    cy = b1.y - a1.y;
  var t = (cx * by - cy * bx) / denom;
  var s = (cx * ay - cy * ax) / denom;
  var tol = extendT ? MERGE_EPS_IMG * 0.01 : TOL;
  if (t < -tol || t > 1 + tol || s < -tol || s > 1 + tol) return null;
  return { x: a1.x + t * ax, y: a1.y + t * ay, t: t, s: s };
}
function samePoint(p, q, eps) {
  return distImg(p, q) <= (eps != null ? eps : MERGE_EPS_IMG);
}

function runScenarioCore(label, snappedRidges, ridgesForState) {
  const state = {
    contours: [contour],
    ridges: ridgesForState || [],
    traits: [],
  };
  const contourEdges = [{ kind: "contour", ref: contour, id: contour.id, closed: true, roofRole: "main" }];
  const mandatoryContourSplitByFlatSeg = collectMandatoryContourSplitPointsFromStructuralEndpoints(
    state,
    contourEdges,
    state.ridges,
    [],
    MERGE_EPS_IMG
  ).mandatoryByFlatSeg;

  const contourSegments = [];
  for (let i = 0; i < contour.points.length; i++) {
    const j = (i + 1) % contour.points.length;
    contourSegments.push([{ ...contour.points[i] }, { ...contour.points[j] }]);
  }
  const allSegments = [...contourSegments.map((s) => [s[0], s[1]]), ...snappedRidges.map((s) => [s[0], s[1]])];
  const numContourSegments = contourSegments.length;

  let crossInterior = 0;
  let interiorStructuralSplits = 0;
  let tJunctionPush = 0;

  function splitSegmentAtIntersections(a, b, allSegs, segmentIndex, numContourSegs) {
    var points = [{ x: a.x, y: a.y }, { x: b.x, y: b.y }];
    var eps = MERGE_EPS_IMG;
    var isCurrentContour = segmentIndex != null && numContourSegs != null && segmentIndex < numContourSegs;
    for (var i = 0; i < allSegs.length; i++) {
      var s = allSegs[i];
      var a1 = s[0],
        a2 = s[1];
      if (samePoint(a, a1, eps) && samePoint(b, a2, eps)) continue;
      if (samePoint(a, a2, eps) && samePoint(b, a1, eps)) continue;
      var inter = segmentIntersection(a, b, a1, a2, true);
      if (inter) {
        if (distImg(inter, a) > eps && distImg(inter, b) > eps) {
          if (numContourSegs != null) {
            var isOtherContour = i < numContourSegs;
            if (isOtherContour) inter = projectPointOnSegment(inter, a1, a2);
            else if (isCurrentContour) inter = projectPointOnSegment(inter, a, b);
          }
          points.push(inter);
          crossInterior++;
          interiorStructuralSplits++;
        }
      }
      if (pointOnSegment(a1, a, b, eps)) {
        points.push({ x: a1.x, y: a1.y });
        tJunctionPush++;
      }
      if (pointOnSegment(a2, a, b, eps)) {
        points.push({ x: a2.x, y: a2.y });
        tJunctionPush++;
      }
    }
    if (isCurrentContour && mandatoryContourSplitByFlatSeg && segmentIndex != null) {
      var extras = mandatoryContourSplitByFlatSeg[segmentIndex];
      if (extras && extras.length) {
        for (var ex = 0; ex < extras.length; ex++) {
          var ep = extras[ex];
          if (pointOnSegment(ep, a, b, eps)) points.push({ x: ep.x, y: ep.y });
        }
      }
    }
    points.sort(function (p, q) {
      return distImg(a, p) - distImg(a, q);
    });
    var out = [];
    for (var k = 0; k < points.length - 1; k++) {
      var p1 = points[k],
        p2 = points[k + 1];
      if (distImg(p1, p2) < eps) continue;
      out.push([{ x: p1.x, y: p1.y }, { x: p2.x, y: p2.y }]);
    }
    return out;
  }

  const splitSegments = [];
  const splitSegmentKinds = [];
  let splitSubSegsFromRidge = 0;
  const ridgeFlatStart = numContourSegments;
  const ridgeFlatEnd = numContourSegments + snappedRidges.length;
  for (let si = 0; si < allSegments.length; si++) {
    const seg = allSegments[si];
    const segKind = si < numContourSegments ? "contour" : si < ridgeFlatEnd ? "ridge" : "trait";
    const parts = splitSegmentAtIntersections(seg[0], seg[1], allSegments, si, numContourSegments);
    if (si >= ridgeFlatStart && si < ridgeFlatEnd) splitSubSegsFromRidge += parts.length;
    for (let pi = 0; pi < parts.length; pi++) {
      splitSegments.push(parts[pi]);
      splitSegmentKinds.push(segKind);
    }
  }

  const vertexList = [];
  function getVertex(p) {
    for (var i = 0; i < vertexList.length; i++) {
      if (distImg(vertexList[i], p) < MERGE_EPS_IMG) return i;
    }
    var idx = vertexList.length;
    vertexList.push({ x: p.x, y: p.y });
    return idx;
  }
  const graphEdges = [];
  const edgeIsStructural = {};
  const vertexTouchesContourEdge = {};
  for (var _sxi = 0; _sxi < splitSegments.length; _sxi++) {
    var _seg = splitSegments[_sxi];
    var _kind = splitSegmentKinds[_sxi];
    var u = getVertex(_seg[0]);
    var v = getVertex(_seg[1]);
    if (_kind === "contour") {
      vertexTouchesContourEdge[u] = true;
      vertexTouchesContourEdge[v] = true;
    }
    if (u !== v) {
      graphEdges.push([u, v]);
      if (_kind === "ridge" || _kind === "trait") {
        var _ek = u < v ? u + ":" + v : v + ":" + u;
        edgeIsStructural[_ek] = true;
      }
    }
  }

  const adj = {};
  graphEdges.forEach(function (e) {
    var u = e[0],
      v = e[1];
    if (!adj[u]) adj[u] = [];
    adj[u].push(v);
    if (!adj[v]) adj[v] = [];
    adj[v].push(u);
  });

  function undirectedEdgeKeyTopo(a, b) {
    return a < b ? a + ":" + b : b + ":" + a;
  }
  function cycleTouchesStructuralEdge(cycle) {
    for (var cti = 0; cti < cycle.length; cti++) {
      var ca = cycle[cti],
        cb = cycle[(cti + 1) % cycle.length];
      if (edgeIsStructural[undirectedEdgeKeyTopo(ca, cb)]) return true;
    }
    return false;
  }
  function structuralSeparatorLinkedToContour() {
    var hasSep = false;
    for (var _sk in edgeIsStructural) {
      if (edgeIsStructural[_sk]) {
        hasSep = true;
        break;
      }
    }
    if (!hasSep) return false;
    var seed = -1;
    for (var _v0 = 0; _v0 < vertexList.length; _v0++) {
      if (vertexTouchesContourEdge[_v0]) {
        seed = _v0;
        break;
      }
    }
    if (seed < 0) return false;
    var q = [seed];
    var vis = {};
    vis[seed] = true;
    for (var _qx = 0; _qx < q.length; _qx++) {
      var xv = q[_qx];
      var nbl = adj[xv] || [];
      for (var _nx = 0; _nx < nbl.length; _nx++) {
        var yv = nbl[_nx];
        if (!vis[yv]) {
          vis[yv] = true;
          q.push(yv);
        }
      }
    }
    for (var _ex = 0; _ex < graphEdges.length; _ex++) {
      var eua = graphEdges[_ex][0],
        evb = graphEdges[_ex][1];
      if (!edgeIsStructural[undirectedEdgeKeyTopo(eua, evb)]) continue;
      if (vis[eua] && vis[evb]) return true;
    }
    return false;
  }

  function angleBetween(from, to) {
    var a = vertexList[from],
      b = vertexList[to];
    return Math.atan2(b.y - a.y, b.x - a.x);
  }
  function nextEdgeAt(vertex, incomingFrom) {
    var neighbors = adj[vertex] || [];
    if (neighbors.length === 0) return null;
    var inAngle = angleBetween(vertex, incomingFrom);
    var best = null;
    var bestDelta = Infinity;
    for (var n = 0; n < neighbors.length; n++) {
      var w = neighbors[n];
      if (w === incomingFrom) continue;
      var outAngle = angleBetween(vertex, w);
      var delta = outAngle - inAngle;
      while (delta <= 0) delta += 2 * Math.PI;
      while (delta > 2 * Math.PI) delta -= 2 * Math.PI;
      if (delta < 1e-10) continue;
      if (delta < bestDelta) {
        bestDelta = delta;
        best = w;
      }
    }
    return best;
  }

  function signedArea(poly) {
    var n = poly.length;
    if (n < 3) return 0;
    var a = 0;
    for (var i = 0; i < n; i++) {
      var j = (i + 1) % n;
      a += poly[i].x * poly[j].y - poly[j].x * poly[i].y;
    }
    return a * 0.5;
  }
  function pointInPolygon(pt, poly) {
    var n = poly.length;
    var inside = false;
    for (var i = 0, j = n - 1; i < n; j = i++) {
      var xi = poly[i].x,
        yi = poly[i].y;
      var xj = poly[j].x,
        yj = poly[j].y;
      if (yi === yj) continue;
      if (yi > pt.y !== yj > pt.y && pt.x < ((xj - xi) * (pt.y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function pointNearContour(pt, c, eps) {
    if (!c || !c.points || c.points.length < 2) return false;
    var pts = c.points;
    for (var i = 0; i < pts.length; i++) {
      var j = (i + 1) % pts.length;
      var proj = projectPointOnSegment(pt, pts[i], pts[j]);
      if (distImg(pt, proj) <= eps) return true;
    }
    return false;
  }

  function cycleKey(cycle) {
    var minI = 0;
    for (var i = 1; i < cycle.length; i++) {
      if (
        vertexList[cycle[i]].y < vertexList[cycle[minI]].y ||
        (vertexList[cycle[i]].y === vertexList[cycle[minI]].y && vertexList[cycle[i]].x < vertexList[cycle[minI]].x)
      )
        minI = i;
    }
    var s = "";
    for (var i = 0; i < cycle.length; i++) s += cycle[(minI + i) % cycle.length] + "-";
    return s;
  }
  function cycleKeyCanonical(cycle) {
    var k1 = cycleKey(cycle);
    var k2 = cycleKey(cycle.slice().reverse());
    return k1 < k2 ? k1 : k2;
  }

  const faces = [];
  function walkOneFaceFromDirectedEdge(v0, v1) {
    var path = [v0, v1];
    var cur = v1,
      prev = v0;
    while (path.length < 500) {
      var next = nextEdgeAt(cur, prev);
      if (next == null) break;
      if (next === v0) {
        faces.push(path.slice());
        break;
      }
      if (path.indexOf(next) >= 0) break;
      path.push(next);
      prev = cur;
      cur = next;
    }
  }
  graphEdges.forEach(function (e) {
    walkOneFaceFromDirectedEdge(e[0], e[1]);
    walkOneFaceFromDirectedEdge(e[1], e[0]);
  });

  const seenCycles = {};
  const candidates = [];
  let uniqueFaceEntries = [];
  let dedupeSkips = 0;
  let rejectedByArea = 0;
  let rejectedByInside = 0;

  faces.forEach(function (f) {
    var k = cycleKeyCanonical(f);
    if (seenCycles[k]) {
      dedupeSkips++;
      return;
    }
    seenCycles[k] = true;
    var poly = f.map(function (i) {
      return { x: vertexList[i].x, y: vertexList[i].y };
    });
    var area = Math.abs(signedArea(poly));
    var cx = 0,
      cy = 0;
    poly.forEach(function (p) {
      cx += p.x;
      cy += p.y;
    });
    cx /= poly.length;
    cy /= poly.length;
    var insideBati = contourEdges.some(function (edge) {
      var c = edge.ref;
      return c && c.points && c.points.length >= 3 && (pointInPolygon({ x: cx, y: cy }, c.points) || pointNearContour({ x: cx, y: cy }, c, MERGE_EPS_IMG));
    });
    var reject = null;
    if (area < AREA_EPS) reject = "AREA_EPS";
    else if (!insideBati) reject = "insideBati";
    candidates.push({ nPts: poly.length, area, insideBati, reject });
    if (area < AREA_EPS) {
      rejectedByArea++;
      return;
    }
    if (!insideBati) {
      rejectedByInside++;
      return;
    }
    uniqueFaceEntries.push({ polygon: poly, usesStructural: cycleTouchesStructuralEdge(f) });
  });

  var structuralLinked = structuralSeparatorLinkedToContour();
  var envelopeFiltered = 0;
  if (structuralLinked && uniqueFaceEntries.length > 1) {
    var _atomicOnly = uniqueFaceEntries.filter(function (ent) {
      return ent.usesStructural;
    });
    if (_atomicOnly.length > 0) {
      envelopeFiltered = uniqueFaceEntries.length - _atomicOnly.length;
      uniqueFaceEntries = _atomicOnly;
    }
  }
  var uniqueFaces = uniqueFaceEntries.map(function (ent) {
    return ent.polygon;
  });
  var accepted = uniqueFaces.length;

  console.log("\n--- " + label + " ---");
  console.log("ridges", snappedRidges.length, snappedRidges);
  console.log("MERGE_EPS_IMG", MERGE_EPS_IMG, "AREA_EPS", AREA_EPS);
  console.log(
    "A contourSeg",
    contourSegments.length,
    "ridgeSeg",
    snappedRidges.length,
    "interiorStructuralSplits",
    interiorStructuralSplits
  );
  console.log("B splitSegmentsOut", splitSegments.length, "fromRidge", splitSubSegsFromRidge, "crossInterior", crossInterior, "tJunction", tJunctionPush);
  console.log("C vertices", vertexList.length, "undirectedEdges", graphEdges.length);
  console.log("D rawWalkCycles", faces.length, "uniqueCandidates", candidates.length);
  candidates.forEach((c, i) => console.log("  candidate", i + 1, c));
  console.log(
    "E accepted",
    accepted,
    "structuralLinked",
    structuralLinked,
    "envelopeFiltered",
    envelopeFiltered,
    "rejArea",
    rejectedByArea,
    "rejInside",
    rejectedByInside,
    "dedupeSkips",
    dedupeSkips
  );
}

function runScenario(label, ra, rb) {
  if (ra == null || rb == null) {
    runScenarioCore(label, [], []);
  } else {
    runScenarioCore(label, [[{ x: ra.x, y: ra.y }, { x: rb.x, y: rb.y }]], [
      { id: "r1", roofRole: "main", a: { ...ra }, b: { ...rb } },
    ]);
  }
}

console.log("=== TOPO PROBE rectangle + faîtage (Lot C) ===");
runScenario("Cas 0 — rectangle seul (aucun faîtage)", null, null);
runScenario("Cas A — faîtage strictement intérieur (ne joint pas le contour)", { x: 50, y: 10 }, { x: 50, y: 90 });
runScenario("Cas B — cordre bord à bord (traverse le rectangle)", { x: 50, y: 0 }, { x: 50, y: 100 });
runScenarioCore(
  "Cas C — 2 cordes bord à bord (3 bandes)",
  [
    [{ x: 33, y: 0 }, { x: 33, y: 100 }],
    [{ x: 66, y: 0 }, { x: 66, y: 100 }],
  ],
  [
    { id: "r1", roofRole: "main", a: { x: 33, y: 0 }, b: { x: 33, y: 100 } },
    { id: "r2", roofRole: "main", a: { x: 66, y: 0 }, b: { x: 66, y: 100 } },
  ]
);
