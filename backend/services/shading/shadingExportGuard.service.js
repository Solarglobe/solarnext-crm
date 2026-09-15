import { SHADING_PAN_MISMATCH_BLOCK_DELTA } from './shadingCommercialAudit.service.js';

export const SHADING_EXPORT_BLOCKING_CODES = Object.freeze([
  'SHADING_GEOMETRY_INPUT_INCOMPLETE',
  'SHADING_PAN_VALUES_INCONSISTENT',
]);
const criticalGeometry = new Set(['OBSTACLE_HEIGHT_MISSING', 'SHADING_SCALE_MISSING']);

/** Preserve qualitative legacy warnings, but never waive demonstrated missing inputs. */
export function shadingExportBlockers({audit=null,assumptions={}}={}) {
  const flags=audit?.flags??{};
  const geometry=[...(Array.isArray(flags.geometryWarnings)?flags.geometryWarnings:[]),
    ...(Array.isArray(assumptions.shading_geometry_strict_warnings)?assumptions.shading_geometry_strict_warnings:[])];
  const missing=Array.from(new Set(geometry.filter(w=>criticalGeometry.has(w))));
  const rawDelta=flags.shadingPanMismatchAbsDiff??assumptions.shading_pan_mismatch_abs_diff;
  const delta=rawDelta==null?null:Number(rawDelta);
  const blockers=[];
  if(missing.length)blockers.push({code:'SHADING_GEOMETRY_INPUT_INCOMPLETE',message:`Géométrie d'ombrage à compléter : ${missing.join(', ')}`,missing_fields:missing});
  if(Number.isFinite(delta)&&delta>=SHADING_PAN_MISMATCH_BLOCK_DELTA)blockers.push({code:'SHADING_PAN_VALUES_INCONSISTENT',message:`Les pertes d'ombrage divergent de ${delta} points entre les pans et le calcul serveur.`,absolute_difference_pct:delta,threshold_pct:SHADING_PAN_MISMATCH_BLOCK_DELTA});
  return blockers;
}
