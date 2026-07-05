/**
 * Phase 3A — Tests du helper de disponibilité V2H.
 * Prouve notamment que les week-ends se décalent correctement selon l'année
 * de simulation (pas de 2026 figé qui décalerait les jours en prod).
 *
 * Faits calendaires : 1er janv 2026 = jeudi ; 1er janv 2025 = mercredi.
 *   → jours (index) : 2026 samedi=2, dimanche=3 ; 2025 samedi=3, dimanche=4.
 *
 * Lancement : node --test services/__tests__/v2hAvailability.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { buildV2hAvailabilityHourly, DEFAULT_SIMULATION_YEAR } from "../v2hAvailability.js";

const PRES = { weekday_plug_in_hour: 18, weekday_departure_hour: 7, weekend_present: true };

test("longueur 8760 et valeurs 0/1", () => {
  const a = buildV2hAvailabilityHourly(PRES, 2026);
  assert.equal(a.length, 8760);
  assert.ok(a.every((v) => v === 0 || v === 1));
});

test("déterministe : même année → tableau identique", () => {
  assert.deepEqual(buildV2hAvailabilityHourly(PRES, 2026), buildV2hAvailabilityHourly(PRES, 2026));
});

test("les week-ends se décalent selon l'année (2025 vs 2026)", () => {
  const a25 = buildV2hAvailabilityHourly(PRES, 2025);
  const a26 = buildV2hAvailabilityHourly(PRES, 2026);
  // h=60 = jour index 2, 12h (journée). 2026 = samedi (branché) ; 2025 = vendredi (débranché en journée).
  assert.equal(a26[60], 1, "2026 jour2 12h = samedi → branché");
  assert.equal(a25[60], 0, "2025 jour2 12h = vendredi journée → débranché");
  // h=108 = jour index 4, 12h. 2026 = lundi (débranché) ; 2025 = dimanche (branché).
  assert.equal(a26[108], 0, "2026 jour4 12h = lundi journée → débranché");
  assert.equal(a25[108], 1, "2025 jour4 12h = dimanche → branché");
  // et globalement les deux tableaux diffèrent
  assert.notDeepEqual(a25, a26);
});

test("fenêtre semaine : branché la nuit, débranché en journée (jour ouvré)", () => {
  const a = buildV2hAvailabilityHourly(PRES, 2026);
  // jour index 0 (2026 = jeudi, ouvré). 2h du matin → branché ; 12h → débranché.
  assert.equal(a[2], 1, "jeudi 2h → branché (nuit)");
  assert.equal(a[12], 0, "jeudi 12h → débranché (journée)");
});

test("weekend_present=false → week-end débranché", () => {
  const a = buildV2hAvailabilityHourly({ ...PRES, weekend_present: false }, 2026);
  // jour index 2 (samedi 2026), 12h → débranché
  assert.equal(a[60], 0);
});

test("unavailable_weeks : une semaine d'été entièrement absente", () => {
  const a0 = buildV2hAvailabilityHourly(PRES, 2026);
  const a1 = buildV2hAvailabilityHourly({ ...PRES, unavailable_weeks: 1 }, 2026);
  // semaine 30 (été) : au moins une heure passe de branché à 0
  const wStart = 30 * 7 * 24;
  let changed = 0;
  for (let h = wStart; h < wStart + 7 * 24; h++) {
    assert.equal(a1[h], 0, `vacances : h=${h} doit être 0`);
    if (a0[h] === 1) changed++;
  }
  assert.ok(changed > 0, "des heures normalement branchées deviennent absentes en vacances");
});

test("DEFAULT_SIMULATION_YEAR exporté et cohérent (défaut = sans année)", () => {
  assert.equal(typeof DEFAULT_SIMULATION_YEAR, "number");
  assert.deepEqual(buildV2hAvailabilityHourly(PRES), buildV2hAvailabilityHourly(PRES, DEFAULT_SIMULATION_YEAR));
});

// ─── Mode grille 7×24 (Phase : présence par jour) ───
test("grille : plusieurs plages/jour (branché 0-16 ET 20-24 → débranché 16-19)", () => {
  const grid = Array.from({ length: 7 }, () => {
    const row = Array(24).fill(true);
    for (let hod = 16; hod < 20; hod++) row[hod] = false; // débranché 16h→19h
    return row;
  });
  const a = buildV2hAvailabilityHourly({ presence_grid: grid }, 2026);
  assert.equal(a.length, 8760);
  assert.equal(a[12], 1, "12h branché");
  assert.equal(a[17], 0, "17h débranché");
  assert.equal(a[22], 1, "22h branché");
});

test("grille : jours mappés lun=0..dim=6 (2026 : 1er janv = jeudi)", () => {
  const grid = Array.from({ length: 7 }, (_, d) => Array(24).fill(d === 0)); // seul lundi branché
  const a = buildV2hAvailabilityHourly({ presence_grid: grid }, 2026);
  assert.equal(a[4 * 24 + 10], 1, "Jan 5 = lundi → branché");
  assert.equal(a[5 * 24 + 10], 0, "Jan 6 = mardi → débranché");
  assert.equal(a[0 * 24 + 10], 0, "Jan 1 = jeudi → débranché");
});

test("grille invalide → repli mode legacy (pas de crash)", () => {
  const a = buildV2hAvailabilityHourly({ presence_grid: [[true]], weekday_plug_in_hour: 18, weekday_departure_hour: 7 }, 2026);
  assert.equal(a.length, 8760);
});
