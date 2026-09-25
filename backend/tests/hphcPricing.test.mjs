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
  assert.equal(pc.hourlyHpFraction.length, 8760);
});

test("un contrat BV HP/HC ne transforme pas le contrat actuel BASE", () => {
  const ctx = ctxHphc();
  ctx.virtual_battery_input = { contract_type: "HPHC" };
  ctx.form.params.hp_hc = false;
  assert.equal(resolveHpHcPricingContext(ctx), null);
});

test("un contrat BV BASE ne désactive pas les tarifs HP/HC du compteur", () => {
  const ctx = ctxHphc();
  const current = resolveHpHcPricingContext(ctx);
  ctx.virtual_battery_input = { contract_type: "BASE", off_peak_periods: [{ start: "12:00", end: "20:00" }] };
  assert.deepEqual(resolveHpHcPricingContext(ctx), current);
});

test("le type de tarif explicite est prioritaire sur l'ancien booléen HP/HC", () => {
  const ctx = ctxHphc();
  ctx.form.params.tariff_type = "base";
  assert.equal(resolveHpHcPricingContext(ctx), null);
  ctx.form.params.tariff_type = "hp_hc";
  delete ctx.form.params.hp_hc;
  assert.ok(resolveHpHcPricingContext(ctx));
  ctx.form.params.elec_price_hc_eur_kwh = 0;
  assert.equal(resolveHpHcPricingContext(ctx).priceHc, 0);
});

test("le contrat actuel et ses tarifs se résolvent depuis le lead, avec priorité params", () => {
  const ctx = { form: { lead: ctxHphc().form.params } };
  assert.ok(resolveHpHcPricingContext(ctx));
  ctx.form.params = { hp_hc: false };
  assert.equal(resolveHpHcPricingContext(ctx), null);
});

test("les prix effectifs pondèrent les heures mixtes du contrat actuel à la minute", () => {
  const ctx = ctxHphc();
  ctx.form.params.off_peak_periods = [{ start: "22:30", end: "06:30" }];
  ctx.virtual_battery_input = { contract_type: "BASE", off_peak_periods: [{ start: "12:00", end: "20:00" }] };
  const pc = resolveHpHcPricingContext(ctx);
  const hourly = new Array(8760).fill(1);
  assert.equal(effectivePriceForHourlyWeights(hourly, pc), Math.round(((16 * HP + 8 * HC) / 24) * 100000) / 100000);
  const mixedHours = new Array(8760).fill(0);
  mixedHours[22] = 2;
  mixedHours[6] = 3;
  assert.equal(effectivePriceForHourlyWeights(mixedHours, pc), Math.round(((HP + HC) / 2) * 100000) / 100000);
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
  assert.equal(p.p_eff_import_current, HC, "référence conservée pour comparer le contrat fournisseur");
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
