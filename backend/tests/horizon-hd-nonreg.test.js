/**
 * CP-FAR-009 — Non-régression RELIEF_ONLY, SURFACE_DSM, SURFACE_DSM+HD
 */

import { computeHorizonMaskReliefOnly } from "../services/horizon/horizonMaskCore.js";
import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";

let passed = 0;
let failed = 0;

function ok(label) {
  console.log("✅ " + label);
  passed++;
}

function fail(label, msg) {
  console.log("❌ " + label + ": " + msg);
  failed++;
}

function assert(cond, label, msg) {
  if (cond) ok(label);
  else fail(label, msg || "assertion failed");
}

async function main() {
  const params = { lat: 48.8566, lon: 2.3522, radius_m: 500, step_deg: 2 };

  // A) RELIEF_ONLY strictement identique (DSM disabled)
  process.env.HORIZON_DSM_ENABLED = "false";
  const relief = computeHorizonMaskReliefOnly(params);
  assert(relief.source === "RELIEF_ONLY", "A) RELIEF_ONLY source");
  assert(relief.mask.length === 180, "A) mask.length 180");
  assert(relief.resolution_m === 25, "A) resolution_m 25");

  const autoRelief = await computeHorizonMaskAuto(params);
  assert(autoRelief.source === "RELIEF_ONLY", "A) auto RELIEF_ONLY");
  assert(
    JSON.stringify(autoRelief.mask) === JSON.stringify(relief.mask),
    "A) auto mask === relief mask (snapshot)"
  );

  // B) DSM activé mais terrain non prêt (STUB) → relief-only honnête (POINT 6D)
  process.env.HORIZON_DSM_ENABLED = "true";
  process.env.DSM_PROVIDER_TYPE = "STUB";
  const dsmStub = await computeHorizonMaskAuto({ ...params, enableHD: false });
  assert(dsmStub.source === "RELIEF_ONLY", "B) STUB sans terrain réel → RELIEF_ONLY");
  assert(dsmStub.mask.length === 180, "B) mask.length 180");
  assert(!dsmStub.meta || dsmStub.meta.algorithm !== "RAYCAST_HD", "B) pas RAYCAST_HD");

  // C) idem enableHD : pas de stub synthétique si terrain non prêt
  process.env.DSM_PROVIDER_TYPE = "STUB";
  const dsmHd = await computeHorizonMaskAuto({ ...params, enableHD: true });
  assert(dsmHd.source === "RELIEF_ONLY", "C) STUB+HD → RELIEF_ONLY (terrain réel requis pour SURFACE_DSM)");
  assert(dsmHd.mask.length >= 180, "C) mask cohérent");
  ok("C) enableHD+STUB sans config terrain → relief-only");

  // D) step_deg 0.5 validé (validation étendue)
  const relief05 = computeHorizonMaskReliefOnly({ ...params, step_deg: 0.5 });
  assert(relief05.mask.length === 720, "D) step_deg 0.5 => 720 bins");

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
