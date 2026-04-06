/**
 * Tests pour computeObjectZ - calcul unifié baseZ/topZ (shadow + extension).
 */
const { test } = require("node:test");
const assert = require("node:assert");
const { computeObjectZ } = require("../computeObjectZ.js");

test("pente simple - baseZ et topZ cohérents", function () {
  // Toit linéaire: Z = 4 + (y/100)*4 → y=50 → 6m
  const getHeightAtXY = function (x, y) {
    return 4 + (y / 100) * 4;
  };
  const { baseZ, topZ } = computeObjectZ({
    x: 50,
    y: 50,
    heightM: 2,
    getHeightAtXY,
  });
  assert.strictEqual(baseZ, 6);
  assert.strictEqual(topZ, 8);
});

test("heightM = 0 - topZ égal à baseZ", function () {
  const getHeightAtXY = function (x, y) {
    return 5;
  };
  const { baseZ, topZ } = computeObjectZ({
    x: 10,
    y: 20,
    heightM: 0,
    getHeightAtXY,
  });
  assert.strictEqual(baseZ, 5);
  assert.strictEqual(topZ, 5);
});

test("heightM > 0 - topZ = baseZ + heightM", function () {
  const getHeightAtXY = function (x, y) {
    return 3;
  };
  const { baseZ, topZ } = computeObjectZ({
    x: 0,
    y: 0,
    heightM: 4,
    getHeightAtXY,
  });
  assert.strictEqual(baseZ, 3);
  assert.strictEqual(topZ, 7);
});

test("getHeightAtXY absent - baseZ = 0, topZ = heightM", function () {
  const { baseZ, topZ } = computeObjectZ({
    x: 100,
    y: 200,
    heightM: 1.5,
  });
  assert.strictEqual(baseZ, 0);
  assert.strictEqual(topZ, 1.5);
});

test("getHeightAtXY absent et heightM absent - topZ = 0", function () {
  const { baseZ, topZ } = computeObjectZ({
    x: 0,
    y: 0,
  });
  assert.strictEqual(baseZ, 0);
  assert.strictEqual(topZ, 0);
});
