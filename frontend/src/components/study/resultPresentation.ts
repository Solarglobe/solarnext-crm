export function consumptionSourceLabel(source?: string | null): string {
  const labels: Record<string, string> = {
    ENEDIS_HOURLY: 'Courbe horaire Enedis', IMPORTED_HOURLY: 'Courbe horaire importée',
    CSV_HOURLY: 'Courbe horaire importée', PROVIDED_HOURLY_PROFILE: 'Profil horaire fourni',
    ENEDIS_DAILY: 'Profil reconstitué depuis les relevés quotidiens',
    IMPORTED_DAILY_RECONSTRUCTED: 'Profil reconstitué depuis les relevés quotidiens',
    R65_DAILY_REBUILT: 'Profil reconstitué depuis les relevés quotidiens',
    MONTHLY_SYNTHETIC: 'Profil estimé depuis la consommation mensuelle',
    ANNUAL_SYNTHETIC: 'Profil estimé depuis la consommation annuelle', FALLBACK: 'Profil national estimé',
  };
  return labels[String(source ?? '').toUpperCase()] ?? 'Provenance du profil à confirmer';
}

export function finalHorizonSavings(finance: { annual_cashflows?: unknown; economie_horizon_years?: number | null; economie_total?: number|null; total_savings_25y?:number|null; electricity_billing?:{status?:string}|null }): number|null {
  if(finance.electricity_billing?.status==='INCOMPLETE')return null;
  const flows=Array.isArray(finance.annual_cashflows)?finance.annual_cashflows:[];
  const last=flows[flows.length-1];
  const value=last?.cumul_eur ?? last?.cumul ?? finance.economie_total ?? finance.total_savings_25y;
  return value==null||!Number.isFinite(Number(value))?null:Number(value);
}
