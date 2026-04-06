/**
 * TEST 2 — Le script d’alignement horizon ne dépend plus de frontend/.../shadingEngine.js.
 * Usage: cd backend && node tests/shading-horizon-alignment-no-frontend-engine.test.js
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const scriptPath = path.join(__dirname, "../scripts/test-front-back-horizon-alignment.js");
const txt = readFileSync(scriptPath, "utf8");

const bad = ["frontend/calpinage/shading/shadingEngine.js", "frontend\\calpinage\\shading\\shadingEngine.js"];
let failed = 0;
for (const s of bad) {
  if (txt.includes(s)) {
    console.log("❌ Référence toxique encore présente:", s);
    failed++;
  }
}
if (!txt.includes("annualFarHorizonWeightedLossCore.cjs")) {
  console.log("❌ Attendu: require vers annualFarHorizonWeightedLossCore.cjs");
  failed++;
}

if (failed) {
  process.exit(1);
}
console.log("✅ test-front-back-horizon-alignment.js utilise shared/shading/annualFarHorizonWeightedLossCore.cjs");
process.exit(0);
