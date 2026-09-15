/**
 * Résolution shading global pour snapshot / PDF.
 * Usage: node backend/tests/resolveShadingTotalLossPct.test.js
 */

import { resolveShadingTotalLossPct } from "../services/shading/resolveShadingTotalLossPct.js";

import { assessedShading } from './fixtures/assessedShading.js';
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
  resolveShadingTotalLossPct(assessedShading(9), {}) === 9,
  "priorité 1 : combined.totalLossPct (vérité officielle)"
);

assert(
  resolveShadingTotalLossPct({ ...assessedShading(4), total_loss_pct: 7.5 }, {}) === 4,
  "combined bat total_loss_pct racine (anti-divergence)"
);

assert(
  resolveShadingTotalLossPct({ total_loss_pct: 7.5 }, {}) === null,
  "legacy snake seul → total_loss_pct"
);

assert(
  resolveShadingTotalLossPct({ totalLossPct: 8 }, {}) === null,
  "legacy camel seul → totalLossPct"
);

assert(
  resolveShadingTotalLossPct({}, { installation: { shading_loss_pct: 10 } }) === null,
  "form.installation.shading_loss_pct si pas de shading numérique"
);

assert(
  resolveShadingTotalLossPct({}, { shadingLossPct: 11 }) === null,
  "form.shadingLossPct en dernier recours"
);

assert(
  resolveShadingTotalLossPct({ totalLossPct: 1 }, { shadingLossPct: 99 }) === null,
  "racine camel bat form si pas de combined"
);

assert(
  resolveShadingTotalLossPct(assessedShading(5), { installation: { shading_loss_pct: 99 } }) === 5,
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
  resolveShadingTotalLossPct(assessedShading(0), { shadingLossPct: 50 }) === 0,
  "0% est une valeur valide (racine)"
);

console.log("\nPassed: " + passed + ", Failed: " + failed);
if (failed > 0) process.exit(1);
process.exit(0);
