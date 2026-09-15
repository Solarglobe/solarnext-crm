/**
 * GET /api/studies/:studyId/versions/:versionId/scenarios
 * Lecture scenarios_v2 : retourne le snapshot, avec réparation d'affichage pour anciens KPI BV.
 */

import { pool } from '../config/db.js';
import { repairScenarioV2DisplayKpis } from "../services/scenarioV2DisplayRepair.service.js";
import { CALC_ENGINE_VERSION } from "../services/calc/calc.constants.js";
import { getStudyCalculationFreshness } from '../services/studyCalculationFreshness.service.js';

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

function freshnessBody(state) {
 const current=state.current,data=current.data;
 const stale=data.scenarios_engine_version!==CALC_ENGINE_VERSION;
 return {ok:true,needs_recompute:state.needs_recompute||stale,stale_reason:state.stale_reason,
  input_fingerprint:state.input_fingerprint,current_input_fingerprint:state.current_input_fingerprint,
  export_blocked:state.export_blocked||stale,stale_snapshot:stale,snapshot_engine_version:data.scenarios_engine_version??null,
  current_engine_version:CALC_ENGINE_VERSION,calculated_at:data.scenarios_computed_at??null,
  history_count:current.history_count,is_locked:current.is_locked===true,selected_scenario_id:current.selected_scenario_id??null,display_blocked:false};
}

export async function getStudyScenarioFreshness(req,res) {
 try {
  const organizationId=orgId(req);if(!organizationId)return res.status(401).json({error:'Non authentifié'});
  const state=await getStudyCalculationFreshness({...req.params,organizationId});
  return res.json(freshnessBody(state));
 }catch(e){return res.status(e.status??500).json({error:e.code??e.message});}
}

export async function getStudyScenarioHistory(req,res) {
 try {
  const org=orgId(req);if(!org)return res.status(401).json({error:'Non authentifié'});
  const offset=Number(req.query?.offset??0),limit=Number(req.query?.limit??20);
  if(!Number.isInteger(offset)||offset<0||!Number.isInteger(limit)||limit<1||limit>50)return res.status(400).json({error:'INVALID_HISTORY_PAGE'});
  const {rows}=await pool.query(`SELECT jsonb_array_length(COALESCE(v.data_json->'calculation_history','[]'::jsonb)) AS total,
    COALESCE((SELECT jsonb_agg(item ORDER BY idx DESC) FROM (
      SELECT ordinality-1 AS idx,jsonb_build_object('id',(ordinality-1)::text,'computed_at',entry->'computed_at',
       'input_fingerprint',entry->'input_fingerprint','engine_version',entry->'engine_version',
       'scenario_count',jsonb_array_length(COALESCE(entry->'scenarios','[]'::jsonb))) AS item
      FROM jsonb_array_elements(COALESCE(v.data_json->'calculation_history','[]'::jsonb)) WITH ORDINALITY AS h(entry,ordinality)
      ORDER BY ordinality DESC OFFSET $4 LIMIT $5) page),'[]'::jsonb) AS items
    FROM study_versions v WHERE v.id=$1 AND v.study_id=$2 AND v.organization_id=$3`,[req.params.versionId,req.params.studyId,org,offset,limit]);
  if(!rows.length)return res.status(404).json({error:'VERSION_NOT_FOUND'});
  const row=rows[0];return res.json({items:row.items,total:row.total,next_offset:offset+limit<row.total?offset+limit:null});
 }catch(e){return res.status(500).json({error:e.message});}
}

export async function getStudyScenarioHistoryEntry(req,res) {
 try {
  const org=orgId(req);if(!org)return res.status(401).json({error:'Non authentifié'});
  const index=Number(req.params.historyId);
  if(!/^\d+$/.test(req.params.historyId)||!Number.isSafeInteger(index)||index>2147483647)return res.status(400).json({error:'INVALID_HISTORY_ID'});
  const {rows}=await pool.query(`SELECT h.entry - ARRAY['input_snapshot','trace','calc_result']::text[] AS entry FROM study_versions v
    CROSS JOIN LATERAL (SELECT v.data_json->'calculation_history'->$4::int AS entry) h
    WHERE v.id=$1 AND v.study_id=$2 AND v.organization_id=$3`,[req.params.versionId,req.params.studyId,org,index]);
  if(!rows[0]?.entry)return res.status(404).json({error:'HISTORY_NOT_FOUND'});
  return res.json({...rows[0].entry,id:String(index),export_blocked:true,display_blocked:false});
 }catch(e){return res.status(500).json({error:e.message});}
}

/**
 * GET /api/studies/:studyId/versions/:versionId/scenarios
 * Retourne scenarios_v2. 404 si version inexistante ou scenarios_v2 absent.
 */
export async function getStudyScenarios(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const { studyId, versionId } = req.params;
    if (!studyId || !versionId) {
      return res.status(400).json({ error: "studyId et versionId requis" });
    }

    const studyVersion = (await pool.query(`SELECT id,study_id,is_locked,selected_scenario_id,
      jsonb_build_object('scenarios_v2',data_json->'scenarios_v2','scenarios_engine_version',data_json->'scenarios_engine_version',
      'scenarios_computed_at',data_json->'scenarios_computed_at','calculation_trace',jsonb_build_object('input_fingerprint',data_json#>'{calculation_trace,input_fingerprint}')) AS data
      FROM study_versions WHERE id=$1 AND study_id=$2 AND organization_id=$3`,[versionId,studyId,org])).rows[0];
    if (!studyVersion) {
      return res.status(404).json({ error: "Version non trouvée" });
    }
    if (studyVersion.study_id !== studyId) {
      return res.status(404).json({ error: "Version ne correspond pas à l'étude" });
    }

    const dataJson = studyVersion.data && typeof studyVersion.data === "object" ? studyVersion.data : {};
    const scenarios_v2 = dataJson.scenarios_v2;

    if (!scenarios_v2 || !Array.isArray(scenarios_v2) || scenarios_v2.length === 0) {
      return res.status(404).json({ error: "SCENARIOS_NOT_GENERATED" });
    }

    const scenariosForDisplay = repairScenarioV2DisplayKpis(scenarios_v2);
    const freshness = await getStudyCalculationFreshness({ studyId, versionId, organizationId: org, data: dataJson });

    // GARDE COHERENCE MOTEUR (lecture) : invalide les snapshots anciens et detecte
    // tout melange 8760/mensuel (cas FAVER batterie 95,5% / 244 cycles). On ne fabrique
    // aucun chiffre : on signale au front qu un recalcul est requis.
    const snapshotEngineVersion = dataJson.scenarios_engine_version ?? null;
    const staleSnapshot = snapshotEngineVersion !== CALC_ENGINE_VERSION;
    const baseBasis = scenariosForDisplay.find((s) => s && s.id === "BASE")?.energy_basis ?? null;
    let engineCoherent = true;
    for (const sc of scenariosForDisplay) {
      if (!sc) continue;
      const basis = sc.energy_basis ?? null;
      const mixed = basis === "monthly_fallback" || (baseBasis === "hourly_8760" && basis !== "hourly_8760" && sc.id !== "BASE" && sc._skipped !== true);
      if (mixed || (staleSnapshot && basis == null)) {
        sc._engine_stale = true;
        engineCoherent = false;
      }
    }

    return res.json({
      ok: true,
      scenarios: scenariosForDisplay,
      is_locked: studyVersion.is_locked === true,
      selected_scenario_id: studyVersion.selected_scenario_id ?? null,
      engine_coherent: engineCoherent,
      stale_snapshot: staleSnapshot,
      snapshot_engine_version: snapshotEngineVersion,
      current_engine_version: CALC_ENGINE_VERSION,
      needs_recompute: freshness.needs_recompute || staleSnapshot || !engineCoherent,
      stale_reason: freshness.stale_reason ?? (!engineCoherent ? 'ENGINE_INCOHERENT_MIXED_BASIS' : null),
      input_fingerprint: freshness.input_fingerprint,
      current_input_fingerprint: freshness.current_input_fingerprint,
      export_blocked: freshness.export_blocked || !engineCoherent,
      history_count:freshness.current.history_count,
      calculated_at:dataJson.scenarios_computed_at??null,
      // BLOCAGE V12/V13 : un snapshot perime ne doit jamais s'afficher comme actuel ni etre compare/PDF.
      display_blocked: false,
      blocked_reason: staleSnapshot
        ? "STALE_SNAPSHOT_ENGINE_VERSION"
        : (!engineCoherent ? "ENGINE_INCOHERENT_MIXED_BASIS" : null),
    });
  } catch (e) {
    console.error("[studyScenarios.controller] getStudyScenarios:", e);
    return res.status(500).json({ error: e.message || "Erreur lors de la lecture des scénarios." });
  }
}
