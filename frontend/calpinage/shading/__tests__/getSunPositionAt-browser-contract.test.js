/**
 * Test contrat browser : après chargement de shadingEngine avec window.__SHADING_SOLAR_POSITION__
 * exposé, window.getSunPositionAt doit exister et retourner { azimuthDeg, elevationDeg }.
 * Exécutable : node frontend/calpinage/shading/__tests__/getSunPositionAt-browser-contract.test.js
 * ou depuis frontend/calpinage/shading : node __tests__/getSunPositionAt-browser-contract.test.js
 */
const { test } = require("node:test");
const assert = require("node:assert");
const path = require("path");

test("window.getSunPositionAt exposé en browser (simulation)", function () {
  const savedWindow = global.window;
  const mockGetSunPosition = function (date, latDeg, lonDeg) {
    return { azimuthDeg: 180, elevationDeg: 25 };
  };
  global.window = {
    __SHADING_SOLAR_POSITION__: {
      getSunPosition: mockGetSunPosition,
    },
  };

  try {
    const shadingEnginePath = path.join(__dirname, "..", "shadingEngine.js");
    require(shadingEnginePath);

    assert.strictEqual(typeof global.window.getSunPositionAt, "function", "typeof window.getSunPositionAt === 'function'");

    const result = global.window.getSunPositionAt(new Date(), 48.85, 2.35);
    assert.ok(result != null, "getSunPositionAt retourne un objet");
    assert.strictEqual(typeof result.azimuthDeg, "number", "azimuthDeg est un number");
    assert.strictEqual(typeof result.elevationDeg, "number", "elevationDeg est un number");
    assert.strictEqual(result.azimuthDeg, 180, "azimuthDeg mock 180");
    assert.strictEqual(result.elevationDeg, 25, "elevationDeg mock 25");
  } finally {
    global.window = savedWindow;
  }
});
