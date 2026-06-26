// ======================================================================
// Non-regression — Separation source conso / reconstruction / pilotage solaire
// Regle metier (26/06/2026) :
//  - Enedis horaire = verite ; jamais remodelee par statut/equipement.
//  - Pilotage solaire = option EXPLICITE (defaut false), jamais auto-deduite.
//  - Invariant : source=ENEDIS_HOURLY && piloting=false => calc_hash === base_hash.
// ======================================================================
import assert from "node:assert";
import test from "node:test";
import fs from "fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { buildPilotedProfile } from "../services/pilotageService.js";
import { simulateBattery8760 } from "../services/batteryService.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// Reproduit le routage insere dans calc.controller.js (profil de calcul unique).
const _hashHourly = (arr) =>
  Array.isArray(arr)
    ? arr
        .reduce((h, v, i) => (((h * 31) + Math.round((Number(v) || 0) * 1000) + i) >>> 0), (2166136261 >>> 0))
        .toString(16)
    : null;

function routeConso(ctx) {
  ctx.conso.base_hourly = ctx.conso.hourly;
  if (
    ctx.solar_piloting_enabled === true &&
    Array.isArray(ctx.conso_p_pilotee) &&
    ctx.conso_p_pilotee.length === 8760
  ) {
    ctx.conso.hourly = ctx.conso_p_pilotee;
    ctx.conso.clamped = ctx.conso_p_pilotee;
  }
  return {
    base_consumption_profile_hash: _hashHourly(ctx.conso.base_hourly),
    calculated_consumption_profile_hash: _hashHourly(ctx.conso.hourly),
    scenario_uses_piloted_profile: ctx.solar_piloting_enabled === true,
  };
}

function loadEnedis8760() {
  const csv = path.join(__dirname, "..", "backend", "loadcurve.csv");
  const rows = fs.readFileSync(csv, "utf8").trim().split("\n").slice(1);
  const w = [];
  for (const l of rows) {
    const x = Number(l.split(",")[2]);
    if (Number.isFinite(x)) w.push(x);
  }
  const arr = w.slice(0, 8760).map((v) => v / 1000);
  while (arr.length < 8760) arr.push(0.3);
  return arr;
}

function buildPV(t) {
  const a = new Array(8760).fill(0);
  for (let d = 0; d < 365; d++) {
    const df = 0.6 + 0.4 * Math.cos((2 * Math.PI * (d - 172)) / 365);
    const sr = 6 - 2 * Math.cos((2 * Math.PI * (d - 172)) / 365);
    const ss = 18 + 2 * Math.cos((2 * Math.PI * (d - 172)) / 365);
    for (let h = 0; h < 24; h++) {
      if (h < sr || h > ss) continue;
      const x = (h - 12) / ((ss - sr) / 2.5);
      a[d * 24 + h] += Math.exp(-0.5 * x * x) * df;
    }
  }
  const s = a.reduce((p, q) => p + q, 0);
  return a.map((v) => (v * t) / s);
}

const enedis = loadEnedis8760();
const pv = buildPV(6850);

test("T1 — Enedis + piloting=false : courbe reelle intacte (calc_hash === base_hash)", () => {
  const pil = buildPilotedProfile(enedis.slice(), pv, {});
  const ctx = {
    consumption_source: "ENEDIS_HOURLY",
    solar_piloting_enabled: false,
    conso_p_pilotee: pil.conso_pilotee_hourly,
    conso: { hourly: enedis.slice(), clamped: enedis.slice() },
  };
  const t = routeConso(ctx);
  assert.strictEqual(t.calculated_consumption_profile_hash, t.base_consumption_profile_hash);
  assert.strictEqual(t.scenario_uses_piloted_profile, false);
});

test("T2 — Enedis + piloting=true (usages valides) : pilote applique, annuel conserve, hashes differents", () => {
  const pil = buildPilotedProfile(enedis.slice(), pv, {});
  const ctx = {
    consumption_source: "ENEDIS_HOURLY",
    solar_piloting_enabled: true,
    usages_pilotables: ["ballon_ecs", "ve"],
    conso_p_pilotee: pil.conso_pilotee_hourly,
    conso: { hourly: enedis.slice(), clamped: enedis.slice() },
  };
  const t = routeConso(ctx);
  assert.notStrictEqual(t.calculated_consumption_profile_hash, t.base_consumption_profile_hash);
  assert.strictEqual(t.scenario_uses_piloted_profile, true);
  const a0 = enedis.reduce((p, q) => p + q, 0);
  const a1 = ctx.conso.hourly.reduce((p, q) => p + q, 0);
  assert.ok(Math.abs(a0 - a1) < 1, "annuel conserve");
});

test("T4/T5 — statut client et equipements seuls ne pilotent JAMAIS", () => {
  const ctx = {
    occupancy_profile: "retraite",
    equipements: ["ballon_ecs", "ve", "pac"],
    solar_piloting_enabled: false,
    conso_p_pilotee: null,
    conso: { hourly: enedis.slice() },
  };
  const t = routeConso(ctx);
  assert.strictEqual(t.scenario_uses_piloted_profile, false);
});

test("T8 — invariant energie : production = utilisee + injection + pertes batterie", () => {
  const battery = { enabled: true, capacity_kwh: 5, roundtrip_efficiency: 0.9, max_charge_kw: 2.5, max_discharge_kw: 2.5 };
  const total = enedis.reduce((p, q) => p + q, 0);
  const conso = enedis.map((v) => (v * 6000) / total);
  const r = simulateBattery8760({ pv_hourly: pv, conso_hourly: conso, battery });
  const gap = r.prod_kwh - r.auto_kwh - r.surplus_kwh - r.battery_losses_kwh;
  assert.ok(Math.abs(gap) <= 2, "invariant energie boucle, gap=" + gap);
});
