/**
 * Tests unitaires buildPilotedProfile — conservation énergie, pas de valeurs négatives, longueur 8760.
 * Usage: node backend/services/pilotage/tests/buildPilotedProfile.test.js
 */

import { buildPilotedProfile } from "../../pilotageService.js";

const HOURS = 8760;

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function sum(arr) {
  return arr.reduce((a, b) => a + b, 0);
}

/** PV réaliste : forme jour (pic 12h) répétée sur 365 j */
function makeRealisticPv8760() {
  const pv = [];
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  let idx = 0;
  for (let m = 0; m < 12; m++) {
    const days = daysInMonth[m];
    for (let d = 0; d < days; d++) {
      for (let h = 0; h < 24; h++) {
        const solar = h >= 8 && h <= 18 ? 1 : 0;
        const shape = solar * (1 - Math.abs(h - 13) / 6);
        pv[idx++] = Math.max(0, shape * (0.3 + Math.random() * 0.4));
      }
    }
  }
  return pv.slice(0, HOURS);
}

function main() {
  console.log("=== buildPilotedProfile tests ===\n");

  // TEST 1 — Conservation énergie : profil constant 0.5 kWh, PV réaliste
  {
    const conso = Array(HOURS).fill(0.5);
    const pv = makeRealisticPv8760();
    const totalInput = sum(conso);
    const out = buildPilotedProfile(conso, pv);
    const output = out.conso_pilotee_hourly;
    const totalOutput = sum(output);
    assert(Array.isArray(output), "T1: output is array");
    assert(Math.abs(totalOutput - totalInput) <= 0.001, `T1: sum(output) ≈ sum(input) — got ${totalOutput} vs ${totalInput}`);
    console.log("✅ TEST 1 — Conservation énergie : sum(output) ≈ sum(input)");
  }

  // TEST 2 — Aucune valeur négative (profil faible + correction négative possible)
  {
    const conso = Array(HOURS).fill(0.2);
    const pv = Array(HOURS).fill(0);
    const out = buildPilotedProfile(conso, pv);
    const output = out.conso_pilotee_hourly;
    const minVal = Math.min(...output);
    assert(minVal >= 0, `T2: min(output) >= 0 — got ${minVal}`);
    console.log("✅ TEST 2 — Aucune valeur négative : min(output) =", minVal);
  }

  // TEST 3 — Longueur tableau
  {
    const conso = Array(HOURS).fill(0.5);
    const pv = makeRealisticPv8760();
    const out = buildPilotedProfile(conso, pv);
    const output = out.conso_pilotee_hourly;
    assert(output.length === 8760, `T3: output.length === 8760 — got ${output.length}`);
    console.log("✅ TEST 3 — Longueur tableau : output.length === 8760");
  }

  // TEST 4 — Conservation avec profil hétérogène
  {
    const conso = [];
    for (let i = 0; i < HOURS; i++) {
      const hour = i % 24;
      conso.push(hour >= 18 || hour < 7 ? 0.8 : 0.3);
    }
    const totalInput = sum(conso);
    const pv = makeRealisticPv8760();
    const out = buildPilotedProfile(conso, pv);
    const totalOutput = sum(out.conso_pilotee_hourly);
    assert(Math.abs(totalOutput - totalInput) <= 0.001, `T4: conservation — got ${totalOutput} vs ${totalInput}`);
    const minVal = Math.min(...out.conso_pilotee_hourly);
    assert(minVal >= 0, `T4: no negative — got min ${minVal}`);
    console.log("✅ TEST 4 — Conservation + pas de négatif (profil hétérogène)");
  }

  console.log("\n--- Tous les tests buildPilotedProfile OK ---");
}

main();
