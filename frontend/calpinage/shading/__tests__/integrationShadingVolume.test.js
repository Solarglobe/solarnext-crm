/**
 * Test d'intégration ombrage réel.
 * Valide : shadow volume projette correctement, extension projette correctement, pas de régression Phase 3.
 *
 * Scénario :
 * - Toit pente 30°
 * - Volume cube hauteur 2m
 * - Calcul ombre à midi
 * - Vérifier que ombre démarre à roofZ, pas à 0
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { computeShadowRayDirection } = require("../shadingEngine.js");
const nearShadingCore = require("../nearShadingCore.cjs");
const { normalizeObstacles, computePanelShadedFraction, isPanelPointShadedByObstacle } = nearShadingCore;

// computeSunPosition est interne au shadingEngine, on utilise une date fixe à midi
// Pour Paris 21 juin 2026 12:00 UTC : élévation ~62°, azimuth ~180°
function getNoonSunPosition() {
  const date = new Date(Date.UTC(2026, 5, 21, 12, 0, 0));
  const latDeg = 48.85;
  const lonDeg = 2.35;
  const rad = Math.PI / 180;
  const dayOfYear = Math.floor(
    (Date.UTC(2026, 5, 21) - Date.UTC(2026, 0, 0)) / 86400000
  );
  const decl = 23.45 * rad * Math.sin(rad * (360 / 365) * (dayOfYear - 81));
  const time = 12;
  const ha = rad * 15 * (time - 12);
  const lat = latDeg * rad;
  const elevation = Math.asin(
    Math.sin(lat) * Math.sin(decl) + Math.cos(lat) * Math.cos(decl) * Math.cos(ha)
  );
  const azimuth = Math.atan2(
    -Math.sin(ha),
    Math.tan(decl) * Math.cos(lat) - Math.sin(lat) * Math.cos(ha)
  );
  return {
    elevationDeg: (elevation / rad),
    azimuthDeg: ((azimuth / rad + 360) % 360),
  };
}

test("toit pente 30° - volume cube 2m - baseZ = roofZ (pas 0)", function () {
  // Toit pente 30° : Z = 5 + (y/100)*5.77 (tan 30° ≈ 0.577)
  const getHeightAtImagePoint = function (x, y) {
    return 5 + (y / 100) * 5.77;
  };

  const obstacles = [
    {
      id: "cube-1",
      polygonPx: [
        { x: 45, y: 45 },
        { x: 55, y: 45 },
        { x: 55, y: 55 },
        { x: 45, y: 55 },
      ],
      heightM: 2,
    },
  ];

  const norm = normalizeObstacles(obstacles, getHeightAtImagePoint);
  assert.strictEqual(norm.length, 1, "Un obstacle normalisé");

  const vol = norm[0];
  const centerY = 50;
  const expectedRoofZ = 5 + (centerY / 100) * 5.77;

  assert.ok(
    Math.abs(vol.baseZ - expectedRoofZ) < 0.1,
    `baseZ ${vol.baseZ} doit être proche de roofZ ${expectedRoofZ.toFixed(2)}`
  );
  assert.notStrictEqual(vol.baseZ, 0, "baseZ ne doit pas être 0 (ombre démarre à roofZ)");
  assert.strictEqual(vol.heightM, 2, "Hauteur volume 2m");
  assert.ok(
    Math.abs(vol.baseZ + vol.heightM - (expectedRoofZ + 2)) < 0.1,
    "topZ = baseZ + heightM"
  );
});

test("calcul ombre à midi - shadow volume utilise baseZ (roofZ)", function () {
  const roofZ = 10;
  const getHeightAtImagePoint = function () {
    return roofZ;
  };

  const obstacles = [
    {
      id: "cube",
      polygonPx: [
        { x: 50, y: 50 },
        { x: 60, y: 50 },
        { x: 60, y: 60 },
        { x: 50, y: 60 },
      ],
      heightM: 2,
    },
  ];

  const norm = normalizeObstacles(obstacles, getHeightAtImagePoint);
  assert.strictEqual(norm[0].baseZ, roofZ, "baseZ = roofZ");

  const sunPos = getNoonSunPosition();
  const sunDir = computeShadowRayDirection(
    sunPos.azimuthDeg,
    sunPos.elevationDeg
  );

  const panel = {
    id: "p1",
    polygonPx: [
      { x: 50, y: 70 },
      { x: 60, y: 70 },
      { x: 60, y: 80 },
      { x: 50, y: 80 },
    ],
  };

  const fraction = computePanelShadedFraction({
    panel,
    obstacles: norm,
    sunDir,
    getZWorldAtXY: getHeightAtImagePoint,
    useZLocal: true,
    panelGridSize: 2,
    metersPerPixel: 1,
  });

  assert.ok(
    typeof fraction === "number" && fraction >= 0 && fraction <= 1,
    "Fraction ombrée entre 0 et 1"
  );
});

test("isPanelPointShadedByObstacle - ombre démarre à roofZ (baseZ=roofZ vs baseZ=0)", function () {
  const roofZ = 10;
  const obstacle = {
    polygonPx: [
      { x: 48, y: 48 },
      { x: 52, y: 48 },
      { x: 52, y: 52 },
      { x: 48, y: 52 },
    ],
    heightM: 2,
  };

  const sunPos = getNoonSunPosition();
  const sunDir = computeShadowRayDirection(
    sunPos.azimuthDeg,
    sunPos.elevationDeg
  );

  const panelPoint = { x: 50, y: 56.5 };

  const shadedWithRoofZ = isPanelPointShadedByObstacle({
    panelPoint,
    obstacle,
    sunDir,
    obstacleBaseZ: roofZ,
    metersPerPixel: 1,
  });

  const shadedWithZero = isPanelPointShadedByObstacle({
    panelPoint,
    obstacle,
    sunDir,
    obstacleBaseZ: 0,
    metersPerPixel: 1,
  });

  assert.ok(
    typeof shadedWithRoofZ === "boolean",
    "Résultat cohérent avec baseZ=roofZ"
  );
  assert.ok(
    typeof shadedWithZero === "boolean",
    "Résultat cohérent avec baseZ=0"
  );
  assert.strictEqual(
    shadedWithRoofZ,
    true,
    "Panel au nord de l'obstacle : ombré quand baseZ=roofZ (ombre démarre à roofZ)"
  );
  assert.strictEqual(
    shadedWithZero,
    false,
    "Panel au nord : non ombré si baseZ=0 (ombre incorrecte depuis z=0)"
  );
});
