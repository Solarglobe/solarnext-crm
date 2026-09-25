/** Contract facts are independent. No inference from an operator's name. */
export function resolveSimulationContract(value = {}) {
  const mode=value.injection_mode??"unconfirmed";
  if(!["unconfirmed","allowed","none"].includes(mode))throw new Error("Modalite d'injection invalide");
  const limit=value.injection_limit_kw??null;
  if(limit!=null&&(!Number.isFinite(limit)||limit<0))throw new Error("Puissance d'injection invalide");
  return {grid_operator:value.grid_operator??null,supplier:value.supplier??null,virtual_credit_provider:value.virtual_credit_provider??null,virtual_credit_eligibility:value.virtual_credit_eligibility??null,injection_mode:mode,injection_limit_kw:mode==="none"?0:limit,injection_authorization_status:value.injection_authorization_status??"unconfirmed",surplus_tariff_status:value.surplus_tariff_status??"simulation_assumption",retail_price_tax_basis:value.retail_price_tax_basis??"unconfirmed"};
}
