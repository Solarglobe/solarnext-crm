/**
 * Remplacement onduleur dans les cashflows — micro vs string/central.
 * Usage: node backend/tests/finance-inverter-replacement.test.js
 */

import { computeFinance } from "../services/financeService.js";
import { extractPvInverterFromCalpinagePayload, isMicroInverterForFinance } from "../services/pv/inverterFinanceContext.js";

const assert = (cond, msg) => {
  if (!cond) throw new Error(msg);
};

const baseScenario = {
  name: "BASE",
  _v2: true,
  kwc: 6,
  battery: false,
  prod_kwh: 6000,
  auto_kwh: 3000,
  surplus_kwh: 3000,
  conso_kwh: 5000,
};

const economics = {
  price_eur_kwh: 0.2,
  elec_growth_pct: 5,
  pv_degradation_pct: 0.5,
  oa_rate_lt_9: 0.04,
  oa_rate_gte_9: 0.0617,
  prime_lt9: 80,
  prime_gte9: 180,
  horizon_years: 25,
  maintenance_pct: 0,
  onduleur_year: 15,
  onduleur_cost_pct: 12,
};

function flowsForPvInverter(pv_inverter) {
  return computeFinance(
    {
      form: { params: { tarif_kwh: 0.2 }, pv_inverter },
      finance_input: { capex_ttc: 18000 },
      settings: { economics },
    },
    { BASE: { ...baseScenario } }
  ).then((o) => o.scenarios.BASE.flows);
}

// ——— extractPvInverterFromCalpinagePayload ———
const snapMicro = {
  inverter: { inverter_type: "micro", brand: "Enphase", name: "IQ8" },
};
const extMicro = extractPvInverterFromCalpinagePayload(snapMicro);
assert(extMicro.inverter_type === "micro", "snapshot micro : inverter_type extrait");
assert(isMicroInverterForFinance(extMicro), "isMicro pour payload micro");

const snapString = {
  inverter: { inverter_type: "string", brand: "Fronius", name: "X" },
  pvParams: { inverter_family: "CENTRAL" },
};
const extString = extractPvInverterFromCalpinagePayload(snapString);
assert(extString.inverter_type === "string", "snapshot string : inverter_type");
assert(!isMicroInverterForFinance(extString), "string/central n'est pas micro");

const snapFamilyOnly = { pvParams: { inverter_family: "MICRO" } };
assert(isMicroInverterForFinance(extractPvInverterFromCalpinagePayload(snapFamilyOnly)), "MICRO via pvParams.inverter_family");
console.log("✅ extractPvInverterFromCalpinagePayload + isMicroInverterForFinance");

// ——— A : micro — pas de coût remplacement année 15 ———
const flowsMicro = await flowsForPvInverter({ inverter_type: "micro", inverter_family: "MICRO" });
const y15micro = flowsMicro.find((f) => f.year === 15);
assert(y15micro.inverter_cost === 0, `micro : inverter_cost année 15 = 0 (reçu ${y15micro.inverter_cost})`);
const y15strForCompare = (await flowsForPvInverter({ inverter_type: "string", inverter_family: "CENTRAL" })).find(
  (f) => f.year === 15
);
assert(
  y15micro.total_eur > y15strForCompare.total_eur + 1000,
  "micro : total_eur année 15 nettement supérieur au cas string (pas de -12% capex)",
);
console.log("✅ A — micro : pas de remplacement année 15 (inverter_cost=0)");

// ——— B : string / central — remplacement actif ———
const flowsString = await flowsForPvInverter({
  inverter_type: "string",
  inverter_family: "CENTRAL",
});
const y15str = flowsString.find((f) => f.year === 15);
const expectedInv = 18000 * 0.12;
assert(
  Math.abs(y15str.inverter_cost - expectedInv) < 0.01,
  `string : inverter_cost année 15 ≈ 12% capex (${expectedInv}), reçu ${y15str.inverter_cost}`,
);
console.log("✅ B — string/central : remplacement année 15 inchangé");

// ——— C : régression — sans pv_inverter (legacy) = comme string ———
const flowsLegacy = await flowsForPvInverter(null);
const y15leg = flowsLegacy.find((f) => f.year === 15);
assert(
  Math.abs(y15leg.inverter_cost - expectedInv) < 0.01,
  "sans pv_inverter : même logique qu'avant (remplacement année 15)",
);
console.log("✅ C — sans pv_inverter : comportement inchangé");

console.log("\n✅ finance-inverter-replacement.test.js — OK");
