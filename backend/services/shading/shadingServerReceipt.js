import { createHmac, timingSafeEqual } from 'node:crypto';

function stable(v) {
  if (Array.isArray(v)) return v.map(stable);
  if (!v || typeof v !== 'object') return v;
  return Object.fromEntries(Object.keys(v).sort().map(k=>[k,stable(v[k])]));
}
function signature(s) {
  if (!s || typeof s !== "object") return null;
  const key=process.env.JWT_SECRET;
  if (!key || key.length<32) return null;
  const {serverReceipt, ...assessment}=s.assessment ?? {};
  // Bind the computed status, every exposed loss, and the version/input hashes.
  const payload={assessment,horizonMask:s.horizonMask,farSource:s.far?.source,totalLossPct:s.totalLossPct,near:s.near?.totalLossPct,far:s.far?.totalLossPct,combined:s.combined?.totalLossPct,perPanel:s.perPanel,monthlyFactors:s.monthlyFactors,distribution:s.distribution};
  return createHmac('sha256',key).update('calpinage-shading-v1\n'+JSON.stringify(stable(payload))).digest('hex');
}
export function sealServerShading(s) {
  if (s.assessment?.geometryContractVersion && s.assessment.status==='computed') {
    const receipt=signature(s);
    if (!receipt) throw new Error('SHADING_SERVER_RECEIPT_KEY_UNAVAILABLE');
    s.assessment={...s.assessment,serverReceipt:receipt};
  }
  return s;
}
export function hasValidServerShadingReceipt(s) {
  const expected=signature(s),actual=s?.assessment?.serverReceipt;
  return !!expected && typeof actual==='string' && /^[a-f0-9]{64}$/.test(actual) && timingSafeEqual(Buffer.from(expected,'hex'),Buffer.from(actual,'hex'));
}
