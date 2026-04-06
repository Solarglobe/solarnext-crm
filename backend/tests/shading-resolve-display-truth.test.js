/**
 * PDF / snapshot : resolveShadingTotalLossPct délègue à getOfficialGlobalShadingLossPct
 * avec mêmes garde-fous GPS et combined null — docs/shading-kpi-contract.md
 * Enchaîné par npm run test:shading:lock
 */

import assert from "assert";
import { resolveShadingTotalLossPct } from "../services/shading/resolveShadingTotalLossPct.js";

function testCombinedWinsOverForm() {
  const v = resolveShadingTotalLossPct(
    { combined: { totalLossPct: 8.2 }, totalLossPct: 8.2, far: { source: "RELIEF_ONLY" } },
    { installation: { shading_loss_pct: 99 } }
  );
  assert.strictEqual(v, 8.2);
}

function testExplicitCombinedNullIgnoresForm() {
  const v = resolveShadingTotalLossPct(
    {
      combined: { totalLossPct: null },
      far: { source: "RELIEF_ONLY" },
    },
    { installation: { shading_loss_pct: 15 } }
  );
  assert.strictEqual(v, null);
}

function testGpsBlockIgnoresForm() {
  const v = resolveShadingTotalLossPct(
    {
      far: { source: "UNAVAILABLE_NO_GPS" },
      combined: { totalLossPct: 5 },
    },
    { installation: { shading_loss_pct: 12 } }
  );
  assert.strictEqual(v, null);
}

function testFormFallbackWhenNoShadingCombined() {
  const v = resolveShadingTotalLossPct({}, { installation: { shading_loss_pct: 11 } });
  assert.strictEqual(v, 11);
}

let failed = 0;
function run(name, fn) {
  try {
    fn();
    console.log("✅ resolve-display-truth: " + name);
  } catch (e) {
    failed++;
    console.error("❌ resolve-display-truth: " + name, e.message);
  }
}

run("combined l’emporte sur formulaire", testCombinedWinsOverForm);
run("combined.totalLossPct null explicite → pas de repli form", testExplicitCombinedNullIgnoresForm);
run("GPS bloqué → null même si form", testGpsBlockIgnoresForm);
run("repli form si shading vide", testFormFallbackWhenNoShadingCombined);

if (failed > 0) {
  console.error("\n--- shading-resolve-display-truth FAILED ---\n");
  process.exit(1);
}
console.log("\n--- shading-resolve-display-truth OK ---\n");
