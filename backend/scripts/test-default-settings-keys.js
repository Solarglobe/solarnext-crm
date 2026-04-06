/**
 * Vérifie que DEFAULT_SETTINGS contient toutes les clés attendues (settings.html parity).
 * Usage: node scripts/test-default-settings-keys.js
 * Ne nécessite pas le serveur ni la DB.
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fs from "fs";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const controllerPath = resolve(__dirname, "../controllers/admin.org.settings.controller.js");
const src = fs.readFileSync(controllerPath, "utf-8");

const REQUIRED_KEYS = {
  pricing: [
    "kit_panel_power_w",
    "kit_price_lt_4_5",
    "kit_price_gt_4_5",
    "coffret_mono_ht",
    "coffret_tri_ht",
    "battery_unit_kwh",
    "battery_unit_price_ht",
    "install_tiers",
  ],
  economics: [
    "price_eur_kwh",
    "elec_growth_pct",
    "pv_degradation_pct",
    "horizon_years",
    "oa_rate_lt_9",
    "oa_rate_gte_9",
    "prime_lt9",
    "prime_gte9",
    "maintenance_pct",
    "onduleur_year",
    "onduleur_cost_pct",
  ],
  pvtech: [
    "system_yield_pct",
    "panel_surface_m2",
    "fallback_prod_kwh_kwc",
    "longi_eff_pct",
    "longi_lowlight_gain_pct",
    "longi_temp_coeff_pct",
    "longi_deg1_pct",
    "longi_deg2_pct",
    "standard_loss_pct",
    "micro_eff_pct",
    "micro_mppt_pct",
  ],
  components: [
    "module_label",
    "micro_label",
    "coffret_label",
    "conformity_text",
    "battery_warranty_years",
    "micro_ac_w",
    "micro_dc_w",
    "micro_eff_pct",
    "micro_mppt_pct",
    "standard_loss_pct",
  ],
  ai: ["use_enedis_first", "use_pvgis", "use_ai_fallback"],
};

// Vérification par recherche de chaînes dans le fichier (évite eval)
let ok = true;
for (const [section, keys] of Object.entries(REQUIRED_KEYS)) {
  const sectionPattern = new RegExp(`${section}:\\s*\\{`, "s");
  if (!sectionPattern.test(src)) {
    console.error(`❌ Section "${section}" manquante`);
    ok = false;
    continue;
  }
  for (const key of keys) {
    const keyPattern = new RegExp(`${key}:\\s*[\\d.\\-]+|${key}:\\s*"[^"]*"|${key}:\\s*\\[|${key}:\\s*true|${key}:\\s*false`);
    if (!keyPattern.test(src)) {
      console.error(`❌ ${section}.${key} manquant`);
      ok = false;
    }
  }
}

// Vérifier 19 paliers
const tiersMatch = src.match(/install_tiers:\s*\[([\s\S]*?)\]/);
const kwcRegex = new RegExp("kwc:", "g");
const tierCount = tiersMatch ? (tiersMatch[1].match(kwcRegex) || []).length : 0;
if (tierCount !== 19) {
  console.error(`❌ install_tiers doit avoir 19 paliers, reçu: ${tierCount}`);
  ok = false;
} else {
  console.log("✅ install_tiers: 19 paliers");
}

if (ok) {
  console.log("\n✅ Toutes les clés DEFAULT_SETTINGS sont présentes (checklist zéro oubli)");
  process.exit(0);
} else {
  process.exit(1);
}
