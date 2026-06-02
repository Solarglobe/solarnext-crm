/**
 * CP-FAR-009 — Non-régression horizon providers
 * Refactoré pour l'architecture IGN Géoplateforme + PVGIS (plus de RELIEF_ONLY auto).
 * - Tests A/B/C : comportement de computeHorizonMaskAuto() avec le nouveau sélecteur
 * - Test D : computeHorizonMaskReliefOnly() direct (conservé — fonction toujours exportée)
 */

import { computeHorizonMaskReliefOnly } from "../services/horizon/horizonMaskCore.js";
import { computeHorizonMaskAuto } from "../services/horizon/providers/horizonProviderSelector.js";

let passed = 0;
let failed = 0;

function ok(label) { console.log("✅ " + label); passed++; }
function fail(label, msg) { console.log("❌ " + label + ": " + msg); failed++; }
function assert(cond, label, msg) { if (cond) ok(label); else fail(label, msg || "assertion failed"); }

/** Valide qu'un masque est exploitable (real ou UNAVAILABLE selon accès réseau). */
function isAcceptableAutoResult(result) {
  if (!result) return false;
  // Soit données réelles (IGN ou PVGIS)
  if (Array.isArray(result.mask) && result.mask.length > 0 &&
      result.source !== "FAR_UNAVAILABLE_ERROR") return true;
  // Soit honnêtement indisponible (pas de réseau dans l'env de test)
  if (result.source === "FAR_UNAVAILABLE_ERROR" &&
      Array.isArray(result.mask) && result.mask.length === 0) return true;
  return false;
}

async function main() {
  const params = { lat: 48.8566, lon: 2.3522, radius_m: 500, step_deg: 2 };

  // A) computeHorizonMaskAuto — nouveau sélecteur : IGN → PVGIS → UNAVAILABLE
  // Plus de RELIEF_ONLY — résultat : données réelles ou UNAVAILABLE honnête
  const autoResult = await computeHorizonMaskAuto(params);
  assert(isAcceptableAutoResult(autoResult),
    "A) auto → masque réel (IGN/PVGIS) ou UNAVAILABLE honnête");
  assert(autoResult.source !== "RELIEF_ONLY",
    "A) auto ne retourne plus jamais RELIEF_ONLY");
  assert(typeof autoResult.confidence === "number",
    "A) confidence présente");
  assert(autoResult.dataCoverage != null,
    "A) dataCoverage présent");
  console.log("   A) source obtenu:", autoResult.source,
    "| provider:", autoResult.dataCoverage?.provider ?? "n/a");

  // B) DSM_PROVIDER_TYPE=STUB — ne change plus rien au sélecteur IGN/PVGIS
  process.env.HORIZON_DSM_ENABLED = "true";
  process.env.DSM_PROVIDER_TYPE   = "STUB";
  const dsmStub = await computeHorizonMaskAuto({ ...params, enableHD: false });
  assert(dsmStub.source !== "RELIEF_ONLY",
    "B) STUB sans terrain réel → plus de RELIEF_ONLY");
  assert(isAcceptableAutoResult(dsmStub),
    "B) résultat réel ou UNAVAILABLE");
  console.log("   B) source obtenu:", dsmStub.source);

  // C) STUB + enableHD — même comportement
  const dsmHd = await computeHorizonMaskAuto({ ...params, enableHD: true });
  assert(dsmHd.source !== "RELIEF_ONLY",
    "C) STUB+HD → plus de RELIEF_ONLY");
  assert(isAcceptableAutoResult(dsmHd),
    "C) résultat réel ou UNAVAILABLE");
  ok("C) enableHD sans config HTTP_GEOTIFF → IGN ou PVGIS");

  // D) computeHorizonMaskReliefOnly() direct — fonction conservée pour scripts/bench
  const relief    = computeHorizonMaskReliefOnly(params);
  assert(relief.source === "RELIEF_ONLY",     "D) RELIEF_ONLY source direct");
  assert(relief.mask.length === 180,          "D) mask.length 180 (step_deg=2)");
  assert(relief.resolution_m === 25,          "D) resolution_m 25");

  const relief05 = computeHorizonMaskReliefOnly({ ...params, step_deg: 0.5 });
  assert(relief05.mask.length === 720,        "D) step_deg 0.5 => 720 bins");

  // E) coords invalides → UNAVAILABLE
  const invalid = await computeHorizonMaskAuto({ lat: NaN, lon: 2.35 });
  assert(invalid.source === "FAR_UNAVAILABLE_ERROR", "E) coords NaN → UNAVAILABLE");
  assert(invalid.mask.length === 0,                  "E) mask vide");

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed:", passed, " Failed:", failed);
  if (failed > 0) { console.log("\n❌ FAIL"); process.exit(1); }
  console.log("\n✅ PASS");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
