export interface CurrentElectricitySubscription {
  monthly: number | null;
  annual: number | null;
  isEstimate: boolean;
  invalid: boolean;
  source: 'CURRENT_LEAD' | 'EDF_REFERENCE_ESTIMATE' | 'MISSING';
  reference: {
    effective_date: string;
    source_url: string;
    source_label: string;
    price_basis: 'TTC';
    meter_kva: number;
    tariff_type: 'BASE' | 'HPHC' | 'TEMPO';
  } | null;
  missing: string[];
}
export const CURRENT_SUBSCRIPTION_REFERENCE: Readonly<{
  effective_date: string;
  source_url: string;
  source_label: string;
  price_basis: 'TTC';
}>;
export function resolveCurrentElectricitySubscription(input?: {
  monthly?: unknown;
  annual?: unknown;
  meterKva?: unknown;
  tariffType?: unknown;
  hpHc?: unknown;
}): CurrentElectricitySubscription;
