import { getNormalizedShadingFromGeometry } from './calpinage/calpinageShadingLegacyAdapter.js';
import { getStudyShadingState } from '../../shared/shading/clientStudyExport.js';
import { pool } from '../config/db.js';
import { METER_FIELDS_FROM_LEAD } from './leadMeters.service.js';
import { CALC_ENGINE_VERSION } from './calc/calc.constants.js';
import { FINANCIAL_ENGINE_VERSION } from '../constants/engineVersion.js';
import { ENERGY_REFERENCE_VERSION } from './energyReference.service.js';
import { fingerprint, quoteFingerprint, calculationFreshness, calculationConflict, detectedGridPhase } from './calculationFingerprint.service.js';
import { selectQuoteCalculationValues, selectEnergyProfile, selectCalpinageSnapshot, selectGeometryCalculationValues, selectSettingsCalculationValues, selectedVirtualProvider, CALCULATION_CATALOG_FIELDS } from './calculationInputSelection.service.js';
import { resolveVirtualBatteryActivationFeeTtcFromOrgDb } from './virtualBatteryQuoteCalculator.service.js';
import { resolveVirtualElectricityContract } from './electricitySupplyContract.service.js';
import { resolveCurrentMeterOffPeakPeriods } from './economicsResolve.service.js';

const pick = (object, keys) => Object.fromEntries(keys.map(k => [k, object?.[k] ?? null]));
function referencedIds(value, ids = new Set()) {
  if (typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value)) ids.add(value);
  else if (value && typeof value === 'object') for (const v of Object.values(value)) referencedIds(v, ids);
  return ids;
}

/** Read-only source capture: never calls the payload builder, creates a meter or fetches weather. */
export async function readStudyCalculationInputs({ studyId, versionId, organizationId, db = pool }) {
  const { rows } = await db.query(`SELECT v.id, v.version_number, v.is_locked, v.selected_scenario_id,
      v.data_json - ARRAY['calculation_history','calculation_input_snapshot','scenarios_v2','calc_result','meter_snapshot','meter_snapshot_previous','calculation_confidence','shading_debug','shading_parity_debug','shading_official']::text[] AS data_json,
      jsonb_array_length(COALESCE(v.data_json->'calculation_history','[]'::jsonb)) AS history_count,
      to_jsonb(l) AS lead, to_jsonb(m) AS meter, to_jsonb(a) AS address,
      o.settings_json AS settings,
      (SELECT e.config_json FROM economic_snapshots e WHERE e.study_version_id=v.id AND e.organization_id=v.organization_id ORDER BY e.created_at DESC LIMIT 1) AS quote,
      (SELECT jsonb_build_object('geometry_json',c.geometry_json,'total_panels',c.total_panels,'total_power_kwc',c.total_power_kwc,'total_loss_pct',c.total_loss_pct) FROM calpinage_data c WHERE c.study_version_id=v.id AND c.organization_id=v.organization_id LIMIT 1) AS geometry,
      (SELECT jsonb_build_object('payload',jsonb_build_object('panelSpec',c.snapshot_json#>'{payload,panelSpec}','panel',c.snapshot_json#>'{payload,panel}',
        'inverter',c.snapshot_json#>'{payload,inverter}','inverter_totals',c.snapshot_json#>'{payload,inverter_totals}','pvParams',c.snapshot_json#>'{payload,pvParams}','inverter_family',c.snapshot_json#>'{payload,inverter_family}'))
        FROM calpinage_snapshots c WHERE c.study_version_id=v.id AND c.organization_id=v.organization_id ORDER BY c.created_at DESC LIMIT 1) AS calpinage_snapshot,
      CASE WHEN COALESCE(m.consumption_mode,l.consumption_mode)='MONTHLY' THEN
       (SELECT jsonb_agg(jsonb_build_object('year',cm.year,'month',cm.month,'kwh',cm.kwh) ORDER BY cm.year,cm.month) FROM lead_consumption_monthly cm WHERE
        (cm.meter_id=m.id OR (m.id IS NULL AND cm.lead_id=l.id)) AND cm.organization_id=v.organization_id AND cm.year=EXTRACT(YEAR FROM now())::int) ELSE NULL END AS monthly
    FROM study_versions v JOIN studies s ON s.id=v.study_id AND s.organization_id=v.organization_id
    JOIN organizations o ON o.id=v.organization_id
    LEFT JOIN leads l ON l.id=s.lead_id AND l.organization_id=v.organization_id
    LEFT JOIN LATERAL (SELECT lm.* FROM lead_meters lm WHERE lm.lead_id=l.id AND lm.organization_id=v.organization_id
      AND (CASE WHEN NULLIF(v.data_json->>'selected_meter_id','') IS NOT NULL THEN lm.id::text=v.data_json->>'selected_meter_id' ELSE lm.is_default END) LIMIT 1) m ON true
    LEFT JOIN addresses a ON a.id=l.site_address_id AND a.organization_id=v.organization_id
    WHERE v.id=$1 AND v.study_id=$2 AND v.organization_id=$3`, [versionId, studyId, organizationId]);
  const row = rows[0];
  if (!row) throw Object.assign(new Error('Version non trouvée'), { code: 'VERSION_NOT_FOUND', status: 404 });
  const effectiveMeter = { ...(row.lead ?? {}), ...(row.meter ? pick(row.meter, METER_FIELDS_FROM_LEAD) : {}) };
  const quote = row.quote ?? {};
  const meter=pick(effectiveMeter,METER_FIELDS_FROM_LEAD.filter(k=>k!=='consumption_pdl'));
  meter.energy_profile=selectEnergyProfile(effectiveMeter.energy_profile);
  const selected=selectedVirtualProvider(quote,row.data_json?.options);
  const settings=selectSettingsCalculationValues(row.settings??{},quote,effectiveMeter,row.data_json?.options);
  if(selected?.provider) {
    settings.virtual_supply=resolveVirtualElectricityContract({providerCode:selected.provider,contractType:selected.contractType,meterKva:effectiveMeter.meter_power_kva,
      tariffReferenceDate:selected.tariffReferenceDate,settings:row.settings,offPeakPeriods:resolveCurrentMeterOffPeakPeriods(effectiveMeter.energy_profile)??row.settings?.pv?.virtual_battery?.off_peak_periods??null});
    // With no explicit date the applicable edition/prices, not the passing day,
    // are dependencies. The calculator still records the actual date in its trace.
    if(!selected.tariffReferenceDate)delete settings.virtual_supply.tariff_reference_date;
  }
  const inputs = {
    schema_version: 2, engine_version: CALC_ENGINE_VERSION,
    financial_engine_version: FINANCIAL_ENGINE_VERSION, energy_reference_version: ENERGY_REFERENCE_VERSION,
    selected_meter_id: row.meter?.id ?? row.data_json?.selected_meter_id ?? null,
    options: row.data_json?.options ?? {},
    simulation_contract: row.data_json?.simulation_contract ?? null,
    economics: row.data_json?.economics ?? null,
    meter,
    monthly: row.monthly ?? [], address: pick(row.address, ['lat', 'lon']),
    quote:selectQuoteCalculationValues(quote), geometry:selectGeometryCalculationValues(row.geometry), calpinage_snapshot:selectCalpinageSnapshot(row.calpinage_snapshot),
    settings,
    providers: selected?.provider ? {provider:selected.provider,activation_fee_ttc:await resolveVirtualBatteryActivationFeeTtcFromOrgDb(organizationId,selected.provider,selected.contractType,Number(effectiveMeter.meter_power_kva)||9,db)} : null,
    model_options: { shading_policy_version: 'optional-attested-shading-v1',
      shading_state: getStudyShadingState({ shading: getNormalizedShadingFromGeometry(row.geometry?.geometry_json).shading }),
      use_official_shading: process.env.USE_OFFICIAL_SHADING ?? null,
      reference_year: Number(new Intl.DateTimeFormat('en', {timeZone:'Europe/Paris',year:'numeric'}).format(new Date())) },
  };
  const ids = [...referencedIds({quote:inputs.quote,geometry:inputs.geometry,snapshot:inputs.calpinage_snapshot})].sort();
  const catalogs = await Promise.all(Object.entries(CALCULATION_CATALOG_FIELDS).map(async ([table,fields]) => {
    if(!ids.length)return [table,[]];
    // Table identifiers are the constant allow-list above, never user input.
    const result = await db.query(`SELECT ${fields.join(',')} FROM ${table} WHERE id=ANY($1::uuid[]) AND active=true ORDER BY id`, [ids]);
    return [table, result.rows];
  }));
  inputs.catalogs = Object.fromEntries(catalogs);
  return { input_fingerprint: fingerprint(inputs), quote_fingerprint: quoteFingerprint(quote),
    inputs, data: row.data_json ?? {}, version_number: row.version_number, is_locked:row.is_locked, selected_scenario_id:row.selected_scenario_id, history_count:row.history_count??0,
    detected_grid_phase: detectedGridPhase(effectiveMeter) };
}

export async function getStudyCalculationFreshness(params) {
  const current = await readStudyCalculationInputs(params);
  return { ...calculationFreshness(params.data ?? current.data, current.input_fingerprint), current };
}

export async function assertStudyCalculationCurrent(params) {
  const state = await getStudyCalculationFreshness(params);
  if (state.needs_recompute) throw calculationConflict(state.stale_reason);
  if (params.snapshot && params.snapshot.input_fingerprint !== state.input_fingerprint) throw calculationConflict('SELECTED_SNAPSHOT_STALE');
  return state;
}
