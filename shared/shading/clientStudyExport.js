import { getShadingAssessment, getShadingComponentLossPct } from './shadingAssessment.js';
export const CLIENT_STUDY_EXPORT_BLOCKED = 'PDF_BLOCKED_CURRENT_STUDY';
export const CLIENT_STUDY_EXPORT_MESSAGE = 'Export impossible : les données de l’étude doivent être recalculées ou complétées.';
export const SHADING_EXPORT_WARNING = 'L’analyse d’ombrage n’est pas disponible. Le PDF sera généré sans prise en compte de l’ombrage local.';
export const SHADING_EXCLUSION_METHODOLOGY = 'Analyse d’ombrage local non réalisée. Les estimations de production et d’économies présentées ne tiennent pas compte d’éventuels ombrages proches. Ce point devra être confirmé avant l’installation.';
/** Display policy only. The backend separately verifies the receipt and current inputs. */
export function getStudyShadingState(value) {
  const selected = value?.selected_scenario_snapshot;
  const shading = selected?.shading ?? value?.shading ?? value?.scenario_result?.shading;
  const assessment = getShadingAssessment(shading);
  const receipt = assessment.serverReceipt;
  const loss = getShadingComponentLossPct(shading, 'combined');
  const reason = assessment.status !== 'computed' ? assessment.status
    : shading?.needs_recompute || shading?.display_blocked ? 'stale'
    : !receipt?.keyId || !receipt?.digest || receipt?.version !== 'shading-attestation-v1' ? 'attestation_missing'
    : loss == null ? 'insufficient_data' : null;
  return { shadingIncluded: reason === null, shadingApplied: reason === null,
    shadingLossPct: reason === null ? loss : null, shadingExclusionReason: reason };
}
/** Only study/energy invalidity blocks a regular PDF. Shading flags belong to shading. */
export function getClientStudyExportBlock(value) {
  const selected = value?.selected_scenario_snapshot;
  const nodes = [value, value?.data_json, value?.scenario_result, selected, selected?.scenario_result];
  const reasons = value == null ? ["snapshot_missing"] : [];
  for (const node of nodes) {
    if (node?.needs_recompute === true) reasons.push('needs_recompute');
    if (node?.display_blocked === true) reasons.push('display_blocked');
    if (node?.documentPurpose === 'internal_diagnostic') reasons.push('internal_diagnostic');
  }
  return { blocked: reasons.length > 0, code: CLIENT_STUDY_EXPORT_BLOCKED, message: CLIENT_STUDY_EXPORT_MESSAGE, reasons: [...new Set(reasons)] };
}
export function assertClientStudyExportable(value) {
  const result = getClientStudyExportBlock(value);
  if (result.blocked) throw Object.assign(new Error(result.message), {
    code: result.code, status: 409, statusCode: 409, details: result,
  });
  return result;
}
export function studyArchiveWarning(date) {
  const parsed = date == null ? new Date(NaN) : new Date(date);
  const label = Number.isFinite(parsed.getTime()) ? parsed.toLocaleDateString('fr-FR', { timeZone: 'Europe/Paris' }) : 'date non renseignée';
  return `Document archivé généré le ${label}. Il reflète les données disponibles à cette date et peut ne plus correspondre à la configuration actuelle. Son analyse d’ombrage n’est pas vérifiée selon la méthode actuelle.`;
}
