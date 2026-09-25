/**
 * Fallback for an unknown customer subscription, never a customer's actual offer.
 * EDF Tarif Bleu, residential mainland France, TTC, effective 2026-08-01:
 * https://particulier.edf.fr/content/dam/2-Actifs/Documents/Offres/Grille_prix_Tarif_Bleu.pdf
 * Keep this dated reference in calculation snapshots; updating it must not rewrite
 * previously saved studies. Mono/three-phase does not select a different price.
 */
export const CURRENT_SUBSCRIPTION_REFERENCE = Object.freeze({
  effective_date: '2026-08-01',
  source_url: 'https://particulier.edf.fr/content/dam/2-Actifs/Documents/Offres/Grille_prix_Tarif_Bleu.pdf',
  source_label: 'EDF Tarif Bleu résidentiel — France métropolitaine',
  price_basis: 'TTC',
});

const base = Object.freeze({ 3: 12.13, 6: 15.86, 9: 19.88, 12: 23.76, 15: 27.40, 18: 31.14, 24: 39.14, 30: 46.47, 36: 53.88 });
const tempo = Object.freeze({ 6: 15.80, 9: 19.70, 12: 23.50, 15: 27.01, 18: 30.69, 24: 38.21, 30: 45.82, 36: 53.76 });
const grids = Object.freeze({ BASE: base, HPHC: base, TEMPO: tempo });
const provided = value => value != null && !(typeof value === 'string' && value.trim() === '');
const positiveOrZero = value => {
  if (!provided(value) || !['number', 'string'].includes(typeof value)) return null;
  const n = Number(typeof value === 'string' ? value.trim().replace(',', '.') : value);
  return Number.isFinite(n) && n >= 0 ? n : null;
};

function option(value, hpHc) {
  const token = String(value ?? '').trim().toUpperCase().replace(/[\s/_-]/g, '');
  if (token === 'BASE' || token === 'TEMPO') return token;
  if (['HPHC', 'HEURESPLEINESHEURESCREUSES'].includes(token)) return 'HPHC';
  if (token) return null;
  if ([true, 'true', 'oui', 'OUI'].includes(hpHc)) return 'HPHC';
  if ([false, 'false', 'non', 'NON'].includes(hpHc)) return 'BASE';
  return null;
}

/** Derive values only: a missing manual field must stay missing in storage. */
export function resolveCurrentElectricitySubscription({ monthly, annual, meterKva, tariffType, hpHc } = {}) {
  const result = { monthly: null, annual: null, isEstimate: false, invalid: false, source: 'MISSING', reference: null, missing: [] };
  const annualProvided = provided(annual);
  if (annualProvided || provided(monthly)) {
    const amount = positiveOrZero(annualProvided ? annual : monthly);
    if (amount == null) return { ...result, invalid: true, source: 'CURRENT_LEAD', missing: ['subscription_invalid'] };
    return {
      ...result, source: 'CURRENT_LEAD',
      monthly: annualProvided ? amount / 12 : amount,
      annual: annualProvided ? amount : Math.round(amount * 1200) / 100,
    };
  }
  const kva = positiveOrZero(meterKva);
  const tariff = option(tariffType, hpHc);
  if (kva == null || kva <= 0) result.missing.push('meter_kva_missing');
  if (!tariff) result.missing.push(provided(tariffType) ? 'tariff_type_unsupported' : 'tariff_type_missing');
  if (result.missing.length) return result;
  const grid = grids[tariff];
  if (!Object.hasOwn(grid, kva)) return { ...result, missing: ['meter_kva_not_in_reference'] };
  const amount = grid[kva];
  return {
    ...result, monthly: amount, annual: Math.round(amount * 1200) / 100,
    isEstimate: true, source: 'EDF_REFERENCE_ESTIMATE',
    reference: { ...CURRENT_SUBSCRIPTION_REFERENCE, meter_kva: kva, tariff_type: tariff },
  };
}
