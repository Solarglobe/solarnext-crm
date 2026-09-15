import { getShadingAssessment } from './shadingAssessment.js';

export const CLIENT_STUDY_EXPORT_BLOCKED = 'PDF_BLOCKED_SHADING_ASSESSMENT';
export const CLIENT_STUDY_EXPORT_MESSAGE = 'Export client bloqué : ombrage non évalué ou résultat périmé. Complétez les données et recalculez l’étude.';

/** Fixed-depth selected-result check. Never traverse scenarios, historical results or hourly arrays. */
export function getClientStudyExportBlock(value) {
  const selected = value?.selected_scenario_snapshot;
  const nodes = [value, value?.data_json, value?.scenario_result, selected, selected?.scenario_result, value?.consumption_trace, selected?.consumption_trace, value?.scenario_result?.consumption_trace];
  const reasons = [];
  for (const node of nodes) {
    if (node?.needs_recompute === true) reasons.push('needs_recompute');
    if (node?.display_blocked === true) reasons.push('display_blocked');
    if (node?.documentPurpose === 'internal_diagnostic') reasons.push('internal_diagnostic');
  }
  const candidates = nodes.filter(Boolean).filter(node => node.shading != null).map(node => node.shading);
  // A view model retains the canonical selected snapshot. The display-only p_shading is never evidence of validity.
  if (candidates.length === 0) reasons.push('not_calculated');
  for (const shading of candidates) {
    if (shading.needs_recompute === true) reasons.push('needs_recompute');
    if (shading.display_blocked === true) reasons.push('display_blocked');
    const assessment = getShadingAssessment(shading);
    if (assessment.status !== 'computed') reasons.push(assessment.status);
  }
  return { blocked: reasons.length > 0, code: CLIENT_STUDY_EXPORT_BLOCKED, message: CLIENT_STUDY_EXPORT_MESSAGE, reasons: [...new Set(reasons)] };
}

export function assertClientStudyExportable(value) {
  const result = getClientStudyExportBlock(value);
  if (result.blocked) {
    const error = new Error(result.message);
    error.code = result.code;
    error.status = error.statusCode = 409;
    error.details = result;
    throw error;
  }
  return result;
}
