/**
 * CP-ENERGY-001 — Tests unitaires normaliseur Enedis Load Curve
 *
 * Comportement : API Enedis envoie toujours des Wh → toujours ÷ 1000 pour obtenir kWh.
 * Pas de seuil conditionnel — la division est systématique quelle que soit la valeur.
 *
 * 1) meter_reading objet
 * 2) meter_reading tableau
 * 3) value null (ignorer)
 * 4) tri chronologique
 * 5) valeurs Wh → kWh (÷1000)
 * 6) grandes valeurs Wh → kWh (÷1000)
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
    assertApprox(out.data[0].consumption_kwh, 0.42, "1) 420 Wh ÷ 1000 = 0.42 kWh");
    assertApprox(out.data[1].consumption_kwh, 0.38, "1) 380 Wh ÷ 1000 = 0.38 kWh");
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
    assertApprox(out.data[0].consumption_kwh, 0.1, "2) 100 Wh ÷ 1000 = 0.1 kWh");
    assertApprox(out.data[1].consumption_kwh, 0.2, "2) 200 Wh ÷ 1000 = 0.2 kWh");
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
    assertApprox(out.data[0].consumption_kwh, 0.5, "3) 500 Wh ÷ 1000 = 0.5 kWh");
    assertApprox(out.data[1].consumption_kwh, 0.6, "3) 600 Wh ÷ 1000 = 0.6 kWh");
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
    assertApprox(out.data[0].consumption_kwh, 0.002, "4) valeur 2 Wh ÷ 1000 = 0.002 kWh");
    assertApprox(out.data[1].consumption_kwh, 0.003, "4) valeur 3 Wh ÷ 1000 = 0.003 kWh");
    assertApprox(out.data[2].consumption_kwh, 0.001, "4) valeur 1 Wh ÷ 1000 = 0.001 kWh");
    console.log("✅ 4) tri chronologique");
  }

  // 5) valeurs Wh → kWh (÷ 1000, même pour petites valeurs)
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
    assertApprox(out.data[0].consumption_kwh, 1.0, "5) 1000 Wh ÷ 1000 = 1.0 kWh");
    assertApprox(out.data[1].consumption_kwh, 2.5, "5) 2500 Wh ÷ 1000 = 2.5 kWh");
    console.log("✅ 5) Wh → kWh (÷1000)");
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
