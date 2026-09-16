/** Public read-only projection: never expose raw inputs, traces or internal pricing. */
export function projectPortalHistoricalResult(row) {
  const finite = value => typeof value === 'number' && Number.isFinite(value) ? value : null;
  const scenario = row.scenario ?? {};
  return {id:`${row.version_id}:${row.history_index}`,study_number:row.study_number,
    computed_at:row.computed_at ?? null,scenario_label:scenario.label ?? scenario.name ?? scenario.id ?? 'Résultat précédent',
    annual_savings_eur:finite(scenario.finance?.economie_year_1),
    horizon_years:finite(scenario.finance?.finance_meta?.horizon_years),export_blocked:true};
}
export async function getClientPortalHistory(db,{organizationId,leadId,offset=0}) {
  const {rows}=await db.query(`SELECT v.id AS version_id,s.study_number,h.idx-1 AS history_index,
    h.entry->>'computed_at' AS computed_at,selected.scenario
    FROM study_versions v JOIN studies s ON s.id=v.study_id AND s.organization_id=v.organization_id
    JOIN leads l ON l.id=s.lead_id AND l.organization_id=s.organization_id
    CROSS JOIN LATERAL jsonb_array_elements(CASE WHEN jsonb_typeof(v.data_json->'calculation_history')='array'
      THEN v.data_json->'calculation_history' ELSE '[]'::jsonb END) WITH ORDINALITY h(entry,idx)
    CROSS JOIN LATERAL (SELECT scenario FROM jsonb_array_elements(CASE WHEN jsonb_typeof(h.entry->'scenarios')='array'
      THEN h.entry->'scenarios' ELSE '[]'::jsonb END) scenario
      WHERE scenario->>'id'=v.data_json->'portal_offer'->>'scenario_id' LIMIT 1) selected
    WHERE s.lead_id=$1 AND s.organization_id=$2 AND s.archived_at IS NULL AND l.archived_at IS NULL
    ORDER BY v.created_at DESC,v.id DESC,h.idx DESC OFFSET $3 LIMIT 11`,[leadId,organizationId,offset]);
  return {items:rows.slice(0,10).map(projectPortalHistoricalResult),next_offset:rows.length>10?offset+10:null};
}
