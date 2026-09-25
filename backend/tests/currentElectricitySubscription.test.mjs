import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveCurrentElectricitySubscription as resolve } from '../../shared/currentElectricitySubscription.js';

test('reference subscription is dated, TTC and distinct from the actual customer offer', () => {
  const result = resolve({ meterKva: 9, tariffType: 'HP/HC' });
  assert.equal(result.monthly, 19.88);
  assert.equal(result.annual, 238.56);
  assert.equal(result.source, 'EDF_REFERENCE_ESTIMATE');
  assert.equal(result.isEstimate, true);
  assert.equal(result.reference.effective_date, '2026-08-01');
  assert.equal(result.reference.price_basis, 'TTC');
  assert.equal(result.reference.tariff_type, 'HPHC');
});

test('Base and HP/HC use the same reference subscription; Tempo has its own grid', () => {
  assert.equal(resolve({ meterKva: 3, tariffType: 'BASE' }).annual, 145.56);
  assert.equal(resolve({ meterKva: 3, tariffType: 'HPHC' }).annual, 145.56);
  assert.equal(resolve({ meterKva: 3, tariffType: 'TEMPO' }).annual, null);
  assert.equal(resolve({ meterKva: 9, tariffType: 'TEMPO' }).annual, 236.40);
  assert.equal(resolve({ meterKva: 36, tariffType: 'BASE' }).annual, 646.56);
});

test('manual values including zero take priority; invalid input is not replaced', () => {
  for (const amount of [0, 12.5, 44]) {
    const result = resolve({ monthly: amount, meterKva: 9, tariffType: 'BASE' });
    assert.equal(result.annual, amount * 12);
    assert.equal(result.isEstimate, false);
    assert.equal(result.reference, null);
  }
  assert.equal(resolve({ annual: 0, monthly: 10, meterKva: 9, tariffType: 'BASE' }).annual, 0);
  for (const amount of [-1, 'invalid', Infinity, false]) {
    const result = resolve({ monthly: amount, meterKva: 9, tariffType: 'BASE' });
    assert.equal(result.invalid, true);
    assert.equal(result.annual, null);
    assert.equal(result.isEstimate, false);
  }
});

test('missing inputs and unavailable powers never silently become 9 kVA or Base', () => {
  for (const input of [
    {}, { meterKva: 9 }, { tariffType: 'BASE' },
    { meterKva: 8, tariffType: 'BASE' }, { meterKva: 9.1, tariffType: 'BASE' },
    { meterKva: 99, tariffType: 'BASE' }, { meterKva: 9, tariffType: 'EJP', hpHc: true },
  ]) {
    const result = resolve(input);
    assert.equal(result.annual, null);
    assert.equal(result.isEstimate, false);
    assert.ok(result.missing.length);
  }
  assert.equal(resolve({ meterKva: 9, hpHc: false }).annual, 238.56);
  assert.equal(resolve({ meterKva: 9, hpHc: true }).reference.tariff_type, 'HPHC');
});

test('editing and clearing the manual subscription restores a fresh estimate without modifying input', () => {
  const input = { meterKva: 9, tariffType: 'BASE', monthly: null };
  assert.equal(resolve(input).isEstimate, true);
  assert.equal(input.monthly, null);
  input.monthly = 15;
  assert.equal(resolve(input).annual, 180);
  input.monthly = null;
  input.meterKva = 12;
  assert.equal(resolve(input).annual, 285.12);
});
