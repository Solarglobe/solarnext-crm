/**
 * Résolution shading global pour snapshot / PDF.
 * Usage: node backend/tests/resolveShadingTotalLossPct.test.js
 */

import { resolveShadingTotalLossPct } from "../services/shading/resolveShadingTotalLossPct.js";

let passed = 0;
let failed = 0;
function ok(l) {
  console.log("✅ " + l);
  passed++;
}
function fail(l, m) {
  console.log("❌ " + l + ": " + m);
  failed++;
}
function assert(c, l, m) {
  if (c) ok(l);
  else fail(l, m || "");
}

assert(resolveShadingTotalLossPct(null, null) == null, "vide → null");

assert(
  resolveShadingTotalLossPct({ combined: { totalLossPct: 9 } }, {}) === 9,
  "priorité 1 : combined.totalLossPct (vérité officielle)"
);

assert(
  resolveShadingTotalLossPct({ total_loss_pct: 7.5, combined: { totalLossPct: 4 } }, {}) === 4,
  "combined bat total_loss_pct racine (anti-divergence)"
);

assert(
  resolveShadingTotalLossPct({ total_loss_pct: 7.5 }, {}) === 7.5,
  "legacy snake seul → total_loss_pct"
);

assert(
  resolveShadingTotalLossPct({ totalLossPct: 8 }, {}) === 8,
  "legacy camel seul → totalLossPct"
);

assert(
  resolveShadingTotalLossPct({}, { installation: { shading_loss_pct: 10 } }) === 10,
  "form.installation.shading_loss_pct si pas de shading numérique"
);

assert(
  resolveShadingTotalLossPct({}, { shadingLossPct: 11 }) === 11,
  "form.shadingLossPct en dernier recours"
);

assert(
  resolveShadingTotalLossPct({ totalLossPct: 1 }, { shadingLossPct: 99 }) === 1,
  "racine camel bat form si pas de combined"
);

assert(
  resolveShadingTotalLossPct({ combined: { totalLossPct: 5 } }, { installation: { shading_loss_pct: 99 } }) === 5,
  "combined bat installation même si form a une autre valeur"
);

assert(
  resolveShadingTotalLossPct({ combined: { totalLossPct: null } }, { installation: { shading_loss_pct: 10 } }) === null,
  "combined null explicite → null (pas de fallback form silencieux)"
);

assert(
  resolveShadingTotalLossPct(
    { far: { source: "UNAVAILABLE_NO_GPS" }, combined: { totalLossPct: 5 } },
    { installation: { shading_loss_pct: 10 } }
  ) === null,
  "GPS / far indisponible → null même si combined chiffré (cohérence état)"
);

assert(
  resolveShadingTotalLossPct({ total_loss_pct: 0 }, { shadingLossPct: 50 }) === 0,
  "0% est une valeur valide (racine)"
);

console.log("\nPassed: " + passed + ", Failed: " + failed);
if (failed > 0) process.exit(1);
process.exit(0);
