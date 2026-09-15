/** Explicit, versioned project assumptions. Never infer a commercial entitlement. */
export const FINANCE_PROJECTION_DEFAULTS = Object.freeze({
  supplier_subscription_growth_pct: 0,
  virtual_subscription_growth_pct: 0,
  virtual_restitution_growth_pct: 0,
  surplus_sale_type: 'unconfirmed',
  oa_contract_years: 20,
  post_contract_sale_price_eur_kwh: 0,
  aid_eligibility: 'unconfirmed',
});

function finite(value, name, fallback, min = 0, max = Infinity) {
  if (value == null || (typeof value === 'string' && value.trim() === '')) return fallback;
  if (typeof value === 'boolean' || typeof value === 'object') throw new Error(`Hypothèse financière invalide : ${name}`);
  const n = Number(value);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`Hypothèse financière invalide : ${name}`);
  return n;
}

function schedule(value, name, kind = false) {
  if (value == null) return [];
  if (!Array.isArray(value)) throw new Error(`Échéancier invalide : ${name}`);
  return value.map((row) => {
    const year = finite(row?.year, `${name}.year`, NaN, 1, 100);
    const cost_eur = finite(row?.cost_eur, `${name}.cost_eur`, NaN);
    if (!Number.isInteger(year) || !Number.isFinite(cost_eur)) throw new Error(`Échéancier ${name} : année et coût explicites requis`);
    const type = row.kind ?? 'provision';
    if (kind && !['replacement', 'provision'].includes(type)) throw new Error('Nature de la dépense batterie invalide');
    return { year, cost_eur, ...(kind ? { kind: type, legacy_kind_assumed: row.kind == null } : {}) };
  });
}

export function resolveFinanceProjection(ctx = {}) {
  const explicit = ctx.form?.finance_projection ?? ctx.finance_input?.economic_snapshot_config?.finance_projection ?? ctx.settings?.finance_projection;
  if (explicit != null && (typeof explicit !== 'object' || Array.isArray(explicit))) throw new Error('Configuration de projection financière invalide');
  const raw = explicit && typeof explicit === 'object' && !Array.isArray(explicit) ? explicit : {};
  const sources = {};
  const result = { schema_version: 1 };
  for (const [key, fallback] of Object.entries(FINANCE_PROJECTION_DEFAULTS)) {
    const supplied = raw[key] != null && raw[key] !== '';
    sources[key] = supplied ? 'finance_projection' : 'explicit_default_assumption';
    result[key] = typeof fallback === 'number'
      ? finite(raw[key], key, fallback, key.endsWith('growth_pct') ? -99 : key === 'oa_contract_years' ? 1 : 0, key.endsWith('growth_pct') ? 100 : key === 'oa_contract_years' ? 100 : Infinity)
      : supplied ? raw[key] : fallback;
  }
  if (!Number.isInteger(result.oa_contract_years)) throw new Error('Durée du contrat OA : nombre entier d’années requis');
  if (!['unconfirmed', 'oa', 'market', 'none'].includes(result.surplus_sale_type)) throw new Error('Type de vente du surplus invalide');
  if (!['unconfirmed', 'eligible', 'ineligible'].includes(result.aid_eligibility)) throw new Error('Éligibilité de la prime invalide');
  const payments = raw.aid_payment_schedule ?? [];
  if (!Array.isArray(payments)) throw new Error('Calendrier de prime invalide');
  result.aid_payment_schedule = payments.map((row) => {
    const year = finite(row?.year, 'aid_payment_schedule.year', NaN, 1, 100);
    const share_pct = finite(row?.share_pct, 'aid_payment_schedule.share_pct', NaN, 0, 100);
    if (!Number.isInteger(year) || !Number.isFinite(share_pct)) throw new Error('Calendrier de prime : année et pourcentage explicites requis');
    return { year, share_pct };
  });
  if (payments.length && Math.abs(result.aid_payment_schedule.reduce((s, row) => s + row.share_pct, 0) - 100) > 1e-6) throw new Error('Calendrier de prime : la somme des versements doit être 100 %');
  result.battery_replacements = schedule(raw.battery_replacements ?? ctx.form?.economics?.battery_replacements, 'batterie', true);
  result.inverter_replacements = raw.inverter_replacements == null ? null : schedule(raw.inverter_replacements, 'onduleur');
  result.maintenance_pct = finite(raw.maintenance_pct, 'maintenance_pct', null, 0, 100);
  result.horizon_years = finite(raw.horizon_years, 'horizon_years', null, 1, 100);
  if (result.horizon_years != null && !Number.isInteger(result.horizon_years)) throw new Error('Horizon financier : nombre entier d’années requis');
  result.sources = sources;
  result.warnings = [];
  if (result.battery_replacements.some(row => row.legacy_kind_assumed)) result.warnings.push('BATTERY_LEGACY_EXPENSE_TREATED_AS_PROVISION');
  if (result.surplus_sale_type === 'unconfirmed') result.warnings.push('SURPLUS_CONTRACT_UNCONFIRMED');
  if (result.aid_eligibility === 'unconfirmed') result.warnings.push('AID_ELIGIBILITY_UNCONFIRMED_NO_AID');
  return result;
}

export function resolveScenarioAid({ projection, injectionMode, virtual, kwc, primeRate, horizonYears }) {
  const eligible = projection.aid_eligibility === 'eligible' && projection.surplus_sale_type === 'oa' && injectionMode === 'allowed' && !virtual;
  const warnings = [];
  if (projection.aid_eligibility === 'eligible' && !eligible) warnings.push('AID_EXCLUDED_INCOMPATIBLE_CONTRACT_OR_INJECTION');
  if (eligible && !projection.aid_payment_schedule.length) warnings.push('AID_PAYMENT_SCHEDULE_MISSING_NO_AID');
  const confirmed = eligible && projection.aid_payment_schedule.length > 0;
  const total = confirmed ? Math.max(0, kwc * primeRate) : 0;
  const payments = confirmed ? projection.aid_payment_schedule.map(row => ({ year: row.year, amount_eur: total * row.share_pct / 100 })) : [];
  return { eligible: confirmed, total_eur: total, payments, received_within_horizon_eur: payments.filter(row => row.year <= horizonYears).reduce((s, row) => s + row.amount_eur, 0), warnings };
}

export function resolveScenarioSale({ projection, injectionMode, virtual, configuredRate }) {
  const permitted = injectionMode === 'allowed' && ['oa', 'market'].includes(projection.surplus_sale_type) && (!virtual || projection.surplus_sale_type === 'market');
  return {
    rate_eur_kwh: permitted ? configuredRate : 0,
    contract_years: projection.surplus_sale_type === 'market' ? null : projection.oa_contract_years,
    post_contract_rate_eur_kwh: permitted ? projection.post_contract_sale_price_eur_kwh : 0,
    status: !permitted ? 'NO_CONFIRMED_SALE' : 'CONFIGURED_CONTRACT',
  };
}

export function batteryAgeAtYear(year, replacements = []) {
  const latest = replacements.filter(row => row.kind === 'replacement' && row.year <= year).reduce((last, row) => Math.max(last, row.year), 1);
  return year - latest;
}
