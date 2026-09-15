/** Only an assessed current result is authoritative; numeric form defaults are not evidence. */
import { getOfficialGlobalShadingLossPct } from './officialShadingTruth.js';
export function resolveShadingTotalLossPct(shading, _form) {
  return getOfficialGlobalShadingLossPct(shading);
}