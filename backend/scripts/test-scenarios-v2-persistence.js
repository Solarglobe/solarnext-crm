/**
 * Test structure scenarios_v2 et persistance (mapper + 10 blocs).
 * Usage: node backend/scripts/test-scenarios-v2-persistence.js
 */

import { mapScenarioToV2 } from "../services/scenarioV2Mapper.service.js";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const REQUIRED_TOP_LEVEL = ["id", "label", "energy", "finance", "capex", "hardware", "shading", "production", "assumptions", "computed_at"];
const VALID_IDS = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL"];
const LABELS = { BASE: "Sans batterie", BATTERY_PHYSICAL: "Batterie physique", BATTERY_VIRTUAL: "Batterie virtuelle" };

function hasUndefined(obj, path = "") {
  if (obj === undefined) return [path || "root"];
  if (obj === null) return [];
  if (Array.isArray(obj)) {
    const out = [];
    obj.forEach((v, i) => out.push(...hasUndefined(v, `${path}[${i}]`)));
    return out;
  }
  if (typeof obj === "object") {
    const out = [];
    for (const k of Object.keys(obj)) {
      out.push(...hasUndefined(obj[k], path ? `${path}.${k}` : k));
    }
    return out;
  }
  return [];
}

// Scénario BASE type (après merge finance)
const baseScenario = {
  name: "BASE",
  _v2: true,
  energy: {
    prod: 6000,
    auto: 2400,
    surplus: 3600,
    import: 800,
    monthly: Array.from({ length: 12 }, (_, i) => ({ prod: 500, conso: 400, auto: 200, surplus: 300, import: 80 })),
  },
  prod_kwh: 6000,
  auto_kwh: 2400,
  surplus_kwh: 3600,
  capex_ttc: 18000,
  roi_years: 8,
  irr_pct: 6.5,
  lcoe_eur_kwh: 0.12,
  flows: [{ year: 1, total_eur: 2200, cumul_eur: 2200 }],
  metadata: { kwc: 6, nb_panneaux: 12 },
  battery: false,
  batterie: false,
  _virtualBatteryQuote: null,
};

const ctx = {
  pv: { kwc: 6, panelsCount: 12, hourly: [], total_kwh: 6000, monthly: [] },
  battery_input: null,
  form: { installation: {} },
  production: { annualKwh: 6000, monthlyKwh: Array(12).fill(500) },
};

// ——— Test 1 : scenarios_v2 existe et longueur 1 à 3 ———
const scenariosV2 = [
  mapScenarioToV2(baseScenario, ctx),
  mapScenarioToV2({ ...baseScenario, name: "BATTERY_PHYSICAL", battery: true, energy: { ...baseScenario.energy, auto: 3000, surplus: 3000 } }, ctx),
  mapScenarioToV2({ ...baseScenario, name: "BATTERY_VIRTUAL", _virtualBatteryQuote: { annual_cost_ttc: 480 } }, ctx),
];

assert(Array.isArray(scenariosV2), "scenarios_v2 doit être un tableau");
assert(scenariosV2.length >= 1 && scenariosV2.length <= 3, "scenarios_v2 doit contenir 1 à 3 scénarios");
console.log("✅ Test 1 — scenarios_v2 existe, longueur =", scenariosV2.length);

// ——— Test 2 : chaque scénario contient les 10 blocs ———
for (let i = 0; i < scenariosV2.length; i++) {
  const sc = scenariosV2[i];
  for (const key of REQUIRED_TOP_LEVEL) {
    assert(key in sc, `Scénario ${i} doit contenir la clé "${key}"`);
  }
  assert(VALID_IDS.includes(sc.id), `Scénario ${i} : id invalide "${sc.id}"`);
  assert(sc.label === LABELS[sc.id], `Scénario ${i} : label attendu "${LABELS[sc.id]}" pour ${sc.id}`);
}
console.log("✅ Test 2 — Chaque scénario contient les 10 blocs (id, label, energy, finance, capex, hardware, shading, production, assumptions, computed_at)");

// ——— Test 3 : aucun champ undefined (structure stable) ———
for (let i = 0; i < scenariosV2.length; i++) {
  const undef = hasUndefined(scenariosV2[i]);
  assert(undef.length === 0, `Scénario ${i} : champs undefined: ${undef.join(", ")}`);
}
console.log("✅ Test 3 — Aucun champ undefined dans les scénarios");

// ——— Test 4 : computed_at présent et ISO ———
for (let i = 0; i < scenariosV2.length; i++) {
  const at = scenariosV2[i].computed_at;
  assert(typeof at === "string" && at.length > 0, `Scénario ${i} : computed_at doit être une chaîne non vide`);
  assert(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/.test(at), `Scénario ${i} : computed_at doit être une date ISO`);
}
console.log("✅ Test 4 — computed_at présent et au format ISO");

// ——— Test 5 : sous-blocs energy, finance, capex, hardware, shading, production, assumptions ———
const first = scenariosV2[0];
assert(typeof first.energy === "object" && first.energy !== null, "energy doit être un objet");
assert("production_kwh" in first.energy && "autoconsumption_kwh" in first.energy && "surplus_kwh" in first.energy, "energy doit contenir production_kwh, autoconsumption_kwh, surplus_kwh");
assert(typeof first.finance === "object" && "capex_ttc" in first.finance && "roi_years" in first.finance, "finance doit contenir capex_ttc, roi_years");
assert(typeof first.capex === "object" && "total_ttc" in first.capex && "injected_from_devis" in first.capex, "capex doit contenir total_ttc, injected_from_devis");
assert(typeof first.hardware === "object" && "panels_count" in first.hardware && "kwc" in first.hardware, "hardware doit contenir panels_count, kwc");
assert(typeof first.shading === "object", "shading doit être un objet");
assert(typeof first.production === "object" && "annual_kwh" in first.production, "production doit contenir annual_kwh");
assert(typeof first.assumptions === "object" && "model_version" in first.assumptions, "assumptions doit contenir model_version");
assert(first.assumptions.model_version === "ENGINE_V2", "assumptions.model_version doit être ENGINE_V2");
console.log("✅ Test 5 — Sous-blocs energy, finance, capex, hardware, shading, production, assumptions conformes");

console.log("\n✅ Tous les tests scenarios_v2 persistence sont passés.");
