/**
 * Tests pour le module geoEntity3D.
 * Exécuter : cd frontend && npx tsx src/modules/calpinage/geometry/__tests__/geoEntity3D.test.ts
 * ou : npm run test:geom3d
 */

import {
  normalizeToGeoEntity3D,
  toFootprintPx,
  computeCentroidPx,
  ensureClosedPolygon,
  getBaseZWorldM,
} from "../geoEntity3D";

let passed = 0;
let failed = 0;

function assert(cond: boolean, msg: string): boolean {
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
    assert(norm!.footprintPx.length >= 3, "footprintPx length >= 3") &&
    assert(typeof norm!.baseZWorldM === "number", "baseZWorldM number") &&
    assert(typeof norm!.heightM === "number" && norm!.heightM >= 0, "heightM number >= 0") &&
    assert(norm!.heightM === 2.5, "heightRelM mappé vers heightM") &&
    assert(norm!.type === "OBSTACLE", "type OBSTACLE")
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
    assert(norm!.footprintPx.length >= 3, "footprintPx length >= 3 (cercle discrétisé)") &&
    assert(typeof norm!.baseZWorldM === "number", "baseZWorldM number") &&
    assert(typeof norm!.heightM === "number" && norm!.heightM >= 0, "heightM number >= 0") &&
    assert(norm!.heightM === 1, "heightM conservé")
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
    assert(norm!.footprintPx.length >= 3, "footprintPx length >= 3") &&
    assert(typeof norm!.baseZWorldM === "number", "baseZWorldM number") &&
    assert(norm!.baseZWorldM === 42, "baseZWorldM depuis ctx") &&
    assert(norm!.heightM === 0, "PV_PANEL heightM = 0") &&
    assert(norm!.type === "PV_PANEL", "type PV_PANEL")
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
    assert(norm!.footprintPx.length >= 3, "footprintPx length >= 3") &&
    assert(typeof norm!.baseZWorldM === "number", "baseZWorldM number") &&
    assert(typeof norm!.heightM === "number" && norm!.heightM >= 0, "heightM number >= 0") &&
    assert(norm!.heightM === 3, "height mappé") &&
    assert(norm!.type === "SHADOW_VOLUME", "type SHADOW_VOLUME")
  );
}

// --- Obstacle keepout métier : hauteur 3D = 0 (pas d'ombrage physique) ---
function testKeepoutObstacleHeightZero() {
  const obstacle = {
    id: "obs-velux",
    type: "polygon",
    points: [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 40 },
      { x: 10, y: 40 },
    ],
    meta: {
      businessObstacleId: "roof_window",
      isShadingObstacle: false,
      category: "non_shading_keepout",
    },
  };
  const norm = normalizeToGeoEntity3D(obstacle, ctxZero, "OBSTACLE");
  return (
    assert(norm !== null, "keepout → non null") &&
    assert(norm!.heightM === 0, "keepout heightM = 0")
  );
}

/** Données legacy : heightM résiduel sur keepout — doit être ignoré (pas de volume 3D utile). */
function testKeepoutIgnoresExplicitLegacyHeight() {
  const obstacle = {
    id: "obs-velux-legacy-h",
    type: "polygon",
    heightM: 2.5,
    points: [
      { x: 10, y: 20 },
      { x: 30, y: 20 },
      { x: 30, y: 40 },
      { x: 10, y: 40 },
    ],
    meta: {
      businessObstacleId: "roof_window",
      isShadingObstacle: false,
    },
  };
  const norm = normalizeToGeoEntity3D(obstacle, ctxZero, "OBSTACLE");
  return assert(norm !== null && norm!.heightM === 0, "keepout ignore heightM explicite résiduel");
}

/** Catalogue keepout sans flag meta explicite : même règle stricte. */
function testKeepoutInferredFromCatalogIgnoresHeight() {
  const obstacle = {
    id: "obs-kz",
    type: "polygon",
    heightM: 1,
    points: [
      { x: 0, y: 0 },
      { x: 20, y: 0 },
      { x: 20, y: 20 },
      { x: 0, y: 20 },
    ],
    meta: { businessObstacleId: "keepout_zone" },
  };
  const norm = normalizeToGeoEntity3D(obstacle, ctxZero, "OBSTACLE");
  return assert(norm !== null && norm!.heightM === 0, "keepout_zone catalogue sans flag → height 0");
}

// --- Shadow volume sans hauteur explicite : défaut catalogue chimney_square ---
function testShadowVolumeDefaultHeightFromCatalog() {
  const sv = {
    id: "sv-cat",
    type: "shadow_volume",
    shape: "cube",
    x: 200,
    y: 200,
    width: 0.6,
    depth: 0.6,
    metersPerPixel: 0.1,
    meta: { businessObstacleId: "chimney_square", isShadingObstacle: true },
  };
  const norm = normalizeToGeoEntity3D(sv, ctxZero, "SHADOW_VOLUME");
  return assert(norm !== null && norm.heightM === 1.8, "hauteur défaut catalogue cheminée carrée");
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
    assert(norm!.footprintPx.length >= 3, "footprintPx length >= 3") &&
    assert(typeof norm!.baseZWorldM === "number", "baseZWorldM number") &&
    assert(norm!.heightM === 0, "PAN_SURFACE heightM = 0") &&
    assert(norm!.type === "PAN_SURFACE", "type PAN_SURFACE")
  );
}

// --- Helpers ---
function testHelpers() {
  const pts = [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 10, y: 10 }];
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

// --- Run ---
testObstaclePolygonPx();
testObstacleCircle();
testPVPanelProjection();
testShadowVolumeCube();
testKeepoutObstacleHeightZero();
testKeepoutIgnoresExplicitLegacyHeight();
testKeepoutInferredFromCatalogIgnoresHeight();
testShadowVolumeDefaultHeightFromCatalog();
testPanPolygon();
testHelpers();

const total = passed + failed;
console.log("\n" + passed + "/" + total + " TESTS PASSED (geoEntity3D)");
if (failed > 0) {
  throw new Error("Tests failed");
}
