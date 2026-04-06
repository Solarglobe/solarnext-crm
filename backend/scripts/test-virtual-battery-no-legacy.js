/**
 * Test computeVirtualBatteryQuote — config uniquement, aucun pricing interne ni hardcode.
 * Usage: node backend/scripts/test-virtual-battery-no-legacy.js
 */

import { computeVirtualBatteryQuote } from "../services/virtualBatteryQuoteCalcOnly.service.js";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

// Test 1 — config absent → ok: false
const r1 = computeVirtualBatteryQuote({
  annual_surplus_kwh: 1000,
  annual_import_kwh: 500,
  config: null,
});
assert(r1.ok === false, "Test 1a : config null → ok: false");
assert(r1.reason === "NO_VIRTUAL_BATTERY", "Test 1a : reason NO_VIRTUAL_BATTERY");

const r1b = computeVirtualBatteryQuote({
  annual_surplus_kwh: 1000,
  annual_import_kwh: 500,
  config: { enabled: false },
});
assert(r1b.ok === false && r1b.reason === "NO_VIRTUAL_BATTERY", "Test 1b : enabled false → ok: false");
console.log("✅ Test 1 — config absent ou disabled → ok: false");

// Test 2 — config incomplet (pas annual_subscription_ttc) → ok: false
const r2 = computeVirtualBatteryQuote({
  annual_surplus_kwh: 1000,
  annual_import_kwh: 500,
  config: { enabled: true },
});
assert(r2.ok === false, "Test 2a : pas annual_subscription_ttc → ok: false");
assert(r2.reason === "MISSING_SUBSCRIPTION", "Test 2a : reason MISSING_SUBSCRIPTION");

const r2b = computeVirtualBatteryQuote({
  annual_surplus_kwh: 1000,
  annual_import_kwh: 500,
  config: { enabled: true, annual_subscription_ttc: "invalid" },
});
assert(r2b.ok === false && r2b.reason === "MISSING_SUBSCRIPTION", "Test 2b : annual_subscription_ttc invalide → ok: false");
console.log("✅ Test 2 — config incomplet → ok: false");

// Test 3 — config complet → annual_cost_ttc calculé, aucun accès pricingService / hardcode
const r3 = computeVirtualBatteryQuote({
  annual_surplus_kwh: 1200,
  annual_import_kwh: 800,
  config: {
    enabled: true,
    annual_subscription_ttc: 600,
    cost_per_kwh_storage: 0.05,
    fee_fixed: 50,
    vat_rate: 0.2,
    estimated_savings_annual: 800,
  },
});
assert(r3.ok === true, "Test 3 : config complet → ok: true");
const expectedTtc = 600 + 1200 * 0.05 + 50; // 600 + 60 + 50 = 710
assert(
  Math.abs((r3.annual_cost_ttc ?? 0) - expectedTtc) < 0.02,
  `Test 3 : annual_cost_ttc ≈ ${expectedTtc} (got ${r3.annual_cost_ttc})`
);
assert(
  r3.annual_cost_ht != null && Math.abs(r3.annual_cost_ht - expectedTtc / 1.2) < 0.02,
  "Test 3 : annual_cost_ht = annual_cost_ttc / (1 + vat_rate)"
);
assert(
  Math.abs((r3.net_gain_annual ?? 0) - (800 - expectedTtc)) < 0.02,
  "Test 3 : net_gain_annual = estimated_savings_annual - annual_cost_ttc"
);
assert(r3.detail != null && typeof r3.detail === "object", "Test 3 : detail présent");
assert(r3.detail.surplus_kwh === 1200, "Test 3 : detail.surplus_kwh");
console.log("✅ Test 3 — config complet → annual_cost_ttc, annual_cost_ht, net_gain_annual, detail corrects");

// Test 3b — config avec uniquement annual_subscription_ttc (optionnels à 0)
const r3b = computeVirtualBatteryQuote({
  annual_surplus_kwh: 0,
  annual_import_kwh: 0,
  config: { enabled: true, annual_subscription_ttc: 400 },
});
assert(r3b.ok === true && r3b.annual_cost_ttc === 400, "Test 3b : subscription seule → annual_cost_ttc = 400");
console.log("✅ Test 3b — subscription seule (optionnels implicites 0)");

// Vérifier qu'aucun import/require de pricingService (le commentaire peut contenir le mot)
const servicePath = path.join(__dirname, "..", "services", "virtualBatteryQuoteCalcOnly.service.js");
const content = fs.readFileSync(servicePath, "utf8");
const hasPricingImport = /from\s+['\"][^'\"]*pricingService|require\s*\(\s*['\"][^'\"]*pricingService/.test(content);
assert(!hasPricingImport, "Aucun import de pricingService dans le service");
console.log("✅ Aucun pricingService, calcul 100% basé sur config");

console.log("\n✅ Tous les tests test-virtual-battery-no-legacy sont passés.");
