const URBAN = Object.freeze({
  id:'URBAN_SOLAR_2026_06_MONTHLY_HC',provider:'URBAN_SOLAR',settlement:'monthly',priority:'HC_FIRST',
  credit_ratio:1,capacity_kwh:null,credit_validity_months:null,annual_reset:false,
  effective_date:'2026-06-01',verified_at:'2026-09-15',
  sources:['https://www.urbansolarenergy.fr/faq/','https://www.urbansolarenergy.fr/stockage-virtuel/',
    'https://www.urbansolarenergy.fr/wp-content/uploads/2026/07/CGV-inferieures-ou-egales-a-36kVA_01_06_2026.pdf'],
  termination_credit_compensated:false,anniversary_cashout:'on_explicit_request_at_one_quarter_energy_base_price',
});
export const VIRTUAL_PROVIDER_RULES=Object.freeze({URBAN_SOLAR:URBAN});
export function resolveVirtualProviderRules(config={}) {
  const provider=String(config.provider_code??config.provider??'').toUpperCase();
  const published=VIRTUAL_PROVIDER_RULES[provider];
  if(!published)return {id:'LEGACY_HOURLY_EXPLICIT_CAPACITY',provider,settlement:'hourly',priority:'CHRONOLOGICAL',credit_ratio:1};
  // Negotiated deviations must be explicitly identified, not inherited from an
  // old automatically sized "virtual capacity" field.
  const override=config.contract_rules_override;
  if(override&&!override.source)throw new Error('VIRTUAL_CONTRACT_RULE_SOURCE_REQUIRED');
  return {...published,...(override??{}),id:override?`${published.id}:contract_override`:published.id};
}
