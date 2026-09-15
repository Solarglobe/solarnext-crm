/** Contract facts are independent. No inference from an operator's name. */
export function resolveSimulationContract(value = {}) {
  const mode=value.injection_mode??"unconfirmed";
  if(!["unconfirmed","allowed","none"].includes(mode))throw new Error("Modalite d'injection invalide");
  const limit=value.injection_limit_kw??null;
  if(limit!=null&&(!Number.isFinite(limit)||limit<0))throw new Error("Puissance d'injection invalide");
  const oaStatus=value.oa_contract_status??'unconfirmed';
  if(!['unconfirmed','active','terminated','none'].includes(oaStatus))throw new Error('OA_CONTRACT_STATUS_INVALID');
  const dates={};
  for(const key of ['oa_exit_effective_date','virtual_storage_start_date']) {
    const date=value[key]==null||value[key]===''?null:value[key];
    if(date!=null) {
      const parsed=new Date(`${date}T00:00:00Z`);
      if(typeof date!=='string'||!/^\d{4}-\d{2}-\d{2}$/.test(date)||!Number.isFinite(parsed.getTime())||parsed.toISOString().slice(0,10)!==date)throw new Error(`${key.toUpperCase()}_INVALID`);
    }
    dates[key]=date;
  }
  if(value.oa_exit_document_reference!=null&&typeof value.oa_exit_document_reference!=='string')throw new Error('OA_EXIT_DOCUMENT_REFERENCE_INVALID');
  return {grid_operator:value.grid_operator??null,supplier:value.supplier??null,virtual_credit_provider:value.virtual_credit_provider??null,virtual_credit_eligibility:value.virtual_credit_eligibility??null,injection_mode:mode,injection_limit_kw:mode==="none"?0:limit,injection_authorization_status:value.injection_authorization_status??"unconfirmed",surplus_tariff_status:value.surplus_tariff_status??"simulation_assumption",retail_price_tax_basis:value.retail_price_tax_basis??"unconfirmed",
    oa_contract_status:oaStatus,...dates,oa_exit_document_reference:value.oa_exit_document_reference?.trim()||null};
}
