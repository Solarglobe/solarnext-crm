import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { loadConsumption, applyEquipmentShape } from '../services/consumptionService.js';

const sum = (values) => values.reduce((a, b) => a + b, 0);
const meter = (annual, hourly) => ({
  meter_consumption_authoritative: true,
  annuelle_kwh: annual,
  mode: 'annuelle',
  hourly,
});

test('le compteur choisi conserve son total malgré un CSV prioritaire et une ancienne courbe', (t) => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'meter-consumption-'));
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }));
  const csv = path.join(dir, 'consumption.csv');
  // Un CSV invalide ne doit même pas être relu par le calcul de l’étude.
  fs.writeFileSync(csv, 'not a consumption file');
  for (const annual of [12075, 4500]) {
    const out = loadConsumption(meter(annual, Array(8760).fill(7125 / 8760)), csv);
    assert.equal(out.annual_kwh, annual);
    assert.ok(Math.abs(sum(out.hourly) - annual) < 1e-6);
  }
});

test('une courbe compteur déjà calculée est conservée heure par heure, sans écrêtage ni remodelage', () => {
  const hourly = Array(8760).fill(1);
  hourly[0] = 3316;
  const input = { ...meter(12075, hourly), puissance_kva: 15, equipement_actuel: 'VE' };
  const out = applyEquipmentShape(loadConsumption(input), input);
  assert.deepEqual(out.hourly, hourly);
  assert.equal(out.annual_kwh, 12075);
});

test('saisie sans courbe : répartit uniquement le total enregistré dans le compteur', () => {
  for (const input of [meter(12075), { ...meter(12075), mode: 'mensuelle', mensuelle: Array(12).fill(500) }]) {
    const out = loadConsumption(input);
    assert.equal(out.annual_kwh, 12075);
    assert.ok(Math.abs(sum(out.hourly) - 12075) < 1e-6);
  }
});

test('une référence compteur absente ou invalide ne déclenche pas une estimation nationale', () => {
  for (const value of [null, undefined, -1, NaN]) {
    assert.throws(() => loadConsumption(meter(value)), /SELECTED_METER_CONSUMPTION_MISSING/);
  }
});
