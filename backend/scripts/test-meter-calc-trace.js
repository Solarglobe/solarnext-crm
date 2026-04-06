/**
 * Traçabilité calcul multi-compteurs — diff snapshots (Prompt traçabilité).
 * Usage: cd backend && node scripts/test-meter-calc-trace.js
 */

import { buildMeterCalcDiffLinesFr } from "../services/studyMeterSnapshot.service.js";

let passed = 0;
let failed = 0;

function ok(msg) {
  passed++;
  console.log(`  ✔ ${msg}`);
}
function fail(msg, detail) {
  failed++;
  console.log(`  ✖ ${msg}`, detail || "");
}

function baseSnap(over = {}) {
  return {
    selected_meter_id: "m1",
    name: "Compteur A",
    consumption_mode: "ANNUAL",
    consumption_annual_kwh: 5000,
    consumption_annual_calculated_kwh: null,
    meter_power_kva: 6,
    grid_type: "mono",
    hp_hc: false,
    supplier_name: "EDF",
    tariff_type: "BASE",
    energy_profile_has_hourly: false,
    consumption_profile: "active",
    consumption_pdl: "PDL1",
    equipement_actuel: "VE",
    equipements_a_venir_json: null,
    ...over,
  };
}

function run() {
  console.log("\n=== Traçabilité diff snapshots compteur ===\n");

  // TEST 1 — premier calcul : pas de diff côté service (pas de prev) — UI gère le libellé
  const noPrev = buildMeterCalcDiffLinesFr(null, baseSnap());
  if (noPrev.length === 0) ok("TEST 1 — sans snapshot précédent : diff vide (attendu)");
  else fail("TEST 1", noPrev);

  // TEST 2 — identique
  const a = baseSnap();
  const b = baseSnap();
  const same = buildMeterCalcDiffLinesFr(a, b);
  if (same.length === 0) ok("TEST 2 — deux snapshots identiques → aucune ligne");
  else fail("TEST 2", same);

  // TEST 3 — conso
  const c3 = buildMeterCalcDiffLinesFr(baseSnap(), baseSnap({ consumption_annual_kwh: 9000 }));
  if (c3.some((l) => l.includes("Consommation annuelle modifiée"))) ok("TEST 3 — changement conso annuelle détecté");
  else fail("TEST 3", c3);

  // TEST 4 — équipement
  const c4 = buildMeterCalcDiffLinesFr(baseSnap(), baseSnap({ equipement_actuel: null }));
  if (c4.some((l) => l.includes("Équipement actuel"))) ok("TEST 4 — équipement actuel");
  else fail("TEST 4", c4);

  // TEST 5 — changement compteur
  const c5 = buildMeterCalcDiffLinesFr(
    baseSnap({ selected_meter_id: "m1", name: "A" }),
    baseSnap({ selected_meter_id: "m2", name: "B" })
  );
  if (c5.some((l) => l.includes("Compteur utilisé modifié"))) ok("TEST 5 — changement compteur");
  else fail("TEST 5", c5);

  // TEST 6 — legacy partial (champs manquants)
  const c6 = buildMeterCalcDiffLinesFr(
    { name: "X", consumption_annual_kwh: 100 },
    { name: "X", consumption_annual_kwh: 100 }
  );
  if (c6.length === 0) ok("TEST 6 — snapshots partiels stables → pas de faux positifs");
  else fail("TEST 6", c6);

  console.log(`\nRésultat: ${passed} OK, ${failed} échecs\n`);
  process.exitCode = failed > 0 ? 1 : 0;
}

run();
