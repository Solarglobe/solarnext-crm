import assert from "node:assert/strict";
import test from "node:test";
import {
  resolveHpHcPricingContext,
  effectivePriceForHourlyWeights,
  buildScenarioPricing,
  attachHpHcPricingToScenarios,
} from "../services/pv/hphcPricing.service.js";
import { buildHpHcHourlyMask } from "../services/pv/hphcMask.service.js";

const HP = 0.2081;
const HC = 0.1635;

/** ctx minimal HPHC : hint lead + prix fiche compteur (Lot 2). */
function ctxHphc() {
  return {
    form: {
      params: {
        hp_hc: true,
        elec_price_hp_eur_kwh: HP,
        elec_price_hc_eur_kwh: HC,
      },
    },
    virtual_battery_input: {},
  };
}

test("resolveHpHcPricingContext : null si prix absents ou contrat BASE", () => {
  assert.equal(resolveHpHcPricingContext({ form: { params: { hp_hc: true } } }), null);
  assert.equal(
    resolveHpHcPricingContext({
      form: { params: { elec_price_hp_eur_kwh: HP, elec_price_hc_eur_kwh: HC } },
      virtual_battery_input: { contract_type: "BASE" },
    }),
    null
  );
});

test("resolveHpHcPricingContext : ok si HPHC (hint fiche compteur) + prix saisis", () => {
  const pc = resolveHpHcPricingContext(ctxHphc());
  assert.ok(pc);
  assert.equal(pc.priceHp, HP);
  assert.equal(pc.priceHc, HC);
  assert.equal(pc.hourlyIsHp.length, 8760);
});

test("resolveHpHcPricingContext : contract_type devis prioritaire sur le hint", () => {
  const ctx = ctxHphc();
  ctx.virtual_battery_input = { contract_type: "HPHC" };
  ctx.form.params.hp_hc = false; // le devis fixe HPHC → hint ignoré
  assert.ok(resolveHpHcPricingContext(ctx));
});

test("effectivePriceForHourlyWeights : flux 100% HP → priceHp ; 100% HC → priceHc", () => {
  const pc = resolveHpHcPricingContext(ctxHphc()); // défaut HC 23h-7h
  const wHp = new Array(8760).fill(0);
  const wHc = new Array(8760).fill(0);
  for (let h = 0; h < 8760; h++) {
    const hd = h % 24;
    if (hd === 12) wHp[h] = 1; // midi = HP
    if (hd === 2) wHc[h] = 1; // 2h du matin = HC
  }
  assert.equal(effectivePriceForHourlyWeights(wHp, pc), HP);
  assert.equal(effectivePriceForHourlyWeights(wHc, pc), HC);
});

test("effectivePriceForHourlyWeights : mix 50/50 → moyenne ; garde-fous → null", () => {
  const pc = resolveHpHcPricingContext(ctxHphc());
  const w = new Array(8760).fill(0);
  w[12] = 1; // HP
  w[2] = 1; // HC
  assert.equal(effectivePriceForHourlyWeights(w, pc), Math.round(((HP + HC) / 2) * 100000) / 100000);
  assert.equal(effectivePriceForHourlyWeights(new Array(8760).fill(0), pc), null, "flux nul → null");
  assert.equal(effectivePriceForHourlyWeights([1, 2, 3], pc), null, "série invalide → null");
  assert.equal(effectivePriceForHourlyWeights(w, null), null, "pas de contexte → null");
});

test("attachHpHcPricingToScenarios : PV de jour + conso de nuit → p_eff_auto=HP, p_eff_import≈HC", () => {
  const pc = resolveHpHcPricingContext(ctxHphc());
  // Profil synthétique : PV 2 kWh à midi (HP), conso 1 kWh à midi + 3 kWh à 2h du matin (HC).
  const pv = new Array(8760).fill(0);
  const conso = new Array(8760).fill(0);
  for (let d = 0; d < 365; d++) {
    pv[d * 24 + 12] = 2;
    conso[d * 24 + 12] = 1; // autoconso directe 1 kWh HP, surplus 1 kWh
    conso[d * 24 + 2] = 3; // import 3 kWh HC
  }
  const ctx = { pv: { hourly: pv }, conso: { hourly: conso } };
  const scenarios = {
    BASE: {
      name: "BASE",
      import_kwh: 3 * 365,
      residual_bill_eur: 3 * 365 * 0.195, // prix plat historique
    },
  };
  attachHpHcPricingToScenarios(scenarios, ctx, null, pc);
  const p = scenarios.BASE.pricing;
  assert.ok(p, "pricing attaché");
  assert.equal(p.mode, "HPHC");
  assert.equal(p.p_eff_auto, HP, "autoconso 100% à midi → prix HP");
  assert.equal(p.p_eff_import, HC, "import 100% à 2h → prix HC");
  // p_eff_conso = (1×HP + 3×HC)/4
  assert.equal(p.p_eff_conso, Math.round(((1 * HP + 3 * HC) / 4) * 100000) / 100000);
  // residual_bill recalculée au prix effectif d'import
  assert.equal(scenarios.BASE.residual_bill_eur, Math.round(3 * 365 * HC * 100) / 100);
});

test("attachHpHcPricingToScenarios : sans contexte → aucun effet (rétrocompat)", () => {
  const scenarios = { BASE: { name: "BASE", residual_bill_eur: 100 } };
  attachHpHcPricingToScenarios(scenarios, { pv: { hourly: [] }, conso: { hourly: [] } }, null, null);
  assert.equal(scenarios.BASE.pricing, undefined);
  assert.equal(scenarios.BASE.residual_bill_eur, 100);
});

test("buildScenarioPricing : conso invalide → null", () => {
  const pc = { hourlyIsHp: buildHpHcHourlyMask(), priceHp: HP, priceHc: HC };
  assert.equal(buildScenarioPricing({ pricingCtx: pc, consoHourly: [1, 2] }), null);
});
