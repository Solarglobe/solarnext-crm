/**
 * Far shading sans GPS fiable — pas de coordonnées fictives, état UNAVAILABLE_NO_GPS.
 * Usage: node backend/tests/calpinage-shading-no-gps.test.js
 */

import assert from "node:assert/strict";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { buildStructuredShading } from "../services/shading/shadingStructureBuilder.js";
import { normalizeCalpinageShading } from "../services/calpinage/calpinageShadingNormalizer.js";

const panel = {
  id: "p1",
  polygon: [
    { x: 50, y: 50 },
    { x: 60, y: 50 },
    { x: 60, y: 60 },
    { x: 50, y: 60 },
  ],
};

const rValid = await computeCalpinageShading({
  lat: 45.764,
  lon: 4.8357,
  panels: [panel],
  obstacles: [],
  storedNearLossPct: 0,
});

assert.equal(rValid.farUnavailable, undefined);
assert(typeof rValid.farLossPct === "number", "GPS valide → farLossPct numérique");
assert(rValid.blockingReason == null, "pas de blockingReason avec GPS");

const rNoGps = await computeCalpinageShading({
  panels: [panel],
  obstacles: [],
  storedNearLossPct: 3.2,
});

assert.equal(rNoGps.farLossPct, null, "sans GPS → farLossPct null (pas 0 trompeur)");
assert.equal(rNoGps.blockingReason, "missing_gps");
assert.equal(rNoGps.farUnavailable, true);
assert.equal(rNoGps.totalLossPct, 3.2, "total = near stocké uniquement");

const raw = buildStructuredShading(rNoGps, false, true, {});
assert.equal(raw.far?.source, "UNAVAILABLE_NO_GPS");
assert.equal(raw.far?.totalLossPct, null);
assert.equal(raw.shadingQuality?.blockingReason, "missing_gps");
assert.equal(raw.farLossPct, null);

const norm = normalizeCalpinageShading(raw, {});
assert.equal(norm.far?.totalLossPct, null);
assert.equal(norm.far?.source, "UNAVAILABLE_NO_GPS");
assert.equal(norm.shadingQuality?.blockingReason, "missing_gps");

const rInvalid = await computeCalpinageShading({
  lat: NaN,
  lon: null,
  panels: [panel],
  obstacles: [],
  storedNearLossPct: 1,
});
assert.equal(rInvalid.farLossPct, null);
assert.equal(rInvalid.blockingReason, "missing_gps");

console.log("✅ calpinage-shading-no-gps.test.js PASS");
