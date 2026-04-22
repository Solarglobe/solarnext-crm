/**
 * Gate shading snapshot : KPIs null (GPS manquant) ne doivent pas être confondus avec « ombrage absent ».
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { hasShadingNormalized } from "../services/calpinage/calpinageSnapshot.service.js";

describe("hasShadingNormalized", () => {
  it("accepte enveloppe V2 avec combined.totalLossPct null (GPS / masque indisponible)", () => {
    const g = {
      shading: {
        near: { totalLossPct: null },
        far: { totalLossPct: null, source: "UNAVAILABLE_NO_GPS" },
        combined: { totalLossPct: null },
        totalLossPct: null,
        shadingQuality: {
          confidence: "LOW",
          blockingReason: "missing_gps",
        },
      },
    };
    assert.equal(hasShadingNormalized(g), true);
  });

  it("rejette objet shading vide ou partiel sans enveloppe V2", () => {
    assert.equal(hasShadingNormalized({ shading: {} }), false);
    assert.equal(hasShadingNormalized({ shading: { near: {} } }), false);
  });

  it("accepte legacy nested.normalized", () => {
    assert.equal(
      hasShadingNormalized({
        shading: { normalized: { totalLossPct: 0 }, totalLossPct: 0 },
      }),
      true
    );
  });

  it("accepte KPI numérique seul à la racine", () => {
    assert.equal(hasShadingNormalized({ shading: { totalLossPct: 3.5 } }), true);
  });
});
