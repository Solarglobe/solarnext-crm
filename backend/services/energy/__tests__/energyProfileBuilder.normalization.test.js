/**
 * Tests de non-régression — normalisation W/Wh/kWh (energyProfileBuilder).
 * T1: CSV Enedis 30m en W → annual_kwh ~ 16400 (±2%)
 * T2: 30m en Wh → conversion Wh→kWh, annual correct
 * T3: déjà en kWh → pas de conversion
 * T4: 15m en W → *0.25/1000
 *
 * Usage: node backend/services/energy/__tests__/energyProfileBuilder.normalization.test.js
 *        ou depuis backend: node services/energy/__tests__/energyProfileBuilder.normalization.test.js
 */

import { buildEnergyProfile } from "../energyProfileBuilder.js";

const TOLERANCE_PCT = 2;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertApprox(actual, expected, msg, tolerancePct = TOLERANCE_PCT) {
  const tol = (expected * tolerancePct) / 100;
  if (Math.abs(actual - expected) > tol) {
    throw new Error(`${msg}: attendu ~${expected} (±${tolerancePct}%), reçu ${actual}`);
  }
}

function makeData(count, valueFn) {
  const start = new Date("2024-01-01T00:00:00+01:00").getTime();
  const step30m = 30 * 60 * 1000;
  const out = [];
  for (let i = 0; i < count; i++) {
    const ts = new Date(start + i * step30m).toISOString();
    out.push({ timestamp: ts, consumption_kwh: valueFn(i) });
  }
  return out;
}

function main() {
  const origNodeEnv = process.env.NODE_ENV;
  process.env.NODE_ENV = "development";

  console.log("=== energyProfileBuilder.normalization (W/Wh/kWh) ===\n");

  // T1: CSV Enedis 30m en W (valeurs typiques 100–8000 W) → annual_kwh ~ 16400
  {
    const POINTS_30M_YEAR = 17520;
    const TARGET_ANNUAL_KWH = 16400;
    const sumWatts = TARGET_ANNUAL_KWH * 2000;
    const meanW = sumWatts / POINTS_30M_YEAR;
    const data = makeData(POINTS_30M_YEAR, () => {
      const v = meanW * (0.3 + Math.random() * 1.4);
      return Math.max(100, Math.min(8000, v));
    });
    const out = buildEnergyProfile({ source: "enedis", interval: "30m", data });
    assertApprox(out.summary.annual_kwh, TARGET_ANNUAL_KWH, "T1 annual_kwh");
    if (out.summary.unit_detected) {
      assert(out.summary.unit_detected === "W_30m", "T1 unit_detected W_30m");
    }
    console.log("✅ T1: 30m en W → annual_kwh ~ 16400, unit_detected W_30m");
  }

  // T2: 30m en Wh (valeurs 0–4000 Wh), rawSum > 100000 → Wh→kWh
  {
    const POINTS_30M_YEAR = 17520;
    const TARGET_ANNUAL_KWH = 16400;
    const sumWh = TARGET_ANNUAL_KWH * 1000;
    const meanWh = sumWh / POINTS_30M_YEAR;
    const data = makeData(POINTS_30M_YEAR, () => meanWh * (0.5 + Math.random()));
    const out = buildEnergyProfile({ source: "switchgrid", interval: "30m", data });
    assertApprox(out.summary.annual_kwh, TARGET_ANNUAL_KWH, "T2 annual_kwh");
    if (out.summary.unit_detected) {
      assert(out.summary.unit_detected === "WH", "T2 unit_detected WH");
    }
    console.log("✅ T2: 30m en Wh → conversion Wh→kWh, unit_detected WH");
  }

  // T3: déjà en kWh (valeurs 0–4), pas de conversion
  {
    const POINTS_30M_YEAR = 17520;
    const TARGET_ANNUAL_KWH = 16400;
    const meanKwh = TARGET_ANNUAL_KWH / POINTS_30M_YEAR;
    const data = makeData(POINTS_30M_YEAR, () => meanKwh * (0.5 + Math.random()));
    const out = buildEnergyProfile({ source: "manual", interval: "30m", data });
    assertApprox(out.summary.annual_kwh, TARGET_ANNUAL_KWH, "T3 annual_kwh");
    if (out.summary.unit_detected) {
      assert(out.summary.unit_detected === "KWH", "T3 unit_detected KWH");
    }
    console.log("✅ T3: déjà kWh → pas de conversion, unit_detected KWH");
  }

  // T4: 15m en W → kWh = W * 0.25 / 1000
  {
    const POINTS_15M_YEAR = 35040;
    const TARGET_ANNUAL_KWH = 16400;
    const sumWatts = TARGET_ANNUAL_KWH * 4000;
    const meanW = sumWatts / POINTS_15M_YEAR;
    const start = new Date("2024-01-01T00:00:00+01:00").getTime();
    const step15m = 15 * 60 * 1000;
    const data = [];
    for (let i = 0; i < POINTS_15M_YEAR; i++) {
      const v = Math.max(200, Math.min(5000, meanW * (0.5 + Math.random())));
      data.push({
        timestamp: new Date(start + i * step15m).toISOString(),
        consumption_kwh: v,
      });
    }
    const out = buildEnergyProfile({ source: "enedis", interval: "15m", data });
    assertApprox(out.summary.annual_kwh, TARGET_ANNUAL_KWH, "T4 annual_kwh", 3);
    if (out.summary.unit_detected) {
      assert(out.summary.unit_detected === "W_15m", "T4 unit_detected W_15m");
    }
    console.log("✅ T4: 15m en W → *0.25/1000, unit_detected W_15m");
  }

  // T5: sanity check — annual_kwh > 200000 → summary.warning = UNREALISTIC_CONSUMPTION
  {
    const start = new Date("2024-01-01T00:00:00+01:00").getTime();
    const step1h = 60 * 60 * 1000;
    const data = [];
    for (let i = 0; i < 8760; i++) {
      data.push({
        timestamp: new Date(start + i * step1h).toISOString(),
        consumption_kwh: 23000,
      });
    }
    const out = buildEnergyProfile({ interval: "1h", data });
    assert(out.summary.annual_kwh > 200000, "T5 annual > 200000");
    assert(out.summary.warning === "UNREALISTIC_CONSUMPTION", "T5 warning");
    console.log("✅ T5: annual > 200000 → warning UNREALISTIC_CONSUMPTION");
  }

  process.env.NODE_ENV = origNodeEnv;
  console.log("\n--- Tous les tests normalization OK ---");
}

main();
