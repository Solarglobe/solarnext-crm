/**
 * PATCH PHASE 1 — Test mapping batterie
 * Prouve que org.settings_json.pricing.battery_unit_price_ht=3750
 * → calcul/scénario batterie utilise 3750 (pas 450)
 *
 * Usage: node scripts/test-battery-mapping.js
 * Prérequis: aucun (test unitaire pricingService)
 */

import * as pricingService from "../services/pricingService.js";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function main() {
  console.log("=== Test mapping batterie (battery_unit_price_ht) ===\n");

  // Contexte minimal avec pricing.battery_unit_price_ht (CRM)
  const ctx = {
    pricing: {
      kit_panel_power_w: 485,
      kit_price_lt_4_5: 480,
      kit_price_gt_4_5: 500,
      coffret_mono_ht: 1650,
      coffret_tri_ht: 1850,
      battery_unit_price_ht: 3750, // ← CRM envoie ceci (pas battery_atmoce_unit_price_ht)
      install_tiers: [{ kwc: 3, price_ht: 1500 }, { kwc: 6, price_ht: 2200 }],
    },
    settings: {
      pricing: {
        kit_panel_power_w: 485,
        kit_price_lt_4_5: 480,
        kit_price_gt_4_5: 500,
        coffret_mono_ht: 1650,
        coffret_tri_ht: 1850,
        battery_unit_price_ht: 3750,
        install_tiers: [{ kwc: 3, price_ht: 1500 }, { kwc: 6, price_ht: 2200 }],
      },
    },
    site: { reseau_type: "mono" },
  };

  // Scénario AVEC batterie
  const result = pricingService.computeTotal(ctx, { kwc: 3, batterie: true });

  console.log("1. Scénario 3 kWc + batterie");
  console.log("   battery_ht =", result.battery_ht);
  console.log("   total_ht   =", result.total_ht);

  assert(result.battery_ht === 3750, `battery_ht attendu 3750, reçu ${result.battery_ht}`);
  console.log("   ✅ battery_ht = 3750 (pas 450)\n");

  // Scénario SANS batterie (battery_ht doit être 0)
  const resultSans = pricingService.computeTotal(ctx, { kwc: 3, batterie: false });
  assert(resultSans.battery_ht === 0, `battery_ht sans batterie attendu 0, reçu ${resultSans.battery_ht}`);
  console.log("2. Scénario 3 kWc sans batterie");
  console.log("   battery_ht =", resultSans.battery_ht);
  console.log("   ✅ battery_ht = 0\n");

  // Fallback legacy : si seul battery_atmoce_unit_price_ht présent
  const ctxLegacy = {
    pricing: {
      kit_panel_power_w: 485,
      kit_price_lt_4_5: 480,
      kit_price_gt_4_5: 500,
      coffret_mono_ht: 1650,
      coffret_tri_ht: 1850,
      battery_atmoce_unit_price_ht: 2800, // legacy
      install_tiers: [{ kwc: 3, price_ht: 1500 }],
    },
    site: { reseau_type: "mono" },
  };
  const resultLegacy = pricingService.computeTotal(ctxLegacy, { kwc: 3, batterie: true });
  assert(resultLegacy.battery_ht === 2800, `legacy: battery_ht attendu 2800, reçu ${resultLegacy.battery_ht}`);
  console.log("3. Fallback legacy (battery_atmoce_unit_price_ht=2800)");
  console.log("   battery_ht =", resultLegacy.battery_ht);
  console.log("   ✅ battery_ht = 2800\n");

  // Fallback 450 si aucun des deux
  const ctxFallback = {
    pricing: {
      kit_panel_power_w: 485,
      kit_price_lt_4_5: 480,
      kit_price_gt_4_5: 500,
      coffret_mono_ht: 1650,
      coffret_tri_ht: 1850,
      install_tiers: [{ kwc: 3, price_ht: 1500 }],
    },
    site: { reseau_type: "mono" },
  };
  const resultFallback = pricingService.computeTotal(ctxFallback, { kwc: 3, batterie: true });
  assert(resultFallback.battery_ht === 450, `fallback: battery_ht attendu 450, reçu ${resultFallback.battery_ht}`);
  console.log("4. Fallback 450 si aucun prix batterie configuré");
  console.log("   battery_ht =", resultFallback.battery_ht);
  console.log("   ✅ battery_ht = 450\n");

  console.log("=== Test mapping batterie OK ✅ ===\n");
}

try {
  main();
  process.exit(0);
} catch (err) {
  console.error("\n❌ Erreur:", err.message || err);
  process.exit(1);
}
