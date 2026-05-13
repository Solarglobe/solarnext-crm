#!/usr/bin/env node
/**
 * Diagnostic : scénario BASE seul, même PV, 4 profils synthétiques (consumptionService).
 * Usage : cd backend && node scripts/diag-base-consumption-profiles.mjs
 */
import { loadConsumption } from "../services/consumptionService.js";
import { buildScenarioBaseV2 } from "../services/scenarios/scenarioBuilderV2.service.js";
import { attachNormalizedEnergyKpiFields } from "../services/energyKpisNormalize.service.js";
import { mergeOrgEconomicsPartial } from "../services/economicsResolve.service.js";
import * as financeService from "../services/financeService.js";

const H = 8760;

/** PV 8760 h fixe (forme jour / saison), renormalisé à un objectif kWh/an — même courbe pour tous les profils. */
function buildSyntheticPvHourly(kwc, targetAnnualKwh) {
  const daysInMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const monthsSeason = [0.42, 0.52, 0.72, 0.92, 1.02, 1.08, 1.1, 1.02, 0.85, 0.65, 0.5, 0.44];
  const raw = [];
  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < daysInMonth[m]; d++) {
      for (let h = 0; h < 24; h++) {
        const zenith = h >= 6 && h <= 20 ? Math.sin(((h - 6) / 14) * Math.PI) : 0;
        raw.push(zenith * kwc * monthsSeason[m] * 0.9);
      }
    }
  }
  const arr = raw.slice(0, H);
  const s = arr.reduce((a, b) => a + b, 0);
  const f = targetAnnualKwh / s;
  return arr.map((x) => x * f);
}

const PROFILES = [
  { label: "Famille active", profil: "active" },
  { label: "Télétravail", profil: "teletravail" },
  { label: "Retraité", profil: "retraite" },
  { label: "PRO journée", profil: "pro" },
];

async function main() {
  const kwc = 6;
  const targetProd = 8200;
  const annualConso = 5200;
  const capexTtc = 12000;
  const pvHourly = buildSyntheticPvHourly(kwc, targetProd);

  const economics = mergeOrgEconomicsPartial(null);

  const rows = [];

  for (const { label, profil } of PROFILES) {
    const consoOut = loadConsumption(
      {
        conso: { mode: "annuelle", annuelle_kwh: annualConso, profil },
        params: { puissance_kva: 9, reseau_type: "mono" },
      },
      null,
      {}
    );

    const ctx = {
      pv: { hourly: pvHourly, kwc, panelsCount: 10 },
      conso: {
        hourly: consoOut.hourly,
        annual_kwh: consoOut.annual_kwh,
        profil,
        clamped: consoOut.hourly,
      },
      conso_p_pilotee: undefined,
      form: {
        maison: { panneaux_max: 10 },
        panel_input: { power_wc: 600 },
        params: { puissance_kva: 9, reseau_type: "mono" },
        economics: {},
      },
      settings: { economics },
      finance_input: { capex_ttc: capexTtc },
      meta: { engine_consumption_source: consoOut.engine_consumption_source ?? "SYNTHETIC_MANUAL_PROFILE" },
    };

    const base = buildScenarioBaseV2(ctx);
    attachNormalizedEnergyKpiFields(base);

    const fin = await financeService.computeFinance(ctx, { BASE: base });
    const b = fin.scenarios.BASE;
    const e = base.energy;

    rows.push({
      label,
      profil,
      prod: e.production_kwh ?? e.prod,
      conso: e.consumption_kwh ?? e.conso,
      auto: e.autoconsumption_kwh ?? e.auto,
      pvSelfPct: e.pv_self_consumption_pct,
      siteAutonomyPct: e.site_autonomy_pct,
      surplus: e.exported_kwh ?? e.surplus,
      importGrid: e.grid_import_kwh ?? e.import,
      economieAn1: b.economie_an1,
      scenarioPiloted: base.scenario_uses_piloted_profile === true,
    });
  }

  const sumProd = rows.map((r) => r.prod).reduce((a, b) => a + b, 0);
  const prodSpread = Math.max(...rows.map((r) => r.prod)) - Math.min(...rows.map((r) => r.prod));
  const autoSpread = Math.max(...rows.map((r) => r.auto)) - Math.min(...rows.map((r) => r.auto));

  console.log(JSON.stringify({
    hypothèses: {
      même_PV_kWh_an: rows[0]?.prod,
      conso_annuelle_kWh_identique: annualConso,
      kWc: kwc,
      capex_ttc: capexTtc,
      BASE_sans_pilotage: true,
      BASE_sans_batterie: true,
    },
    par_profil: rows,
    synthèse: {
      production_identique_tous_profils: prodSpread < 1e-6,
      écart_production_kWh: prodSpread,
      écart_autoconsommation_kWh: autoSpread,
      le_profil_modifie_autoconsommation: autoSpread > 50,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
