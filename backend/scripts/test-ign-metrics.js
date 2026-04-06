/**
 * Test des métriques IGN Dynamic (PROMPT 5).
 * Usage: node backend/scripts/test-ign-metrics.js
 */

import {
  resetMetrics,
  incrementCacheHit,
  incrementDownload,
  incrementFailure,
  getMetrics,
} from "../services/dsmDynamic/ignMetrics.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

resetMetrics();

incrementCacheHit();
incrementDownload(100);
incrementFailure();

const m = getMetrics();

assert(m.cacheHits === 1, `cacheHits attendu 1, obtenu ${m.cacheHits}`);
assert(m.downloads === 1, `downloads attendu 1, obtenu ${m.downloads}`);
assert(m.failures === 1, `failures attendu 1, obtenu ${m.failures}`);
assert(m.totalDownloadTimeMs === 100, `totalDownloadTimeMs attendu 100, obtenu ${m.totalDownloadTimeMs}`);

console.log("getMetrics() =", JSON.stringify(m, null, 2));
console.log("Test metrics PASS");
