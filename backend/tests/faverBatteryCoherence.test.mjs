// ======================================================================
// Anti-régression FAVER — cohérence moteur batterie (8760 vs mensuel)
// Garantit que :
//   1) la batterie physique 8760 ne ressort JAMAIS à 95,5 % d'autoconso ni 244 cycles/an
//      sur le profil très hivernal de FAVER (conso forte l'hiver, faible l'été) ;
//   2) le bonus mensuel d'autoconsommation est neutralisé (= 1.0) ;
//   3) le fallback mensuel n'inflate plus l'autoconsommation batterie (auto == base mensuelle).
// Contexte : cf. AUDIT_FAVER_COHERENCE_MOTEUR_4_SCENARIOS_2026-06-25.md
// ======================================================================
import test from "node:test";
import assert from "node:assert/strict";
import { buildHourlyPV } from "../services/solarModelService.js";
import { simulateBattery8760 } from "../services/batteryService.js";
import { SCENARIO_MONTHLY_BATTERY_AUTO_BOOST } from "../services/core/engineConstants.js";

const DAYS = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
const sum = (a) => a.reduce((x, y) => x + y, 0);

// Conso mensuelle réelle FAVER (16 000 kWh/an, très hivernale)
const CONSO_M = [2860, 2340, 1820, 910, 600, 540, 510, 510, 840, 910, 1690, 2470];
// Forme horaire résidentielle (pic du soir) — même chaque jour (cf. energyCalculator)
const RES = [0.62, 0.56, 0.52, 0.50, 0.54, 0.72, 0.98, 1.18, 1.06, 0.92, 0.86, 0.88,
             0.94, 0.90, 0.86, 0.92, 1.08, 1.32, 1.48, 1.42, 1.24, 1.02, 0.84, 0.70];
const RESS = sum(RES);

function buildConsoHourly() {
  const h = [];
  for (let m = 0; m < 12; m++) {
    const daily = CONSO_M[m] / DAYS[m];
    for (let d = 0; d < DAYS[m]; d++) for (let hr = 0; hr < 24; hr++) h.push(daily * RES[hr] / RESS);
  }
  return h;
}

// Production Ouest ~5924 kWh/an, profil horaire via le VRAI moteur PV du repo
function buildPvHourly() {
  let pvM = [175, 265, 430, 560, 690, 760, 800, 700, 520, 330, 210, 484];
  const k = 5924 / sum(pvM);
  pvM = pvM.map((v) => v * k);
  return buildHourlyPV(pvM, { site: { lat: 45.5, lon: 4.8 } });
}

const CAPACITE_UTILE_KWH = 7;
const battery = { enabled: true, capacity_kwh: CAPACITE_UTILE_KWH, roundtrip_efficiency: 0.90, max_charge_kw: 3.5, max_discharge_kw: 3.5 };

test("FAVER : batterie physique 8760 reste physiquement plausible (jamais 95,5 % / 244 cycles)", () => {
  const conso = buildConsoHourly();
  const pv = buildPvHourly();

  const base = simulateBattery8760({ pv_hourly: pv, conso_hourly: conso, battery: { enabled: false } });
  const batt = simulateBattery8760({ pv_hourly: pv, conso_hourly: conso, battery });

  const prod = batt.prod_kwh;
  const autoPctBase = (100 * base.auto_kwh) / prod;
  const autoPctBatt = (100 * batt.auto_kwh) / prod;
  const cycles = batt.annual_discharge_kwh / CAPACITE_UTILE_KWH;
  const jump = autoPctBatt - autoPctBase;

  // 1) Jamais la valeur "mensuelle" gonflée de la capture
  assert.ok(autoPctBatt < 90, `autoconso batterie ${autoPctBatt.toFixed(1)}% doit rester < 90% (capture buguée = 95,5%)`);
  assert.ok(cycles < 200, `cycles ${cycles.toFixed(0)} doivent rester < 200/an (capture buguée = 244)`);

  // 2) Le saut autoconso d'une batterie 7 kWh ne peut pas dépasser le plafond physique 8760 (~+22 pts)
  assert.ok(jump <= 22, `saut autoconso +${jump.toFixed(1)} pts dépasse le plafond physique 8760 (~+22 pts) → modèle mensuel ?`);

  // 3) Hiver (Déc+Jan+Fév) : la batterie ne stocke pas l'été pour l'hiver → décharge quasi nulle
  let dischargeWinter = 0;
  let idx = 0;
  for (let m = 0; m < 12; m++) {
    for (let d = 0; d < DAYS[m]; d++) for (let hr = 0; hr < 24; hr++) {
      if (m === 11 || m === 0 || m === 1) dischargeWinter += batt.batt_discharge_hourly[idx];
      idx++;
    }
  }
  assert.ok(dischargeWinter < 60, `décharge hiver ${dischargeWinter.toFixed(0)} kWh doit être quasi nulle (pas de stockage intersaisonnier)`);

  // 4) Plage attendue après correction (cf. objectif : 75-81 % d'autoconso, ~1130-1220 kWh déchargés)
  assert.ok(batt.annual_discharge_kwh >= 900 && batt.annual_discharge_kwh <= 1400,
    `décharge annuelle ${batt.annual_discharge_kwh} kWh hors plage 8760 plausible (900-1400)`);
});

test("Le bonus mensuel d'autoconsommation est neutralisé (= 1.0)", () => {
  assert.equal(SCENARIO_MONTHLY_BATTERY_AUTO_BOOST, 1.0,
    "SCENARIO_MONTHLY_BATTERY_AUTO_BOOST doit valoir 1.0 (aucun bonus) pour éviter l'inflation mensuelle");
});

test("Fallback mensuel : la batterie n'inflate plus l'autoconsommation (auto batt == auto base)", () => {
  // Réplique de scenarioService.js l.241 (base) et l.243-256 (batterie, boost neutralisé)
  let pvM = [175, 265, 430, 560, 690, 760, 800, 700, 520, 330, 210, 484];
  const k = 5924 / sum(pvM);
  pvM = pvM.map((v) => v * k);
  let autoBase = 0, autoBatt = 0;
  for (let i = 0; i < 12; i++) {
    const p = pvM[i], c = CONSO_M[i];
    const direct = Math.min(p, c);
    autoBase += Math.round(direct);
    autoBatt += Math.round(Math.min(p, c, direct * SCENARIO_MONTHLY_BATTERY_AUTO_BOOST));
  }
  assert.equal(autoBatt, autoBase,
    "en fallback mensuel, la batterie ne doit créditer aucune autoconso supplémentaire (boost neutralisé)");
});
