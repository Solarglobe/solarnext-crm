import { resolveSimulationContract } from './simulationContract.service.js';

/** A supply switch is not evidence that an existing purchase agreement ended. */
export function resolveVirtualStorageOaCompatibility(contract = {}, projection = {}, { referenceDate = null } = {}) {
  contract = resolveSimulationContract(contract);
  const today = referenceDate ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
  const startDate = contract.virtual_storage_start_date ?? today;
  const status = contract.oa_contract_status ?? 'unconfirmed';
  const exitDate = contract.oa_exit_effective_date ?? null;
  const document = String(contract.oa_exit_document_reference ?? '').trim() || null;
  const retainedOa = projection.surplus_sale_type === 'oa';
  const needsChange = status === 'active' || status === 'terminated' || retainedOa;
  const documentedExit = document != null && exitDate != null && exitDate <= startDate;
  let code = null;
  let message = null;
  if (needsChange && !documentedExit) {
    code = status === 'active' ? 'OA_ACTIVE_INCOMPATIBLE_WITH_VIRTUAL_STORAGE'
      : retainedOa ? 'OA_PROJECT_CONTRACT_CHANGE_REQUIRED' : 'OA_EXIT_DOCUMENTATION_REQUIRED';
    message = status === 'active'
      ? "Un contrat OA est actif. La batterie virtuelle exige une sortie OA documentée et effective avant son démarrage."
      : retainedOa
        ? "L'étude prévoit une vente OA. Pour choisir la batterie virtuelle, documenter le changement de contrat et sa date avant son démarrage."
        : "La fin du contrat OA doit être documentée et datée avant le démarrage de la batterie virtuelle.";
  }
  return {
    status: code ? 'BLOCKED' : needsChange ? 'OA_EXIT_DOCUMENTED' : 'COMPATIBLE',
    code, message,
    current_oa_status: status, project_sale_type: projection.surplus_sale_type ?? 'unconfirmed',
    oa_exit_effective_date: exitDate, oa_exit_document_reference: document,
    virtual_storage_start_date: startDate,
    start_date_source: contract.virtual_storage_start_date ? 'EXPLICIT' : 'CALCULATION_DATE',
  };
}
