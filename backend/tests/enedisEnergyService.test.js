/**
 * CP-ENERGY-003 — Tests unitaires Enedis Energy Service
 *
 * - réponse API valide → profile correct
 * - réponse vide → data vide
 * - erreur API → profile fallback
 * - timeout → fallback
 *
 * Usage: node tests/enedisEnergyService.test.js
 */

import { fetchEnedisEnergyProfile } from "../services/energy/enedisEnergyService.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function assertApprox(a, b, msg, eps = 1e-6) {
  if (Math.abs(a - b) > eps) throw new Error(`${msg}: attendu ~${b}, reçu ${a}`);
}

async function main() {
  console.log("=== Tests enedisEnergyService (CP-ENERGY-003) ===\n");

  const usagePointId = "14295234567890";
  const start = "2024-03-01";
  const end = "2024-03-02";

  // 1) Réponse API valide → profile correct
  {
    const enedisResponse = {
      usage_point_id: usagePointId,
      meter_reading: {
        interval_reading: [
          { value: "420", date: "2024-03-01T00:00:00+01:00" },
          { value: "380", date: "2024-03-01T00:30:00+01:00" },
        ],
      },
    };
    const mockFetch = async () => ({
      ok: true,
      json: async () => enedisResponse,
    });
    const profile = await fetchEnedisEnergyProfile(
      { accessToken: "fake-token", usagePointId, start, end },
      { fetchFn: mockFetch }
    );
    assert(profile.source === "enedis", "1) source enedis");
    assert(profile.pdl === usagePointId, "1) pdl");
    assert(profile.interval === "30m", "1) interval");
    assert(profile.data.length === 2, "1) 2 points");
    assertApprox(profile.data[0].consumption_kwh, 0.42, "1) premier point");
    assertApprox(profile.summary.annual_kwh, 0.8, "1) annual 0.42+0.38");
    console.log("✅ 1) Réponse API valide → profile correct");
  }

  // 2) Réponse vide → data vide
  {
    const mockFetch = async () => ({
      ok: true,
      json: async () => ({ usage_point_id: usagePointId, meter_reading: { interval_reading: [] } }),
    });
    const profile = await fetchEnedisEnergyProfile(
      { accessToken: "fake", usagePointId, start, end },
      { fetchFn: mockFetch }
    );
    assert(profile.data.length === 0, "2) data vide");
    assert(profile.summary.annual_kwh === 0, "2) summary 0");
    assert(profile.pdl === usagePointId, "2) pdl conservé");
    console.log("✅ 2) Réponse vide → data vide");
  }

  // 3) Erreur API → profile fallback
  {
    const mockFetch = async () => ({ ok: false, status: 401, text: async () => "Unauthorized" });
    const profile = await fetchEnedisEnergyProfile(
      { accessToken: "bad", usagePointId, start, end },
      { fetchFn: mockFetch }
    );
    assert(profile.source === "enedis", "3) source enedis");
    assert(profile.data.length === 0, "3) fallback data vide");
    assert(profile.summary.annual_kwh === 0, "3) fallback summary 0");
    assert(profile.pdl === usagePointId, "3) pdl conservé");
    console.log("✅ 3) Erreur API → profile fallback");
  }

  // 4) Timeout → fallback
  {
    const mockFetch = async () => {
      await new Promise((_, reject) => setTimeout(() => reject(new Error("AbortError")), 0));
    };
    const profile = await fetchEnedisEnergyProfile(
      { accessToken: "fake", usagePointId, start, end },
      { fetchFn: mockFetch }
    );
    assert(profile.data.length === 0, "4) timeout → data vide");
    assert(profile.summary.annual_kwh === 0, "4) timeout → summary 0");
    console.log("✅ 4) Timeout → fallback");
  }

  // Erreur réseau (throw) → fallback
  {
    const mockFetch = async () => {
      throw new Error("ECONNREFUSED");
    };
    const profile = await fetchEnedisEnergyProfile(
      { accessToken: "x", usagePointId: "PDL", start, end },
      { fetchFn: mockFetch }
    );
    assert(profile.data.length === 0, "réseau → data vide");
    assert(profile.pdl === "PDL", "réseau → pdl conservé");
    console.log("✅ Erreur réseau → fallback");
  }

  console.log("\n--- Tous les tests enedisEnergyService OK ---");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
