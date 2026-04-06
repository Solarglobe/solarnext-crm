/**
 * CP-ENERGY-001 — Tests unitaires normaliseur Enedis Load Curve
 *
 * Garde-fou : value > 10000 → traité en Wh (kWh = value/1000).
 * value <= 10000 → laissé tel quel pour détection par le builder.
 *
 * 1) meter_reading objet (valeurs ≤10000 → pass-through)
 * 2) meter_reading tableau
 * 3) value null (ignorer)
 * 4) tri chronologique
 * 5) valeurs ≤10000 pass-through
 * 6) value > 10000 → conversion Wh → kWh
 *
 * Usage: node tests/enedisNormalizer.test.js
 */

import { normalizeEnedisLoadCurve } from "../services/energy/enedisNormalizer.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertEqual(a, b, msg) {
  if (a !== b) throw new Error(`${msg}: attendu ${b}, reçu ${a}`);
}

function assertApprox(a, b, msg, eps = 1e-9) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: attendu ~${b}, reçu ${a}`);
}

function main() {
  console.log("=== Tests enedisNormalizer (CP-ENERGY-001) ===\n");

  // 1) meter_reading objet
  {
    const enedis = {
      usage_point_id: "14295234567890",
      meter_reading: {
        interval_reading: [
          { value: "420", date: "2024-03-01T00:00:00+01:00" },
          { value: "380", date: "2024-03-01T00:30:00+01:00" },
        ],
      },
    };
    const out = normalizeEnedisLoadCurve(enedis);
    assert(out.pdl === "14295234567890", "1) pdl");
    assert(out.interval === "30m", "1) interval");
    assert(out.unit === "kWh", "1) unit");
    assert(out.data.length === 2, "1) data length");
    assert(out.data[0].timestamp === "2024-03-01T00:00:00+01:00", "1) timestamp conservé");
    assertApprox(out.data[0].consumption_kwh, 420, "1) 420 ≤10000 → pass-through");
    assertApprox(out.data[1].consumption_kwh, 380, "1) 380 ≤10000 → pass-through");
    console.log("✅ 1) meter_reading objet");
  }

  // 2) meter_reading tableau
  {
    const enedis = {
      usage_point_id: "14295234567890",
      meter_reading: [
        {
          interval_reading: [
            { value: "100", date: "2024-03-01T00:00:00+01:00" },
            { value: "200", date: "2024-03-01T00:30:00+01:00" },
          ],
        },
      ],
    };
    const out = normalizeEnedisLoadCurve(enedis);
    assert(out.pdl === "14295234567890", "2) pdl");
    assert(out.data.length === 2, "2) data length");
    assertApprox(out.data[0].consumption_kwh, 100, "2) 100 ≤10000 → pass-through");
    assertApprox(out.data[1].consumption_kwh, 200, "2) 200 ≤10000 → pass-through");
    console.log("✅ 2) meter_reading tableau");
  }

  // 3) value null — ignorer l'intervalle
  {
    const enedis = {
      usage_point_id: "PDL123",
      meter_reading: {
        interval_reading: [
          { value: "500", date: "2024-03-01T00:00:00+01:00" },
          { value: null, date: "2024-03-01T00:30:00+01:00" },
          { value: "600", date: "2024-03-01T01:00:00+01:00" },
        ],
      },
    };
    const out = normalizeEnedisLoadCurve(enedis);
    assert(out.data.length === 2, "3) null ignoré, 2 points");
    assertApprox(out.data[0].consumption_kwh, 500, "3) 500 ≤10000 → pass-through");
    assertApprox(out.data[1].consumption_kwh, 600, "3) 600 ≤10000 → pass-through");
    console.log("✅ 3) value null ignoré");
  }

  // 4) tri chronologique
  {
    const enedis = {
      usage_point_id: "PDL",
      meter_reading: {
        interval_reading: [
          { value: "1", date: "2024-03-01T02:00:00+01:00" },
          { value: "2", date: "2024-03-01T00:00:00+01:00" },
          { value: "3", date: "2024-03-01T01:00:00+01:00" },
        ],
      },
    };
    const out = normalizeEnedisLoadCurve(enedis);
    assert(out.data[0].timestamp === "2024-03-01T00:00:00+01:00", "4) premier = 00:00");
    assert(out.data[1].timestamp === "2024-03-01T01:00:00+01:00", "4) deuxième = 01:00");
    assert(out.data[2].timestamp === "2024-03-01T02:00:00+01:00", "4) troisième = 02:00");
    assertApprox(out.data[0].consumption_kwh, 2, "4) valeur 2 ≤10000 → pass-through");
    assertApprox(out.data[1].consumption_kwh, 3, "4) valeur 3 ≤10000 → pass-through");
    assertApprox(out.data[2].consumption_kwh, 1, "4) valeur 1 ≤10000 → pass-through");
    console.log("✅ 4) tri chronologique");
  }

  // 5) valeurs ≤10000 → pass-through (builder fera la détection)
  {
    const enedis = {
      usage_point_id: "X",
      meter_reading: {
        interval_reading: [
          { value: 1000, date: "2024-03-01T00:00:00+01:00" },
          { value: "2500", date: "2024-03-01T00:30:00+01:00" },
        ],
      },
    };
    const out = normalizeEnedisLoadCurve(enedis);
    assertApprox(out.data[0].consumption_kwh, 1000, "5) 1000 ≤10000 → pass-through");
    assertApprox(out.data[1].consumption_kwh, 2500, "5) 2500 ≤10000 → pass-through");
    console.log("✅ 5) pass-through ≤10000");
  }

  // 6) value > 10000 → conversion Wh → kWh
  {
    const enedis = {
      usage_point_id: "Y",
      meter_reading: {
        interval_reading: [
          { value: 15000, date: "2024-03-01T00:00:00+01:00" },
          { value: "50000", date: "2024-03-01T00:30:00+01:00" },
        ],
      },
    };
    const out = normalizeEnedisLoadCurve(enedis);
    assertApprox(out.data[0].consumption_kwh, 15, "6) 15000 Wh = 15 kWh");
    assertApprox(out.data[1].consumption_kwh, 50, "6) 50000 Wh = 50 kWh");
    console.log("✅ 6) conversion Wh → kWh (value > 10000)");
  }

  // Robustesse : entrée nulle / invalide
  {
    assert(normalizeEnedisLoadCurve(null).data.length === 0, "robustesse null");
    assert(normalizeEnedisLoadCurve(undefined).data.length === 0, "robustesse undefined");
    assert(normalizeEnedisLoadCurve({}).data.length === 0, "robustesse {}");
    assert(normalizeEnedisLoadCurve({ meter_reading: {} }).data.length === 0, "robustesse meter_reading vide");
    assert(normalizeEnedisLoadCurve({ usage_point_id: 123 }).pdl === "", "robustesse usage_point_id non string");
    console.log("✅ Robustesse (pas de crash)");
  }

  console.log("\n--- Tous les tests enedisNormalizer OK ---");
}

main();
