import { createHmac, timingSafeEqual } from 'node:crypto';

export const SHADING_ATTESTATION_VERSION = 'shading-attestation-v1';

function stable(value) {
  if (Array.isArray(value)) return value.map(stable);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.keys(value).sort().map(key => [key, stable(value[key])]));
}

function configuration() {
  const secret = process.env.SHADING_ATTESTATION_SECRET;
  const keyId = process.env.SHADING_ATTESTATION_KEY_ID;
  // No JWT fallback and no implicit test/development key. Missing configuration fails closed.
  if (typeof secret !== 'string' || Buffer.byteLength(secret, 'utf8') < 32 ||
      typeof keyId !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/.test(keyId)) return null;
  return { secret, keyId };
}

function signature(shading, config) {
  if (!shading || typeof shading !== 'object') return null;
  const { serverReceipt, ...assessment } = shading.assessment ?? {};
  const payload = {
    version: SHADING_ATTESTATION_VERSION,
    keyId: config.keyId,
    assessment,
    horizonMask: shading.horizonMask,
    farSource: shading.far?.source,
    totalLossPct: shading.totalLossPct,
    near: shading.near?.totalLossPct,
    far: shading.far?.totalLossPct,
    combined: shading.combined?.totalLossPct,
    perPanel: shading.perPanel,
    monthlyFactors: shading.monthlyFactors,
    distribution: shading.distribution,
  };
  return createHmac('sha256', config.secret)
    .update('calpinage-shading-attestation\n' + JSON.stringify(stable(payload)))
    .digest('hex');
}

export function sealServerShading(shading) {
  if (shading.assessment?.geometryContractVersion && shading.assessment.status === 'computed') {
    const config = configuration();
    if (!config) {
      const error = new Error('SHADING_ATTESTATION_CONFIG_UNAVAILABLE');
      error.code = 'SHADING_ATTESTATION_CONFIG_UNAVAILABLE';
      error.status = 503;
      throw error;
    }
    shading.assessment = {
      ...shading.assessment,
      serverReceipt: { version: SHADING_ATTESTATION_VERSION, keyId: config.keyId, digest: signature(shading, config) },
    };
  }
  return shading;
}

export function hasValidServerShadingReceipt(shading) {
  const config = configuration();
  const receipt = shading?.assessment?.serverReceipt;
  if (!config || !receipt || receipt.version !== SHADING_ATTESTATION_VERSION || receipt.keyId !== config.keyId ||
      typeof receipt.digest !== 'string' || !/^[a-f0-9]{64}$/.test(receipt.digest)) return false;
  const expected = signature(shading, config);
  return !!expected && timingSafeEqual(Buffer.from(expected, 'hex'), Buffer.from(receipt.digest, 'hex'));
}
