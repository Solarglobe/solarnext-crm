import assert from "node:assert/strict";
import test from "node:test";
import {
  buildHourOfDayHpFlags,
  buildHpHcHourlyMask,
  resolveHpHcHourlyMask,
  resolveOffPeakPeriods,
  parseEnedisOffPeakLabel,
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

test("bout en bout : libellé C68 → masque 8760 (fenêtre Bedouelle 22h30-6h30)", () => {
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
