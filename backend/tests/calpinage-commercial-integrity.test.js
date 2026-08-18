import assert from "node:assert/strict";
import test from "node:test";
import {
  deriveBackendCommercialGeometryVerdict,
  sanitizeCalpinageGeometryForPersistence,
} from "../services/calpinage/calpinageCommercialIntegrity.js";

test("sanitizeCalpinageGeometryForPersistence refuse NaN et Infinity", () => {
  assert.throws(
    () => sanitizeCalpinageGeometryForPersistence({ gps: { lat: NaN, lon: 2 }, pans: [] }),
    /Nombre non fini refusé/,
  );
  assert.throws(
    () => sanitizeCalpinageGeometryForPersistence({ gps: { lat: 48, lon: Infinity }, pans: [] }),
    /Nombre non fini refusé/,
  );
});

test("sanitizeCalpinageGeometryForPersistence supprime les affirmations officielles client", () => {
  const out = sanitizeCalpinageGeometryForPersistence({
    officialPvPlacementAllowed: true,
    officialNearShadingAllowed: true,
    commercialGeometryVerdict: { status: "VALID" },
    pans: [{ id: "p1", roofType: "UNKNOWN" }],
  });
  assert.equal(out.officialPvPlacementAllowed, undefined);
  assert.equal(out.officialNearShadingAllowed, undefined);
  assert.equal(out.commercialGeometryVerdict, undefined);
  assert.equal(out.backendCommercialGeometry.status, "INVALID");
  assert.equal(out.backendCommercialGeometry.officialPvPlacementAllowed, false);
});

test("deriveBackendCommercialGeometryVerdict conserve FLAT/PITCHED explicites sans les certifier seul", () => {
  const verdict = deriveBackendCommercialGeometryVerdict({
    pans: [
      { id: "flat", roofType: "FLAT", roofKindProvenance: "EXPLICIT" },
      { id: "pitched", roofKind: "PITCHED", roofKindProvenance: "EXPLICIT" },
    ],
  });
  assert.equal(verdict.status, "UNCERTIFIED");
  assert.deepEqual(verdict.panVerdicts.map((p) => p.kind), ["FLAT", "PITCHED"]);
  assert.equal(verdict.officialNearShadingAllowed, false);
});

test("deriveBackendCommercialGeometryVerdict bloque UNKNOWN et fallback hauteur", () => {
  const verdict = deriveBackendCommercialGeometryVerdict({
    pans: [
      { id: "unknown", roofKind: "UNKNOWN", roofKindProvenance: "UNRESOLVED" },
      { id: "fallback", roofType: "FLAT", quality: { diagnostics: [{ code: "HEIGHT_FALLBACK_DEFAULT_ON_CORNERS" }] } },
    ],
  });
  assert.equal(verdict.status, "INVALID");
  assert.equal(verdict.panVerdicts[0].blockingCodes.includes("COMMERCIAL_ROOF_KIND_UNRESOLVED"), true);
  assert.equal(verdict.panVerdicts[1].blockingCodes.includes("COMMERCIAL_ROOF_HEIGHT_FALLBACK"), true);
});
