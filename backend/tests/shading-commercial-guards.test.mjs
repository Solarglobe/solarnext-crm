import { test } from "node:test";
import assert from "node:assert/strict";
import { computeCalpinageShading } from "../services/shading/calpinageShading.service.js";
import { auditMultiPanShadingMismatch } from "../services/shading/shadingCommercialAudit.service.js";
import {
  buildCalculationConfidenceFromCalc,
  isPdfBlockedByConfidence,
} from "../services/calculationConfidence.service.js";
import { resolveShadingTotalLossPct } from "../services/shading/resolveShadingTotalLossPct.js";

test("computeCalpinageShading : échec horizon → FAR_UNAVAILABLE_ERROR, farLossPct null", async () => {
  const geometry = {
    frozenBlocks: [
      {
        id: "b1",
        panels: [
          {
            id: "p-0",
            polygonPx: [
              { x: 0, y: 0 },
              { x: 10, y: 0 },
              { x: 10, y: 10 },
              { x: 0, y: 10 },
            ],
          },
        ],
      },
    ],
  };
  const r = await computeCalpinageShading({
    lat: 48.8566,
    lon: 2.3522,
    geometry,
    options: {
      __testForceHorizonFailure: true,
      strictCommercialShading: true,
    },
  });
  assert.equal(r.farHorizonStatus, "FAR_UNAVAILABLE_ERROR");
  assert.equal(r.farLossPct, null);
  assert.equal(r.farShadingUnavailable, true);
  assert.ok(Number.isFinite(r.nearLossPct));
  assert.ok(Array.isArray(r.geometryCommercialWarnings));
  assert.ok(r.geometryCommercialWarnings.includes("SHADING_SCALE_MISSING"));
});

test("auditMultiPanShadingMismatch : pans à 0 % vs serveur > 0 → BLOCK", () => {
  const pans = [{ id: "p-0", panelCount: 10, shadingCombinedPct: 0 }];
  const breakdown = Array.from({ length: 10 }, (_, i) => ({
    panelId: `p-0_${i}`,
    lossPct: 12,
  }));
  const m = auditMultiPanShadingMismatch(pans, breakdown, 0);
  assert.equal(m.status, "BLOCK");
  assert.ok(m.absDiff >= 8);
});

test("auditMultiPanShadingMismatch : valeurs alignées → OK", () => {
  const pans = [{ id: "p-0", panelCount: 2, shadingCombinedPct: 5 }];
  const breakdown = [
    { panelId: "p-0_0", lossPct: 5 },
    { panelId: "p-0_1", lossPct: 5 },
  ];
  const m = auditMultiPanShadingMismatch(pans, breakdown, 5);
  assert.equal(m.status, "OK");
});

test("calculation_confidence : audit commercial bloque le PDF", () => {
  const ctx = {
    meta: {
      shading_commercial_audit: {
        blocking_warnings: ["FAR_SHADING_UNAVAILABLE_BLOCK_PDF"],
        non_blocking_warnings: ["FAR_SHADING_UNAVAILABLE"],
        flags: { farHorizonUnavailable: true },
      },
    },
    form: { installation: { shading: {} }, economics: null },
    pv: { source: "PVGIS" },
    settings: { economics: {} },
    virtual_battery_input: { enabled: false },
  };
  const cc = buildCalculationConfidenceFromCalc(ctx, {});
  assert.ok(cc.blocking_warnings.includes("FAR_SHADING_UNAVAILABLE_BLOCK_PDF"));
  assert.ok(isPdfBlockedByConfidence(cc));
  assert.equal(cc.assumptions.far_shading_unavailable, true);
});

test("resolveShadingTotalLossPct : FAR indisponible → null (pas repli 0)", () => {
  const shading = {
    far: { source: "FAR_UNAVAILABLE_ERROR", totalLossPct: null },
    combined: { totalLossPct: 4.2 },
    shadingQuality: { farShadingUnavailable: true },
  };
  const v = resolveShadingTotalLossPct(shading, {
    installation: { shading_loss_pct: 4.2 },
    shadingLossPct: 4.2,
  });
  assert.equal(v, null);
});
