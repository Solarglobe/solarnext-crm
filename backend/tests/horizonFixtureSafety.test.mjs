import test from 'node:test';
import assert from 'node:assert/strict';
import { computeHorizonMaskAuto } from '../services/horizon/providers/horizonProviderSelector.js';

test('a deterministic horizon is confined to tests; production provider failure remains unavailable', async () => {
  const saved = { ...process.env };
  const originalFetch = globalThis.fetch;
  let calls = 0;
  try {
    delete process.env.DSM_PROVIDER_TYPE;
    process.env.DSM_ENABLE = 'false';
    process.env.SOLARNEXT_UNIT_HORIZON_FIXTURE = 'true';
    globalThis.fetch = async () => { calls++; throw new Error('Fictional unavailable provider'); };
    process.env.NODE_ENV = 'test';
    const fictional = await computeHorizonMaskAuto({ lat: 0, lon: 0 });
    assert.equal(fictional.meta.fixture, true);
    assert.ok(fictional.mask.length > 0);
    assert.equal(calls, 0);
    process.env.NODE_ENV = 'production';
    const production = await computeHorizonMaskAuto({ lat: 0, lon: 0 });
    assert.equal(production.source, 'FAR_UNAVAILABLE_ERROR');
    assert.deepEqual(production.mask, []);
    assert.notEqual(production.meta.fixture, true);
    assert.ok(calls > 0);
  } finally {
    for (const key of Object.keys(process.env)) if (!(key in saved)) delete process.env[key];
    Object.assign(process.env, saved);
    globalThis.fetch = originalFetch;
  }
});
