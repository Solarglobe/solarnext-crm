/**
 * Tests de cohérence baseZ pour le shading.
 * baseZ = Z_toit(x,y), topZ = baseZ + heightM.
 * Toit pente 4m → 8m, volume à mi-pente → baseZ ≈ 6m.
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { normalizeObstacles, polygonCentroid } = require("../shadingEngine.js");

test("polygonCentroid calcule le centre du polygone", function () {
  const poly = [
    { x: 0, y: 0 },
    { x: 10, y: 0 },
    { x: 10, y: 10 },
    { x: 0, y: 10 },
  ];
  const c = polygonCentroid(poly);
  assert.strictEqual(c.x, 5);
  assert.strictEqual(c.y, 5);
});

test("baseZ = 0 quand getHeightAtImagePoint absent", function () {
  const obstacles = [
    {
      id: "vol-1",
      polygonPx: [
        { x: 100, y: 100 },
        { x: 110, y: 100 },
        { x: 110, y: 110 },
        { x: 100, y: 110 },
      ],
      heightM: 1.5,
    },
  ];
  const norm = normalizeObstacles(obstacles);
  assert.strictEqual(norm.length, 1);
  assert.strictEqual(norm[0].baseZ, 0);
  assert.strictEqual(norm[0].heightM, 1.5);
});

test("baseZ = Z_toit(x,y) - toit pente 4m→8m, volume à mi-pente", function () {
  // Toit linéaire: Z = 4 + (y/100)*4, donc y=0 → 4m, y=100 → 8m
  // Mi-pente: y=50 → Z = 4 + 2 = 6m
  const getHeightAtImagePoint = function (x, y) {
    return 4 + (y / 100) * 4;
  };

  const heightM = 2;
  const obstacles = [
    {
      id: "vol-mid",
      polygonPx: [
        { x: 50, y: 45 },
        { x: 55, y: 45 },
        { x: 55, y: 55 },
        { x: 50, y: 55 },
      ],
      heightM: heightM,
    },
  ];

  const norm = normalizeObstacles(obstacles, getHeightAtImagePoint);
  assert.strictEqual(norm.length, 1);

  const vol = norm[0];
  const expectedRoofZ = 6; // centre y=50 → 4 + 2 = 6
  const expectedTopZ = expectedRoofZ + heightM;

  assert.ok(
    Math.abs(vol.baseZ - expectedRoofZ) < 0.01,
    `baseZ ${vol.baseZ} devrait être proche de ${expectedRoofZ}`
  );
  assert.ok(
    Math.abs(vol.baseZ + vol.heightM - expectedTopZ) < 0.01,
    `topZ ${vol.baseZ + vol.heightM} devrait être proche de ${expectedTopZ}`
  );
});

test("topZ = baseZ + heightM", function () {
  const getHeightAtImagePoint = function (x, y) {
    return 5;
  };

  const obstacles = [
    {
      id: "vol-1",
      polygonPx: [
        { x: 0, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ],
      heightM: 3,
    },
  ];

  const norm = normalizeObstacles(obstacles, getHeightAtImagePoint);
  assert.strictEqual(norm[0].baseZ, 5);
  assert.strictEqual(norm[0].heightM, 3);
  const topZ = norm[0].baseZ + norm[0].heightM;
  assert.strictEqual(topZ, 8);
});
