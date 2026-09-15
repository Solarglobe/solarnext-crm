import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHourOfDayHpFlags,
  buildHpHcHourlyMask,
  buildHourOfDayHpFractions,
  buildHpHcHourlyFractions,
  resolveHpHcHourlyFractions,
  resolveCurrentOffPeakPeriods,
  resolveHpHcHourlyMask,
  resolveOffPeakPeriods,
  parseEnedisOffPeakLabel,
  resolveKnownCurrentOffPeakPeriods,
} from "../services/pv/hphcMask.service.js";

const countHc = (flags) => flags.filter((isHp) => !isHp).length;

test("défaut 23h→07h : 8 HC / 16 HP, bonnes heures", () => {
  const flags = buildHourOfDayHpFlags(undefined);
  assert.equal(flags.length, 24);
  assert.equal(countHc(flags), 8, "8 heures creuses par défaut");
  // HC = 23,0,1,2,3,4,5,6 (false) ; HP = 7..22 (true)
  for (const h of [23, 0, 1, 2, 3, 4, 5, 6]) assert.equal(flags[h], false, `h${h} doit être HC`);
  for (const h of [7, 12, 18, 22]) assert.equal(flags[h], true, `h${h} doit être HP`);
});

test("masque 8760 = motif journalier répété", () => {
  const mask = buildHpHcHourlyMask();
  assert.equal(mask.length, 8760);
  assert.equal(mask[0], false); // minuit = HC
  assert.equal(mask[12], true); // midi = HP
  assert.equal(mask[24], mask[0]); // jour 2 même motif
  const totalHcHours = mask.filter((x) => !x).length;
  assert.equal(totalHcHours, 8 * 365, "8 HC/jour sur l'année");
});

test("plages réparties nuit + méridienne (réforme 2025/2026)", () => {
  const periods = [
    { start: "23:00", end: "06:00" }, // 7 h nuit
    { start: "12:00", end: "13:00" }, // 1 h jour
  ];
  const flags = buildHourOfDayHpFlags(periods);
  assert.equal(countHc(flags), 8, "7 + 1 = 8 HC");
  assert.equal(flags[12], false, "12h = HC (méridienne)");
  assert.equal(flags[6], true, "6h = HP (fin nuit à 6h)");
});

test("config invalide → retombe sur le défaut", () => {
  const flags = buildHourOfDayHpFlags([{ start: "oops", end: "??" }]);
  assert.equal(countHc(flags), 8);
});

test("resolveOffPeakPeriods lit la config devis puis défaut", () => {
  const custom = [{ start: "22:00", end: "06:00" }];
  assert.deepEqual(resolveOffPeakPeriods({ off_peak_periods: custom }, {}), custom);
  assert.equal(resolveHpHcHourlyMask({}, {}).length, 8760);
});

// ------------------------------------------------------------------
// LOT1-HC-WINDOW — parseEnedisOffPeakLabel (libellés C68 réels)
// ------------------------------------------------------------------

test("parse libellé C68 standard 'HC (22H30-6H30)'", () => {
  assert.deepEqual(parseEnedisOffPeakLabel("HC (22H30-6H30)"), [
    { start: "22:30", end: "06:30" },
  ]);
});

test("parse futures plages multiples 'HC (1H28-6H58;13H58-16H28)'", () => {
  assert.deepEqual(parseEnedisOffPeakLabel("HC (1H28-6H58;13H58-16H28)"), [
    { start: "01:28", end: "06:58" },
    { start: "13:58", end: "16:28" },
  ]);
});

test("parse heures sans minutes 'HC (23H-7H)' et minuscules/espaces", () => {
  assert.deepEqual(parseEnedisOffPeakLabel("hc ( 23h - 7h )"), [
    { start: "23:00", end: "07:00" },
  ]);
});

test("parse sans parenthèses '22H30-6H30'", () => {
  assert.deepEqual(parseEnedisOffPeakLabel("22H30-6H30"), [
    { start: "22:30", end: "06:30" },
  ]);
});

test("libellés inexploitables → null (l'appelant garde le défaut)", () => {
  assert.equal(parseEnedisOffPeakLabel(null), null);
  assert.equal(parseEnedisOffPeakLabel(""), null);
  assert.equal(parseEnedisOffPeakLabel("Heures creuses non renseignées"), null);
  assert.equal(parseEnedisOffPeakLabel("HC (99H99-88H88)"), null);
});

test("le masque historique conserve sa convention booléenne pour 22h30-6h30", () => {
  const periods = parseEnedisOffPeakLabel("HC (22H30-6H30)");
  const flags = buildHourOfDayHpFlags(periods);
  // 22:30→06:30 : h22 couverte 30 min (≥30 → HC), h23..h5 pleines, h6 couverte 30 min (HC)
  assert.equal(flags[22], false, "22h = HC (30 min couvertes)");
  assert.equal(flags[23], false, "23h = HC");
  assert.equal(flags[5], false, "5h = HC");
  assert.equal(flags[6], false, "6h = HC (30 min couvertes)");
  assert.equal(flags[7], true, "7h = HP");
  assert.equal(flags[21], true, "21h = HP");
  const mask = buildHpHcHourlyMask(periods);
  assert.equal(mask.length, 8760);
});

test("valorisation 22h30–6h30 : exactement 8 HC par jour, deux heures mixtes", () => {
  const periods = parseEnedisOffPeakLabel("HC (22H30-6H30)");
  const fractions = buildHourOfDayHpFractions(periods);
  assert.equal(fractions[22], 0.5);
  assert.equal(fractions[6], 0.5);
  assert.equal(fractions[23], 0);
  assert.equal(fractions[7], 1);
  assert.equal(fractions.reduce((hc, hp) => hc + 1 - hp, 0), 8);
  const hourly = buildHpHcHourlyFractions(periods);
  assert.equal(hourly.length, 8760);
  assert.equal(hourly.reduce((hc, hp) => hc + 1 - hp, 0), 8 * 365);
  assert.deepEqual(resolveHpHcHourlyFractions({ off_peak_periods: periods }, {}), hourly);
});

test("plages à la minute et chevauchantes : aucune minute perdue ni comptée deux fois", () => {
  const exact = buildHourOfDayHpFractions(parseEnedisOffPeakLabel("HC (1H28-6H58;13H58-16H28)"));
  assert.ok(Math.abs(exact.reduce((hc, hp) => hc + 1 - hp, 0) - 8) < 1e-10);
  const overlap = buildHourOfDayHpFractions([
    { start: "22:30", end: "06:30" },
    { start: "23:00", end: "02:00" },
  ]);
  assert.equal(overlap.reduce((hc, hp) => hc + 1 - hp, 0), 8);
  assert.ok(overlap.every((hp) => hp >= 0 && hp <= 1));
});

test("les horaires de référence viennent du compteur, jamais de la batterie virtuelle", () => {
  const current = [{ start: "22:30", end: "06:30" }];
  const future = [{ start: "12:00", end: "20:00" }];
  const ctx = {
    form: { params: { off_peak_periods: current } },
    virtual_battery_input: { off_peak_periods: future },
    settings: { pv: { virtual_battery: { off_peak_periods: future } } },
  };
  assert.deepEqual(resolveCurrentOffPeakPeriods(ctx), current);
  delete ctx.form.params.off_peak_periods;
  assert.deepEqual(resolveCurrentOffPeakPeriods(ctx), [{ start: "23:00", end: "07:00" }]);
});

test("ancien résumé importé seul restitue les heures creuses réelles à la minute", () => {
  const profile = { engine: { contract_summary: "HP/HC (22H30-6H30) — 18 kVA — 230/400 V" } };
  const actual = [{ start: "22:30", end: "06:30" }];
  assert.deepEqual(resolveKnownCurrentOffPeakPeriods(profile), actual);
  const fractions = buildHourOfDayHpFractions(resolveKnownCurrentOffPeakPeriods(profile));
  assert.equal(fractions[22], 0.5);
  assert.equal(fractions[6], 0.5);
  assert.equal(fractions.reduce((hc, hp) => hc + 1 - hp, 0), 8);
  const ctx = { form: { lead: { energy_profile: profile } } };
  assert.deepEqual(resolveCurrentOffPeakPeriods(ctx), actual);
  assert.deepEqual(resolveOffPeakPeriods({}, ctx), actual);
  const future = [{ start: "01:00", end: "09:00" }];
  assert.deepEqual(resolveOffPeakPeriods({ off_peak_periods: future }, ctx), future);
  assert.deepEqual(resolveCurrentOffPeakPeriods({ ...ctx, virtual_battery_input: { off_peak_periods: future } }), actual);
});

test("contrat structuré courant prioritaire sur son libellé et sur le résumé historique", () => {
  const current = [{ start: "01:28", end: "06:58" }, { start: "13:58", end: "16:28" }];
  const profile = {
    contract: { off_peak_periods: current, plage_hc: "HC (22H30-6H30)", future_off_peak_periods: [{ start: "12:00", end: "20:00" }] },
    engine: { contract_summary: "HP/HC (23H-7H) — 18 kVA" },
  };
  assert.deepEqual(resolveKnownCurrentOffPeakPeriods(profile), current);
  const copied = resolveKnownCurrentOffPeakPeriods(profile);
  copied[0].start = "00:00";
  assert.equal(profile.contract.off_peak_periods[0].start, "01:28");
  delete profile.contract.off_peak_periods;
  assert.deepEqual(resolveKnownCurrentOffPeakPeriods(profile), [{ start: "22:30", end: "06:30" }]);
});

test("sans horaires actuels exploitables, aucune future plage ni horaire supposé n’est retenu", () => {
  for (const profile of [
    {},
    { contract: { future_off_peak_periods: [{ start: "12:00", end: "20:00" }], futures_plages_hc: "HC (0H56-6H56;14H56-16H56)" } },
    { engine: { contract_summary: "HP/HC — 18 kVA — 230/400 V" } },
    { engine: { contract_summary: "Futures plages HP/HC (0H56-6H56;14H56-16H56)" } },
    { engine: { contract_summary: "Base (22H30-6H30) — 18 kVA" } },
    { engine: { contract_summary: "HP/HC (99H-7H) — 18 kVA" } },
  ]) assert.equal(resolveKnownCurrentOffPeakPeriods(profile), null);
});
