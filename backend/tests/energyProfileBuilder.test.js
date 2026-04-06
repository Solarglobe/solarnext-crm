/**
 * CP-ENERGY-002 — Tests unitaires SolarNextEnergyProfile (energyProfileBuilder)
 *
 * - dataset simple → annual correct
 * - data vide → summary 0
 * - points invalides → ignorés
 * - max_interval correct
 * - interval 30m accepté
 *
 * Usage: node tests/energyProfileBuilder.test.js
 */

import { buildEnergyProfile } from "../services/energy/energyProfileBuilder.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertApprox(a, b, msg, eps = 1e-6) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: attendu ~${b}, reçu ${a}`);
}

function main() {
  console.log("=== Tests energyProfileBuilder (CP-ENERGY-002) ===\n");

  // 1) Dataset simple — annual correct
  {
    const data = [
      { timestamp: "2024-01-01T00:00:00+01:00", consumption_kwh: 1 },
      { timestamp: "2024-01-01T01:00:00+01:00", consumption_kwh: 2 },
      { timestamp: "2024-01-01T02:00:00+01:00", consumption_kwh: 3 },
    ];
    const out = buildEnergyProfile({ pdl: "PDL123", source: "enedis", interval: "1h", data });
    assert(out.pdl === "PDL123", "1) pdl");
    assert(out.source === "enedis", "1) source");
    assert(out.interval === "1h", "1) interval");
    assert(out.unit === "kWh", "1) unit");
    assert(out.timezone === "Europe/Paris", "1) timezone");
    assert(out.data.length === 3, "1) data length");
    assertApprox(out.summary.annual_kwh, 6, "1) annual_kwh (1+2+3)");
    assertApprox(out.summary.daily_average_kwh, 0.016, "1) daily_average_kwh (6/365 arrondi)");
    assertApprox(out.summary.max_interval_kwh, 3, "1) max_interval_kwh");
    console.log("✅ 1) Dataset simple — annual correct");
  }

  // 2) Data vide — summary 0
  {
    const out = buildEnergyProfile({ pdl: "X", source: "manual", data: [] });
    assert(out.data.length === 0, "2) data vide");
    assert(out.summary.annual_kwh === 0, "2) annual 0");
    assert(out.summary.daily_average_kwh === 0, "2) daily_average 0");
    assert(out.summary.max_interval_kwh === 0, "2) max_interval 0");
    console.log("✅ 2) Data vide — summary 0");
  }

  // 3) Points invalides — ignorés
  {
    const data = [
      { timestamp: "2024-01-01T00:00:00+01:00", consumption_kwh: 10 },
      null,
      { consumption_kwh: 5 },
      { timestamp: "2024-01-01T01:00:00+01:00" },
      { timestamp: "2024-01-01T02:00:00+01:00", consumption_kwh: -1 },
      { timestamp: "2024-01-01T03:00:00+01:00", consumption_kwh: 20 },
    ];
    const out = buildEnergyProfile({ pdl: "P", source: "manual", data });
    assert(out.data.length === 2, "3) seuls 2 points valides (10 et 20)");
    assertApprox(out.summary.annual_kwh, 30, "3) annual 30");
    assertApprox(out.summary.max_interval_kwh, 20, "3) max 20");
    console.log("✅ 3) Points invalides ignorés");
  }

  // 4) max_interval correct
  {
    const data = [
      { timestamp: "2024-01-01T00:00:00+01:00", consumption_kwh: 0.5 },
      { timestamp: "2024-01-01T01:00:00+01:00", consumption_kwh: 2.4 },
      { timestamp: "2024-01-01T02:00:00+01:00", consumption_kwh: 1.1 },
    ];
    const out = buildEnergyProfile({ pdl: "M", source: "enedis", interval: "30m", data });
    assertApprox(out.summary.max_interval_kwh, 2.4, "4) max_interval 2.4");
    assertApprox(out.summary.annual_kwh, 4, "4) annual 4");
    console.log("✅ 4) max_interval correct");
  }

  // 5) interval 30m accepté
  {
    const data = [{ timestamp: "2024-03-01T00:00:00+01:00", consumption_kwh: 0.42 }];
    const out = buildEnergyProfile({ pdl: "14295234567890", source: "enedis", interval: "30m", data });
    assert(out.interval === "30m", "5) interval 30m");
    assert(out.data[0].consumption_kwh === 0.42, "5) point conservé");
    console.log("✅ 5) interval 30m accepté");
  }

  // Tri chronologique
  {
    const data = [
      { timestamp: "2024-01-01T02:00:00+01:00", consumption_kwh: 3 },
      { timestamp: "2024-01-01T00:00:00+01:00", consumption_kwh: 1 },
      { timestamp: "2024-01-01T01:00:00+01:00", consumption_kwh: 2 },
    ];
    const out = buildEnergyProfile({ data });
    assert(out.data[0].timestamp === "2024-01-01T00:00:00+01:00", "tri premier");
    assert(out.data[2].timestamp === "2024-01-01T02:00:00+01:00", "tri dernier");
    console.log("✅ Tri chronologique");
  }

  // Source / interval invalides → valeurs par défaut
  {
    const out = buildEnergyProfile({ source: "unknown", interval: "invalid", data: [] });
    assert(out.source === "manual", "source invalide → manual");
    assert(out.interval === "30m", "interval invalide → 30m");
    console.log("✅ Source/interval invalides → défaut");
  }

  console.log("\n--- Tous les tests energyProfileBuilder OK ---");
}

main();
