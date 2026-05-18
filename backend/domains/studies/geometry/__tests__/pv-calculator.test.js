import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  imageToWorld,
  validatePanelPlacement,
  validatePolygon,
  worldToImage,
} from "../pv-calculator.js";

const roof = [
  { x: 0, y: 0 },
  { x: 10, y: 0 },
  { x: 10, y: 8 },
  { x: 0, y: 8 },
  { x: 0, y: 0 },
];

describe("pv geometry calculator", () => {
  it("validates a closed non self-intersecting polygon above the minimum area", () => {
    const report = validatePolygon(roof, { minAreaM2: 70 });

    assert.equal(report.ok, true);
    assert.equal(report.code, "OK");
    assert.equal(report.areaM2, 80);
  });

  it("rejects a non-closed roof polygon", () => {
    const report = validatePolygon(roof.slice(0, -1));

    assert.equal(report.ok, false);
    assert.equal(report.code, "POLYGON_NOT_CLOSED");
  });

  it("rejects a self-intersecting polygon", () => {
    const report = validatePolygon([
      { x: 0, y: 0 },
      { x: 10, y: 10 },
      { x: 0, y: 10 },
      { x: 10, y: 0 },
      { x: 0, y: 0 },
    ]);

    assert.equal(report.ok, false);
    assert.equal(report.code, "POLYGON_SELF_INTERSECTION");
  });

  it("rejects a polygon below the minimum useful area", () => {
    const report = validatePolygon([
      { x: 0, y: 0 },
      { x: 1, y: 0 },
      { x: 1, y: 1 },
      { x: 0, y: 1 },
      { x: 0, y: 0 },
    ], { minAreaM2: 2 });

    assert.equal(report.ok, false);
    assert.equal(report.code, "POLYGON_AREA_TOO_SMALL");
  });

  it("round-trips GPS coordinates through image pixels within 1 cm", () => {
    const calibration = {
      originGps: { lat: 48.8566, lng: 2.3522 },
      originImage: { x: 400, y: 300 },
      metersPerPixel: 0.05,
      rotationDeg: 17,
    };
    const gps = { lat: 48.856642, lng: 2.352315 };

    const pixel = worldToImage(gps, calibration);
    const back = imageToWorld(pixel, calibration);
    const backPixel = worldToImage(back, calibration);
    const driftMeters = Math.hypot(backPixel.x - pixel.x, backPixel.y - pixel.y) * calibration.metersPerPixel;

    assert.ok(driftMeters <= 0.01, `GPS/image round trip drift ${driftMeters} m`);
  });

  it("accepts a panel fully inside the roof", () => {
    const report = validatePanelPlacement([
      { x: 1, y: 1 },
      { x: 3, y: 1 },
      { x: 3, y: 2 },
      { x: 1, y: 2 },
    ], { roofPolygon: roof });

    assert.equal(report.ok, true);
  });

  it("rejects a panel outside the roof", () => {
    const report = validatePanelPlacement([
      { x: 9, y: 1 },
      { x: 11, y: 1 },
      { x: 11, y: 2 },
      { x: 9, y: 2 },
    ], { roofPolygon: roof });

    assert.equal(report.ok, false);
    assert.equal(report.code, "PANEL_OUTSIDE_ROOF");
  });

  it("rejects a panel overlapping an obstacle", () => {
    const report = validatePanelPlacement([
      { x: 2, y: 2 },
      { x: 4, y: 2 },
      { x: 4, y: 4 },
      { x: 2, y: 4 },
    ], {
      roofPolygon: roof,
      obstacles: [
        {
          id: "chimney",
          polygon: [
            { x: 3, y: 3 },
            { x: 5, y: 3 },
            { x: 5, y: 5 },
            { x: 3, y: 5 },
          ],
        },
      ],
    });

    assert.equal(report.ok, false);
    assert.equal(report.code, "PANEL_ON_OBSTACLE");
    assert.equal(report.obstacleId, "chimney");
  });
});
