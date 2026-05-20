const { test } = require("node:test");
const assert = require("node:assert");
const { normalizeObstacles } = require("../nearShadingCore.cjs");

test("dormer canonicalV1 - near shading lit footprintPx avant contour legacy", function () {
  const obstacles = [
    {
      id: "rx-v1",
      contour: {
        points: [
          { x: 200, y: 200 },
          { x: 220, y: 200 },
          { x: 220, y: 220 },
          { x: 200, y: 220 },
        ],
      },
      canonicalV1: {
        version: "roof_extension_v1",
        supportPanId: "pan-a",
        footprintPx: [
          { x: 40, y: 40 },
          { x: 60, y: 40 },
          { x: 60, y: 60 },
          { x: 40, y: 60 },
        ],
        dimensions: { totalHeightM: 1.4 },
      },
      ridgeHeightRelM: 1.4,
    },
  ];

  const norm = normalizeObstacles(obstacles, function () { return 8; });

  assert.strictEqual(norm.length, 1, "Un dormer normalise");
  assert.deepStrictEqual(norm[0].polygonPx[0], { x: 40, y: 40 }, "footprint canonicalV1 prioritaire");
  assert.strictEqual(norm[0].heightM, 1.4, "hauteur dormer conservee");
});
