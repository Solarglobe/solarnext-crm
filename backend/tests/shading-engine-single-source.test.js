/**
 * TEST 2 — annualFarHorizonWeightedLossCore ne duplique plus la logique : re-export shadingEngineCore.
 * Usage: cd backend && node tests/shading-engine-single-source.test.js
 */

import { readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const annualPath = path.join(__dirname, "../../shared/shading/annualFarHorizonWeightedLossCore.cjs");
const txt = readFileSync(annualPath, "utf8");

if (!txt.includes('require("./shadingEngineCore.cjs")') && !txt.includes("require('./shadingEngineCore.cjs')")) {
  console.log("❌ annualFarHorizonWeightedLossCore doit require shadingEngineCore.cjs");
  process.exit(1);
}
if (txt.includes("function computeAnnualShadingLoss")) {
  console.log("❌ annualFarHorizonWeightedLossCore ne doit plus définir computeAnnualShadingLoss inline");
  process.exit(1);
}
console.log("✅ shading-engine-single-source (annual → shadingEngineCore uniquement)");
process.exit(0);
