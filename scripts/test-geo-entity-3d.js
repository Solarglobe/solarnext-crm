/**
 * Test Node du module geoEntity3D (normalisation 3D-ready).
 * Exécuter : node scripts/test-geo-entity-3d.js
 *
 * Utilise la version CJS compilée (backend/calpinage-legacy-assets/geometry/geoEntity3D.cjs).
 * Si absente, exécuter d'abord : cd frontend && npm run build:geom3d
 */

const path = require("path");
const geomPath = path.join(__dirname, "../backend/calpinage-legacy-assets/geometry/geoEntity3D.cjs");
let geoEntity3D;
try {
  geoEntity3D = require(geomPath);
} catch (e) {
  console.error("Impossible de charger geoEntity3D.cjs. Exécuter: cd frontend && npm run build:geom3d");
  console.error(e.message);
  process.exit(1);
}

const {
  normalizeToGeoEntity3D,
  normalizeCalpinageGeometry3DReady,
  buildGeometry3DExportSection,
  toFootprintPx,
  computeCentroidPx,
  ensureClosedPolygon,
  getBaseZWorldM,
} = geoEntity3D;

let houseModelV2;
try {
    houseModelV2 = require(path.join(__dirname, "../backend/calpinage-legacy-assets/geometry/geoEntity3D.cjs")).houseModelV2;
} catch {
  houseModelV2 = null;
}

let passed = 0;
let failed = 0;

function assert(cond, msg) {
  if (cond) {
    passed++;
    return true;
  }
  failed++;
  console.error("FAIL:", msg);
  return false;
}

const ctxZero = { getHeightAtImagePoint: () => 0 };
const ctx42 = { getHeightAtImagePoint: () => 42 };

// --- Obstacle polygonPx + heightRelM ---
function testObstaclePolygonPx() {
  const obstacle = {
    id: "obs-poly",
    polygonPx: [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 40 },
      { x: 10, y: 40 },
    ],
    heightRelM: 2.5,
  };
  const norm = normalizeToGeoEntity3D(obstacle, ctxZero, "OBSTACLE");
  return (
    assert(norm !== null, "obstacle polygonPx → non null") &&
    assert(norm.footprintPx.length >= 3, "footprintPx length >= 3") &&
    assert(typeof norm.baseZWorldM === "number", "baseZWorldM number") &&
    assert(typeof norm.heightM === "number" && norm.heightM >= 0, "heightM number >= 0") &&
    assert(norm.heightM === 2.5, "heightRelM mappé vers heightM") &&
    assert(norm.type === "OBSTACLE", "type OBSTACLE")
  );
}

// --- Obstacle circle ---
function testObstacleCircle() {
  const obstacle = {
    id: "obs-circle",
    type: "circle",
    x: 50,
    y: 60,
    r: 15,
    heightM: 1,
  };
  const norm = normalizeToGeoEntity3D(obstacle, ctxZero, "OBSTACLE");
  return (
    assert(norm !== null, "obstacle circle → non null") &&
    assert(norm.footprintPx.length >= 3, "footprintPx length >= 3 (cercle discrétisé)") &&
    assert(typeof norm.baseZWorldM === "number", "baseZWorldM number") &&
    assert(typeof norm.heightM === "number" && norm.heightM >= 0, "heightM number >= 0") &&
    assert(norm.heightM === 1, "heightM conservé")
  );
}

// --- PV panel avec projection.points ---
function testPVPanelProjection() {
  const panel = {
    id: "p1",
    panId: "pan-1",
    projection: {
      points: [
        { x: 100, y: 110 },
        { x: 120, y: 110 },
        { x: 120, y: 130 },
        { x: 100, y: 130 },
      ],
    },
  };
  const norm = normalizeToGeoEntity3D(panel, ctx42, "PV_PANEL");
  return (
    assert(norm !== null, "PV panel projection → non null") &&
    assert(norm.footprintPx.length >= 3, "footprintPx length >= 3") &&
    assert(typeof norm.baseZWorldM === "number", "baseZWorldM number") &&
    assert(norm.baseZWorldM === 42, "baseZWorldM depuis ctx") &&
    assert(norm.heightM === 0, "PV_PANEL heightM = 0") &&
    assert(norm.type === "PV_PANEL", "type PV_PANEL")
  );
}

// --- Shadow volume cube ---
function testShadowVolumeCube() {
  const sv = {
    id: "sv1",
    type: "shadow_volume",
    x: 200,
    y: 200,
    width: 0.6,
    depth: 0.6,
    height: 3,
    metersPerPixel: 0.1,
  };
  const norm = normalizeToGeoEntity3D(sv, ctxZero, "SHADOW_VOLUME");
  return (
    assert(norm !== null, "shadow volume cube → non null") &&
    assert(norm.footprintPx.length >= 3, "footprintPx length >= 3") &&
    assert(typeof norm.baseZWorldM === "number", "baseZWorldM number") &&
    assert(typeof norm.heightM === "number" && norm.heightM >= 0, "heightM number >= 0") &&
    assert(norm.heightM === 3, "height mappé") &&
    assert(norm.type === "SHADOW_VOLUME", "type SHADOW_VOLUME")
  );
}

// --- Pan polygon ---
function testPanPolygon() {
  const pan = {
    id: "pan-1",
    name: "Pan Sud",
    polygon: [
      { x: 0, y: 0 },
      { x: 100, y: 0 },
      { x: 100, y: 80 },
      { x: 0, y: 80 },
    ],
  };
  const norm = normalizeToGeoEntity3D(pan, ctxZero, "PAN_SURFACE");
  return (
    assert(norm !== null, "pan polygon → non null") &&
    assert(norm.footprintPx.length >= 3, "footprintPx length >= 3") &&
    assert(typeof norm.baseZWorldM === "number", "baseZWorldM number") &&
    assert(norm.heightM === 0, "PAN_SURFACE heightM = 0") &&
    assert(norm.type === "PAN_SURFACE", "type PAN_SURFACE")
  );
}

// --- Helpers ---
function testHelpers() {
  const pts = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
  ];
  const centroid = computeCentroidPx(pts);
  const closed = ensureClosedPolygon(pts);
  const fp = toFootprintPx({ polygonPx: pts });
  const baseZ = getBaseZWorldM(5, 5, ctx42);

  return (
    assert(centroid.x > 0 && centroid.y > 0, "computeCentroidPx") &&
    assert(closed.length === 4, "ensureClosedPolygon ferme") &&
    assert(fp !== null && fp.length >= 3, "toFootprintPx") &&
    assert(baseZ === 42, "getBaseZWorldM utilise ctx")
  );
}

// --- Export geometry3d (obstacle + panel + shadow volume + pan) ---
function testExportGeometry3d() {
  const fakeState = {
    obstacles: [
      {
        id: "obs1",
        polygonPx: [
          { x: 0, y: 0 },
          { x: 20, y: 0 },
          { x: 20, y: 20 },
          { x: 0, y: 20 },
        ],
        heightM: 2,
      },
    ],
    shadowVolumes: [
      {
        id: "sv1",
        type: "shadow_volume",
        x: 100,
        y: 100,
        width: 0.5,
        depth: 0.5,
        height: 2,
        metersPerPixel: 0.1,
      },
    ],
    roofExtensions: [],
    contours: [],
    pans: [
      {
        id: "pan-1",
        name: "Pan",
        polygon: [
          { x: 50, y: 50 },
          { x: 80, y: 50 },
          { x: 80, y: 80 },
          { x: 50, y: 80 },
        ],
      },
    ],
    roof: { scale: { metersPerPixel: 0.1 } },
  };
  const ctx = { getHeightAtImagePoint: () => 0 };
  const getAllPanels = () => [
    {
      id: "p1",
      panId: "pan-1",
      enabled: true,
      projection: {
        points: [
          { x: 60, y: 60 },
          { x: 70, y: 60 },
          { x: 70, y: 70 },
          { x: 60, y: 70 },
        ],
      },
    },
  ];
  const norm = normalizeCalpinageGeometry3DReady(fakeState, ctx, { getAllPanels });
  const geometry3d = buildGeometry3DExportSection(norm, ctx);
  return (
    assert(geometry3d !== null, "geometry3d export non null") &&
    assert(Array.isArray(geometry3d.entities), "geometry3d.entities array") &&
    assert(geometry3d.entities.length >= 4, "geometry3d.entities.length >= 4 (obstacle+panel+sv+pan)") &&
    assert(geometry3d.version === "1", "geometry3d.version = 1") &&
    assert(geometry3d.stats && typeof geometry3d.stats.countsByType === "object", "geometry3d.stats.countsByType") &&
    assert(typeof geometry3d.stats.fallbackBaseZCount === "number", "geometry3d.stats.fallbackBaseZCount") &&
    assert(typeof geometry3d.stats.missingHeightCount === "number", "geometry3d.stats.missingHeightCount")
  );
}

// --- Run ---
testObstaclePolygonPx();
testObstacleCircle();
testPVPanelProjection();
testShadowVolumeCube();
testPanPolygon();
testHelpers();
testExportGeometry3d();

// --- houseModelV2 (1 obstacle + 1 PV panel) ---
function testHouseModelV2() {
  if (!houseModelV2) {
    console.warn("houseModelV2 non disponible (geoEntity3D.cjs peut ne pas l'exporter)");
    return;
  }
  const obstacle = {
    id: "obs1",
    type: "OBSTACLE",
    footprintPx: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    baseZWorldM: 0,
    heightM: 2,
  };
  const panel = {
    id: "p1",
    type: "PV_PANEL",
    footprintPx: [
      { x: 50, y: 50 },
      { x: 70, y: 50 },
      { x: 70, y: 70 },
      { x: 50, y: 70 },
    ],
    baseZWorldM: 0,
    heightM: 0,
  };
  const model = houseModelV2([obstacle, panel], { metersPerPixel: 0.1 });
  const totalVerts = model.roofMeshes.reduce((s, m) => s + m.vertices.length, 0);
  const totalInds = model.roofMeshes.reduce((s, m) => s + m.indices.length, 0);
  return (
    assert(model.walls.length >= 1, "houseModelV2: au moins 1 wall (obstacle)") &&
    assert(model.roofMeshes.length >= 1, "houseModelV2: au moins 1 roofMesh (panel)") &&
    assert(totalVerts > 0, "houseModelV2: vertices length > 0") &&
    assert(totalInds > 0, "houseModelV2: indices length > 0")
  );
}

testHouseModelV2();

const total = passed + failed;
console.log("\n" + passed + "/" + total + " TESTS PASSED (geoEntity3D)");
if (failed > 0) {
  process.exit(1);
}
