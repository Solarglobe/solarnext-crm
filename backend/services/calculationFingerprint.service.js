import { createHash } from 'node:crypto';
import { CALC_ENGINE_VERSION } from './calc/calc.constants.js';

// JSON semantics, stable key ordering; array order and interval timestamps are significant.
export function canonicalJson(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (value instanceof Date) return JSON.stringify(value.toISOString());
  if (Array.isArray(value)) return `[${value.map(v => canonicalJson(v) ?? 'null').join(',')}]`;
  return `{${Object.keys(value).sort().filter(k => value[k] !== undefined)
    .map(k => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(',')}}`;
}

export function fingerprint(value) {
  return createHash('sha256').update(canonicalJson(value)).digest('hex');
}

export function quoteFingerprint(config) { return fingerprint(config ?? {}); }

export function calculationFreshness(data, currentFingerprint, engineVersion = CALC_ENGINE_VERSION) {
  const stored = data?.calculation_trace?.input_fingerprint ?? null;
  const reason = !stored ? 'INPUT_FINGERPRINT_MISSING'
    : data?.scenarios_engine_version !== engineVersion ? 'ENGINE_VERSION_CHANGED'
      : stored !== currentFingerprint ? 'CALCULATION_INPUTS_CHANGED' : null;
  return { needs_recompute: reason !== null, stale_reason: reason,
    input_fingerprint: stored, current_input_fingerprint: currentFingerprint,
    export_blocked: reason !== null };
}

export function calculationConflict(code = 'CALCULATION_INPUTS_CHANGED') {
  return Object.assign(new Error('Données modifiées — recalcul nécessaire'), { code, status: 409 });
}

export function assertQuoteRevision(expected, actual) {
  if (typeof expected !== 'string' || !expected) throw calculationConflict('SAVED_QUOTE_REVISION_REQUIRED');
  if (expected !== actual) throw calculationConflict('QUOTE_REVISION_CHANGED');
}

export function detectedGridPhase(meter) {
  const value = String(meter?.energy_profile?.engine?.phase_detection
    ?? meter?.energy_profile?.phase_detection ?? meter?.grid_type ?? '').toUpperCase();
  if (value.includes('TRI') || value === '3') return 'TRI';
  if (value.includes('MONO') || value === '1') return 'MONO';
  return null;
}

export function assertElectricalPhaseDecision(config, detectedPhase) {
  const retained = config?.installer_cost?.electrical_type ?? null;
  if (!detectedPhase || !retained || detectedPhase === retained) return;
  const decision = config?.electrical_phase_decision;
  if (decision?.detected_phase !== detectedPhase || decision?.retained_phase !== retained
    || decision?.difference_confirmed !== true) {
    throw Object.assign(new Error('Confirmez la différence entre la phase du compteur et la phase technique retenue.'),
      { code: 'ELECTRICAL_PHASE_CONFIRMATION_REQUIRED', status: 409, detected_phase: detectedPhase, retained_phase: retained });
  }
}

export function preserveCalculationHistory(data) {
  const history = Array.isArray(data?.calculation_history) ? [...data.calculation_history] : [];
  if (Array.isArray(data?.scenarios_v2) && data.scenarios_v2.length) history.push({
    computed_at: data.scenarios_computed_at ?? data.calc_result?.computed_at ?? null,
    input_fingerprint: data.calculation_trace?.input_fingerprint ?? null,
    engine_version: data.scenarios_engine_version ?? null,
    trace: data.calculation_trace ?? null,
    input_snapshot: data.calculation_input_snapshot ?? null,
    scenarios: data.scenarios_v2,
    calc_result: data.calc_result ?? null,
    meter_snapshot: data.meter_snapshot ?? null,
  });
  return history;
}
