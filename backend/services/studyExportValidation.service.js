import { assertClientStudyExportable, getClientStudyExportBlock } from '../../shared/shading/clientStudyExport.js';
import { energyTolerance, validateEnergyBalance, ENERGY_REFERENCE_VERSION } from "./energyReference.service.js";
import { cashflowIrr } from "./financialIndicators.service.js";
import { resolveVirtualStorageOaCompatibility } from './virtualStorageOaCompatibility.service.js';
import { shadingExportBlockers } from './shading/shadingExportGuard.service.js';
import { isPdfBlockedByConfidence } from './calculationConfidence.service.js';

export function validateStudyScenarioForExport(scenario, expectedScenarioId) {
  const errors=[],warnings=[];
  const shadingBlock = getClientStudyExportBlock(scenario);
  if (shadingBlock.blocked) errors.push(shadingBlock.code + ': ' + shadingBlock.reasons.join(', '));
  const ref=scenario?.energy?.reference;
  const id=scenario?.id ?? scenario?.scenario_type ?? scenario?.name;
  for(const block of shadingExportBlockers({audit:scenario?.shading?.commercial_audit,assumptions:scenario?.calculation_confidence?.assumptions??{}}))errors.push(`${block.code}: ${block.message}`);
  if (String(id).includes('VIRTUAL') || id === 'BATTERY_HYBRID') {
    const meta=scenario?.finance?.finance_meta??scenario?.finance_meta??{};
    const stored=meta.virtual_storage_oa_compatibility??meta.projection_assumptions?.virtual_storage_oa_compatibility;
    const projection=meta.projection_assumptions??meta.economic_snapshot?.projection_assumptions??{};
    try {
      // Re-evaluate the facts too: deleting a stored blocking flag cannot permit export.
      const compatibility=resolveVirtualStorageOaCompatibility(scenario?.grid_contract??{},projection,{referenceDate:stored?.virtual_storage_start_date??null});
      for(const check of [stored,compatibility]) if(check?.status==='BLOCKED'&&!errors.some(error=>error.startsWith(check.code)))errors.push(`${check.code}: ${check.message}`);
    } catch(error) { errors.push(`OA_CONTRACT_INVALID: ${error.message}`); }
  }
  if(id!==expectedScenarioId)errors.push("SCENARIO_MISMATCH: le resultat ne correspond pas au scenario demande");
  if(!ref && String(expectedScenarioId).startsWith("VEHICLE_V2H")) errors.push("V2H_EXPORT_NOT_VERIFIED: export client non pris en charge tant que les flux mobilité et réseau ne disposent pas du bilan vérifié");
  if(!ref || ref.version!==ENERGY_REFERENCE_VERSION)errors.push("ENERGY_REFERENCE_MISSING: recalculer l'etude avec le moteur courant");
  else {
    if(ref.scenario_id!==expectedScenarioId)errors.push("ENERGY_REFERENCE_SCENARIO_MISMATCH");
    if(!ref.input_hash||!ref.simulated_at)errors.push("RESULT_TRACE_MISSING");
    errors.push(...validateEnergyBalance(ref.annual));
    const a=ref.annual, useful=a.direct_kwh+a.battery_discharge_solar_kwh;
    const ratios={solar_coverage:[useful,a.consumption_kwh],direct_self_consumption:[a.direct_kwh,a.production_kwh],useful_pv_utilization:[useful,a.production_kwh],captured_pv_before_storage_losses:[a.direct_kwh+a.battery_charge_solar_kwh,a.production_kwh]};
    for (const [key,[numerator,denominator]] of Object.entries(ratios)) {
      const expected=denominator>0?numerator/denominator:null,actual=ref.ratios?.[key];
      if(expected===null?actual!==null:!Number.isFinite(actual)||Math.abs(actual-expected)>energyTolerance(1))errors.push(`RATIO_MISMATCH: ${key}`);
    }
    if(ref.validation?.status!=="verified") errors.push("UNVERIFIED_ENERGY_RESULT");
    for (const month of ref.monthly??[]) errors.push(...validateEnergyBalance(month));
    if(ref.battery?.complete_input===false) errors.push("BATTERY_PARAMETERS_DEFAULTED: renseigner rendement et puissances");
    if(ref.battery && ["capacity_kwh","roundtrip_efficiency","max_charge_kw","max_discharge_kw"].some(k=>!Number.isFinite(ref.battery[k]))) errors.push("BATTERY_PARAMETERS_MISSING: capacite, rendement et puissances requis");
    if(ref.monthly?.length!==12)errors.push("MONTHLY_REFERENCE_MISSING");
    else for(const [k,v] of Object.entries(ref.annual)) {
      const monthly=ref.monthly.reduce((s,m)=>s+m[k],0);
      if(!Number.isFinite(monthly)||Math.abs(monthly-v)>energyTolerance(monthly,v))errors.push(`MONTHLY_SUM_MISMATCH: ${k}`);
    }
    if(ref.provenance==null)warnings.push("Provenance du profil horaire a confirmer; profil de simulation non certifie comme mesure.");
    if(ref.battery?.standby_modelled===false)warnings.push("Consommation de veille de la batterie non modelisee.");
    if(expectedScenarioId.includes("VIRTUAL")||expectedScenarioId==="BATTERY_HYBRID") {
      const credit=ref.virtual_credit;
      if(!credit)errors.push("VIRTUAL_CREDIT_LEDGER_MISSING");
      else if([credit.opening_kwh,credit.credited_kwh,credit.used_kwh,credit.expired_kwh??0,credit.cashout_kwh??0,credit.closing_kwh].some(v=>!Number.isFinite(v)||v < -energyTolerance(v)))errors.push("VIRTUAL_CREDIT_COMPONENT_INVALID");
      else if(Math.abs(credit.opening_kwh+credit.credited_kwh-credit.used_kwh-(credit.expired_kwh??0)-(credit.cashout_kwh??0)-credit.closing_kwh)>energyTolerance(credit.credited_kwh))errors.push("VIRTUAL_CREDIT_BALANCE_INVALID");
      if (Array.isArray(credit?.periods) && credit.periods.length) {
        let opening=credit.opening_kwh;
        for (const period of credit.periods) {
          const parts=[period.opening_kwh,period.credited_kwh,period.used_credit_kwh,period.expired_kwh??0,period.cashout_kwh??0,period.closing_kwh];
          const closing=opening+period.credited_kwh-period.used_credit_kwh-(period.expired_kwh??0)-(period.cashout_kwh??0);
          if(parts.some(v=>!Number.isFinite(v)||v < -energyTolerance(v))
            || Math.abs(period.opening_kwh-opening)>energyTolerance(opening)
            || Math.abs(closing-period.closing_kwh)>energyTolerance(credit.credited_kwh)) errors.push('VIRTUAL_PERIOD_BALANCE_INVALID');
          opening=period.closing_kwh;
        }
        if(Math.abs(opening-credit.closing_kwh)>energyTolerance(opening))errors.push('VIRTUAL_PERIOD_CLOSING_INVALID');
        for(const [periodKey,annualKey] of [['credited_kwh','credited_kwh'],['used_credit_kwh','used_kwh'],['expired_kwh','expired_kwh'],['cashout_kwh','cashout_kwh']]) {
          const total=credit.periods.reduce((sum,period)=>sum+(period[periodKey]??0),0);
          if(!Number.isFinite(total)||Math.abs(total-(credit[annualKey]??0))>energyTolerance(total,credit[annualKey]??0))errors.push(`VIRTUAL_PERIOD_SUM_MISMATCH: ${annualKey}`);
        }
      } else if(credit?.monthly?.length===12){
        let opening=credit.opening_kwh;
        for(const m of credit.monthly){
          if(![m.credited,m.used_credit,m.bank_end,m.billable_import].every(v=>Number.isFinite(v)&&v>=0)||Math.abs(opening+m.credited-m.used_credit-m.bank_end)>energyTolerance(credit.credited_kwh))errors.push("VIRTUAL_MONTHLY_BALANCE_INVALID");
          opening=m.bank_end;
        }
      }
      if(scenario.grid_contract?.virtual_credit_eligibility===false)errors.push("VIRTUAL_CREDIT_INELIGIBLE: offre indisponible pour ce contrat");
      if(scenario.grid_contract?.virtual_credit_eligibility==null)warnings.push("Eligibilite contractuelle au credit virtuel non confirmee.");
    }
  }
  const f=scenario?.finance;
  const billing=f?.electricity_billing ?? f?.finance_meta?.electricity_billing;
  if(billing?.status==='INCOMPLETE') errors.push(`ELECTRICITY_CONTRACT_INCOMPLETE: ${(billing.missing_fields??[]).join(', ')}`);
  if(!f || !Number.isFinite(f.capex_ttc) || !Array.isArray(f.annual_cashflows)||!f.annual_cashflows.length)errors.push("FINANCIAL_CASHFLOWS_MISSING");
  else {
    const economics=f.finance_meta?.economic_snapshot;
    // Existing frozen snapshots stored this advisory in blocking_warnings.
    // An incomplete credit estimate does not invalidate the PV cashflows.
    for (const warning of economics?.blocking_warnings ?? []) {
      if (warning === "FINANCING_INDICATIVE_ONLY_MISSING_TAEG_INSURANCE_OR_FEES") {
        warnings.push("Financement indicatif : TAEG, assurance ou frais incomplets. Les conditions définitives restent à confirmer.");
      } else {
        errors.push(`ECONOMIC_INPUT: ${warning}`);
      }
    }
    if(f.finance_meta?.horizon_years!=null&&f.annual_cashflows.length!==f.finance_meta.horizon_years)errors.push("FINANCIAL_HORIZON_MISMATCH");
    let net=-f.capex_ttc;
    f.annual_cashflows.forEach((row,i)=>{
      if(row.year!==i+1||!Number.isFinite(row.total_eur)){errors.push("INVALID_FINANCIAL_YEAR");return;}
      if(row.gain_auto!=null){
        const hasBillLedger=billing?.schema_version===1;
        const parts=[row.gain_auto,row.gain_oa,row.prime,row.maintenance,row.inverter_cost,row.battery_cost??0,row.virtual_service_cost_eur??0,row.import_savings_eur??0,row.virtual_cashout_eur??0,
          ...(hasBillLedger?[row.bill_without_project_eur,row.bill_with_project_and_service_eur,row.electricity_bill_savings_eur,row.initial_virtual_service_fees_eur??0]:[])];
        if(parts.some(v=>!Number.isFinite(v))) errors.push(`INVALID_FINANCIAL_COMPONENT: ${row.year}`);
        const billSavings=hasBillLedger?row.bill_without_project_eur-row.bill_with_project_and_service_eur:null;
        if(hasBillLedger&&Math.abs(billSavings-row.electricity_bill_savings_eur)>0.0050001)errors.push(`ELECTRICITY_BILL_SUM_MISMATCH: ${row.year}`);
        if(hasBillLedger&&i===0&&(Math.abs(row.bill_without_project_eur-billing.bill_before_eur)>0.0050001||Math.abs(row.bill_with_project_and_service_eur-billing.bill_after_eur)>0.0050001))errors.push('ELECTRICITY_YEAR1_BILL_MISMATCH');
        const total=hasBillLedger
          ? billSavings+row.gain_oa+row.prime+(row.virtual_cashout_eur??0)-row.maintenance-row.inverter_cost-(row.battery_cost??0)-(row.initial_virtual_service_fees_eur??0)
          : row.gain_auto+row.gain_oa+row.prime+(row.virtual_cashout_eur??0)+(row.import_savings_eur??0)-row.maintenance-row.inverter_cost-(row.battery_cost??0)-(row.virtual_service_cost_eur??0);
        if(Math.abs(total-row.total_eur)>0.0050001)errors.push(`FINANCIAL_COMPONENT_SUM_MISMATCH: ${row.year}`);
      }
      net+=row.total_eur;
      // Stored currency totals may be rounded to cents, never to whole euros.
      if(row.cumul_eur!=null&&Math.abs(net-row.cumul_eur)>0.0050001)errors.push(`FINANCIAL_CUMUL_MISMATCH: annee ${row.year}`);
    });
    if(f.economie_total!=null&&Math.abs(net-f.economie_total)>0.0050001)errors.push("FINANCIAL_NET_GAIN_MISMATCH");
    const irr=cashflowIrr([-f.capex_ttc,...f.annual_cashflows.map(r=>r.total_eur)]);
    if(irr.rate!=null&&f.irr_pct!=null&&Math.abs(irr.rate*100-f.irr_pct)>0.0050001)errors.push("FINANCIAL_IRR_MISMATCH");
    if(irr.status==="non_conventional_ambiguous")warnings.push("Flux non conventionnels : TRI unique non garanti, indicateur non affiche.");
    const payback=f.annual_cashflows.find(row=>row.cumul_eur>=0)?.year??null;
    if(f.roi_years!=null&&f.roi_years!==payback)errors.push("FINANCIAL_PAYBACK_MISMATCH");
    if(f.finance_meta?.battery_replacement_modelled!==true)warnings.push("Remplacement de batterie non chiffre.");
    if (!f.annual_cashflows.some(row => row.projection_energy)) warnings.push("Projection annuelle de vieillissement estimée, sans recalcul horaire futur.");
  }
  return {ok:errors.length===0,errors,warnings};
}

export function assertStudySnapshotExportable(snapshot) {
  if(isPdfBlockedByConfidence(snapshot?.calculation_confidence)) {
    const error=new Error('PDF_BLOCKED_CALCULATION_CONFIDENCE');error.code='PDF_BLOCKED_CALCULATION_CONFIDENCE';error.statusCode=409;error.calculation_confidence=snapshot.calculation_confidence;throw error;
  }
  const id=snapshot?.scenario_type;
  const scenario=snapshot?.scenario_result ?? snapshot?.scenarios_v2?.find(s=>(s.id??s.name)===id) ?? snapshot?.data_json?.scenarios_v2?.find(s=>(s.id??s.name)===id) ?? {...snapshot,id,finance:{...snapshot?.finance,annual_cashflows:snapshot?.cashflows ?? snapshot?.finance?.annual_cashflows}};
  assertClientStudyExportable({ ...snapshot, scenario_result: scenario });
  const result=validateStudyScenarioForExport(scenario,id);
  if(!result.ok){const error=new Error(`Export bloque : ${result.errors.join("; ")}`);error.code="STUDY_EXPORT_INCONSISTENT";error.statusCode=409;error.details=result;throw error;}
  return result;
}
