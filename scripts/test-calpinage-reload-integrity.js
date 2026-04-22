/**
 * Test d'intégrité reload calpinage + geometry3d.
 * Valide qu'un cycle save → reload → rehydrate ne provoque aucune perte ni dérive.
 *
 * Exécuter : node scripts/test-calpinage-reload-integrity.js
 * Prérequis : cd frontend && npm run build:geom3d
 */

const path = require("path");
const geomPath = path.join(__dirname, "../backend/calpinage-legacy-assets/geometry/geoEntity3D.cjs");
let geoEntity3D;
try {
  geoEntity3D = require(geomPath);
} catch (e) {
  console.error("Impossible de charger geoEntity3D.cjs. Exécuter: cd frontend && npm run build:geom3d");
  process.exit(1);
}

const {
  normalizeCalpinageGeometry3DReady,
  buildGeometry3DExportSection,
  computeCentroidPx,
} = geoEntity3D;

const EPSILON = 1e-4;

function almostEqual(a, b, epsilon = EPSILON) {
  if (typeof a !== "number" || typeof b !== "number") return a === b;
  if (Number.isNaN(a) || Number.isNaN(b)) return false;
  return Math.abs(a - b) <= epsilon;
}

function pointsEqual(pa, pb, epsilon = EPSILON) {
  if (!pa || !pb || !Array.isArray(pa) || !Array.isArray(pb)) return pa === pb;
  if (pa.length !== pb.length) return false;
  for (let i = 0; i < pa.length; i++) {
    const a = pa[i];
    const b = pb[i];
    if (!a || !b || typeof a !== "object" || typeof b !== "object") {
      if (a !== b) return false;
      continue;
    }
    const ax = typeof a.x === "number" ? a.x : a[0];
    const ay = typeof a.y === "number" ? a.y : a[1];
    const bx = typeof b.x === "number" ? b.x : b[0];
    const by = typeof b.y === "number" ? b.y : b[1];
    if (!almostEqual(ax, bx, epsilon) || !almostEqual(ay, by, epsilon)) return false;
  }
  return true;
}

function entityEqual(a, b, epsilon = EPSILON) {
  if (!a || !b) return a === b;
  if (a.id !== b.id) return false;
  if (a.type !== b.type) return false;
  if (!pointsEqual(a.footprintPx, b.footprintPx, epsilon)) return false;
  if (!almostEqual(a.baseZWorldM, b.baseZWorldM, epsilon)) return false;
  if (!almostEqual(a.heightM, b.heightM, epsilon)) return false;
  if (Number.isNaN(a.baseZWorldM) || Number.isNaN(b.baseZWorldM)) return false;
  if (Number.isNaN(a.heightM) || Number.isNaN(b.heightM)) return false;
  if (a.baseZWorldM === undefined || b.baseZWorldM === undefined) return false;
  if (a.heightM === undefined || b.heightM === undefined) return false;
  return true;
}

/**
 * Reconstruit un state minimal à partir de geometry3d.entities.
 */
function rehydrateStateFromGeometry3D(geometry3d, mpp = 0.1) {
  const entities = geometry3d && geometry3d.entities ? geometry3d.entities : [];
  const obstacles = [];
  const shadowVolumes = [];
  const contours = [];
  const pans = [];
  const roofExtensions = [];
  const placedPanels = [];

  for (const e of entities) {
    if (!e || !e.type || !e.footprintPx || e.footprintPx.length < 3) continue;

    switch (e.type) {
      case "OBSTACLE": {
        const pts = e.footprintPx;
        const isCircle =
          pts.length === 16 &&
          (() => {
            const c = computeCentroidPx(pts);
            const dists = pts.map((p) => Math.hypot(p.x - c.x, p.y - c.y));
            const avg = dists.reduce((s, d) => s + d, 0) / dists.length;
            return dists.every((d) => Math.abs(d - avg) < 0.5);
          })();
        if (isCircle) {
          const c = computeCentroidPx(pts);
          const r =
            pts.reduce((s, p) => s + Math.hypot(p.x - c.x, p.y - c.y), 0) / pts.length;
          obstacles.push({
            id: e.id,
            type: "circle",
            x: c.x,
            y: c.y,
            r,
            heightM: e.heightM,
          });
        } else {
          obstacles.push({
            id: e.id,
            polygonPx: pts.map((p) => ({ x: p.x, y: p.y })),
            heightRelM: e.heightM,
          });
        }
        break;
      }

      case "SHADOW_VOLUME": {
        const pts = e.footprintPx;
        const cx = pts.reduce((s, p) => s + p.x, 0) / pts.length;
        const cy = pts.reduce((s, p) => s + p.y, 0) / pts.length;
        const p0 = pts[0];
        const p1 = pts[1];
        const dx = (p1?.x ?? 0) - (p0?.x ?? 0);
        const dy = (p1?.y ?? 0) - (p0?.y ?? 0);
        const widthPx = Math.hypot(dx, dy) || 1;
        const p2 = pts[2];
        const dx2 = (p2?.x ?? 0) - (p1?.x ?? 0);
        const dy2 = (p2?.y ?? 0) - (p1?.y ?? 0);
        const depthPx = Math.hypot(dx2, dy2) || 1;
        const rotationDeg = (Math.atan2(dy, dx) * 180) / Math.PI;
        const widthM = widthPx * mpp;
        const depthM = depthPx * mpp;
        shadowVolumes.push({
          id: e.id,
          type: "shadow_volume",
          x: cx,
          y: cy,
          width: widthM,
          depth: depthM,
          rotation: rotationDeg,
          height: e.heightM,
          metersPerPixel: mpp,
        });
        break;
      }

      case "BUILDING_CONTOUR":
      case "ROOF_CONTOUR":
        contours.push({
          id: e.id,
          points: e.footprintPx.map((p) => ({ x: p.x, y: p.y })),
          roofRole: (e.meta && e.meta.roofRole) || "contour",
        });
        break;

      case "ROOF_EXTENSION":
        roofExtensions.push({
          id: e.id,
          stage: "CONTOUR",
          contour: { points: e.footprintPx.map((p) => ({ x: p.x, y: p.y })) },
        });
        break;

      case "PAN_SURFACE":
        pans.push({
          id: e.id,
          polygon: e.footprintPx.map((p) => ({ x: p.x, y: p.y })),
        });
        break;

      case "PV_PANEL":
        placedPanels.push({
          id: e.id,
          panId: (e.meta && e.meta.panId) || null,
          enabled: true,
          projection: { points: e.footprintPx.map((p) => ({ x: p.x, y: p.y })) },
        });
        break;

      default:
        break;
    }
  }

  return {
    obstacles,
    shadowVolumes,
    contours,
    pans,
    roofExtensions,
    roof: { scale: { metersPerPixel: mpp } },
    _placedPanelsForGetAllPanels: placedPanels,
  };
}

function buildFakeCalpinageState() {
  return {
    roof: { scale: { metersPerPixel: 0.1 } },
    contours: [
      {
        id: "contour-1",
        points: [
          { x: 0, y: 0 },
          { x: 200, y: 0 },
          { x: 200, y: 150 },
          { x: 0, y: 150 },
        ],
        roofRole: "contour",
      },
    ],
    pans: [
      {
        id: "pan-1",
        name: "Pan Sud",
        polygon: [
          { x: 20, y: 20 },
          { x: 180, y: 20 },
          { x: 180, y: 130 },
          { x: 20, y: 130 },
        ],
        points: [
          { x: 20, y: 20, h: 0, id: "p1" },
          { x: 180, y: 20, h: 0, id: "p2" },
          { x: 180, y: 130, h: 0.5, id: "p3" },
          { x: 20, y: 130, h: 0.5, id: "p4" },
        ],
      },
    ],
    obstacles: [
      {
        id: "obs-poly",
        polygonPx: [
          { x: 50, y: 50 },
          { x: 80, y: 50 },
          { x: 80, y: 80 },
          { x: 50, y: 80 },
        ],
        heightRelM: 2,
      },
      {
        id: "obs-circle",
        type: "circle",
        x: 120,
        y: 90,
        r: 12,
        heightM: 1.5,
      },
    ],
    shadowVolumes: [
      {
        id: "sv-1",
        type: "shadow_volume",
        x: 140,
        y: 60,
        width: 0.5,
        depth: 0.4,
        rotation: 15,
        height: 2.5,
        metersPerPixel: 0.1,
      },
    ],
    roofExtensions: [],
    roofSurveyLocked: true,
  };
}

function runTest() {
  const ctx = { getHeightAtImagePoint: (x, y) => 0.1 };
  const mpp = 0.1;

  const getAllPanels = () => [
    {
      id: "panel-1",
      panId: "pan-1",
      enabled: true,
      projection: {
        points: [
          { x: 40, y: 40 },
          { x: 55, y: 40 },
          { x: 55, y: 55 },
          { x: 40, y: 55 },
        ],
      },
    },
    {
      id: "panel-2",
      panId: "pan-1",
      enabled: true,
      projection: {
        points: [
          { x: 100, y: 70 },
          { x: 115, y: 70 },
          { x: 115, y: 85 },
          { x: 100, y: 85 },
        ],
      },
    },
  ];

  const fakeState = buildFakeCalpinageState();

  // 1) Normaliser
  const normBefore = normalizeCalpinageGeometry3DReady(fakeState, ctx, {
    getAllPanels,
    computePansFromGeometryCore: (state) => {
      if (!state.pans || state.pans.length === 0) return;
      state.pans = state.pans || [];
    },
  });

  // 2) Export geometry3d
  const geometry3dExport = buildGeometry3DExportSection(normBefore, ctx);

  // 3) Simuler reload : JSON round-trip
  const jsonStr = JSON.stringify(geometry3dExport);
  const parsed = JSON.parse(jsonStr);

  // 4) Reconstituer newState
  const newState = rehydrateStateFromGeometry3D(parsed, mpp);
  newState.roof = { scale: { metersPerPixel: mpp } };

  const getAllPanelsFromRehydrated = () => newState._placedPanelsForGetAllPanels || [];

  // 5) Re-normaliser
  const normAfter = normalizeCalpinageGeometry3DReady(newState, ctx, {
    getAllPanels: getAllPanelsFromRehydrated,
    computePansFromGeometryCore: (state) => {
      if (!state.pans || state.pans.length === 0) return;
    },
  });

  // 6) Comparer AVANT / APRÈS
  const beforeEntities = normBefore.entities;
  const afterEntities = normAfter.entities;
  const beforeById = new Map(beforeEntities.map((e) => [e.id, e]));
  const afterById = new Map(afterEntities.map((e) => [e.id, e]));

  let driftCount = 0;
  const diffs = [];

  // Même nombre d'entités par type
  const countsBefore = {};
  const countsAfter = {};
  for (const e of beforeEntities) {
    countsBefore[e.type] = (countsBefore[e.type] || 0) + 1;
  }
  for (const e of afterEntities) {
    countsAfter[e.type] = (countsAfter[e.type] || 0) + 1;
  }
  const allTypes = new Set([...Object.keys(countsBefore), ...Object.keys(countsAfter)]);
  for (const t of allTypes) {
    if ((countsBefore[t] || 0) !== (countsAfter[t] || 0)) {
      driftCount++;
      diffs.push(`Type ${t}: count before=${countsBefore[t] || 0} after=${countsAfter[t] || 0}`);
    }
  }

  // Chaque entity.id existant toujours
  for (const e of beforeEntities) {
    const after = afterById.get(e.id);
    if (!after) {
      driftCount++;
      diffs.push(`Entity ${e.id} (${e.type}) manquante après reload`);
      continue;
    }
    if (!entityEqual(e, after)) {
      driftCount++;
      if (!pointsEqual(e.footprintPx, after.footprintPx)) {
        diffs.push(`Entity ${e.id}: footprintPx diff`);
      }
      if (!almostEqual(e.baseZWorldM, after.baseZWorldM)) {
        diffs.push(`Entity ${e.id}: baseZWorldM before=${e.baseZWorldM} after=${after.baseZWorldM}`);
      }
      if (!almostEqual(e.heightM, after.heightM)) {
        diffs.push(`Entity ${e.id}: heightM before=${e.heightM} after=${after.heightM}`);
      }
    }
  }

  // Vérifier aucun NaN / undefined
  for (const e of afterEntities) {
    if (typeof e.baseZWorldM !== "number" || Number.isNaN(e.baseZWorldM)) {
      driftCount++;
      diffs.push(`Entity ${e.id}: baseZWorldM NaN ou undefined`);
    }
    if (typeof e.heightM !== "number" || Number.isNaN(e.heightM)) {
      driftCount++;
      diffs.push(`Entity ${e.id}: heightM NaN ou undefined`);
    }
    if (!e.footprintPx || !Array.isArray(e.footprintPx)) {
      driftCount++;
      diffs.push(`Entity ${e.id}: footprintPx manquant`);
    }
  }

  if (driftCount > 0) {
    console.error("\n❌ Reload integrity FAILED");
    console.error("driftCount =", driftCount);
    diffs.forEach((d) => console.error("  -", d));
    throw new Error(`Reload integrity: ${driftCount} dérive(s) détectée(s)`);
  }

  return { driftCount, beforeEntities, afterEntities };
}

// --- Exécution ---
console.log("[test-calpinage-reload-integrity] Démarrage...");

try {
  const result = runTest();
  console.log("\n✅ Reload complet OK");
  console.log("✅ Pas de perte d'obstacle");
  console.log("✅ Pas de décalage");
  console.log("✅ Pas de dérive baseZWorldM");
  console.log("✅ Pas d'altération geometry3d");
  console.log(`   Entities avant: ${result.beforeEntities.length}, après: ${result.afterEntities.length}`);
  console.log("   driftCount =", result.driftCount);
} catch (err) {
  console.error("\n❌", err.message);
  process.exit(1);
}
