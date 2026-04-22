/**
 * CP-4 — Endpoint "Lancer calcul" pour une version d'étude
 * POST /api/studies/:studyId/versions/:versionId/calc
 */

import { pool } from "../config/db.js";
import {
  buildSolarNextPayload,
  resolveStudyVersionMeterContext,
} from "../services/solarnextPayloadBuilder.service.js";
import { buildFinalStudyJson } from "../services/finalStudyJson.service.js";
import {
  buildMeterSnapshotRecord,
  buildMeterCalcDiffLinesFr,
} from "../services/studyMeterSnapshot.service.js";
import { calculateSmartpitch } from "./calc.controller.js";
import { isUseOfficialShadingEnabled } from "../services/calpinage/officialShading.service.js";
import { isShadingParityPersistEnabled } from "../services/calpinage/shadingParity.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userIdFromReq = (req) => req.user?.userId ?? req.user?.id ?? null;

/**
 * POST /api/studies/:studyId/versions/:versionId/calc
 */
export async function runStudyCalc(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const studyId = req.params.studyId;
    const versionNum = parseInt(req.params.versionId, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      return res.status(400).json({ error: "Numéro de version invalide" });
    }

    const shadingUiSnapshot =
      req.body &&
      typeof req.body === "object" &&
      !Buffer.isBuffer(req.body) &&
      req.body.shading_ui_snapshot != null &&
      typeof req.body.shading_ui_snapshot === "object"
        ? req.body.shading_ui_snapshot
        : null;

    let solarnextPayload;
    try {
      solarnextPayload = await buildSolarNextPayload({
        studyId,
        versionId: versionNum,
        orgId: org,
        shadingUiSnapshot,
      });
    } catch (e) {
      if (e.message === "CALPINAGE_REQUIRED") {
        return res.status(400).json({ error: "Calpinage requis. Validez d'abord le calpinage pour cette version." });
      }
      if (e.message === "Adresse non géolocalisée (lat/lon requis)") {
        return res.status(400).json({ error: "Adresse non géolocalisée. Vérifiez les coordonnées du site." });
      }
      throw e;
    }

    if (process.env.NODE_ENV !== "production" || process.env.LOG_PAYLOAD_BATTERIES === "1") {
      console.log("[studyCalc] payload.battery_input =", {
        enabled: solarnextPayload?.battery_input?.enabled,
        capacity_kwh: solarnextPayload?.battery_input?.capacity_kwh,
        max_charge_kw: solarnextPayload?.battery_input?.max_charge_kw,
        max_discharge_kw: solarnextPayload?.battery_input?.max_discharge_kw,
        roundtrip_efficiency: solarnextPayload?.battery_input?.roundtrip_efficiency,
      });
      console.log("[studyCalc] payload.virtual_battery_input =", {
        enabled: solarnextPayload?.virtual_battery_input?.enabled,
        annual_subscription_ttc: solarnextPayload?.virtual_battery_input?.annual_subscription_ttc,
        cost_per_kwh_storage: solarnextPayload?.virtual_battery_input?.cost_per_kwh_storage,
        fee_fixed: solarnextPayload?.virtual_battery_input?.fee_fixed,
      });
    }

    const mockReq = {
      body: { solarnext_payload: solarnextPayload },
      file: null,
    };

    const studyRow = await pool.query(
      "SELECT lead_id FROM studies WHERE id = $1 AND organization_id = $2",
      [studyId, org]
    );
    const leadId = studyRow.rows[0]?.lead_id ?? null;
    const csvPath = solarnextPayload?.consommation?.csv_path ?? null;
    console.log(JSON.stringify({
      tag: "DEBUG_CALC_BEFORE_LOAD_CONSUMPTION",
      studyId,
      versionId: versionNum,
      leadId,
      csvPath,
    }));

    const captured = { done: false, data: null, statusCode: 200 };
    const mockRes = {
      status(code) {
        captured.statusCode = code;
        return mockRes;
      },
      json(data) {
        captured.data = data;
        captured.done = true;
      },
    };

    await calculateSmartpitch(mockReq, mockRes);

    if (!captured.done) {
      return res.status(500).json({ error: "Calcul non terminé" });
    }

    if (captured.statusCode !== 200) {
      return res.status(captured.statusCode).json(
        captured.data || { error: "Erreur calcul" }
      );
    }

    const ctxFinal = captured.data;

    const versionRes = await pool.query(
      `SELECT id, is_locked, version_number FROM study_versions
       WHERE study_id = $1 AND version_number = $2 AND organization_id = $3`,
      [studyId, versionNum, org]
    );
    let auditVersionId = null;
    if (versionRes.rows.length > 0) {
      const versionRow = versionRes.rows[0];
      auditVersionId = versionRow.id;
      if (versionRow.is_locked === true) {
        return res.status(400).json({ error: "LOCKED_VERSION" });
      }
      const versionId = versionRow.id;
      const summary = buildSummary(ctxFinal);
      const dataJson = (await pool.query(
        "SELECT data_json FROM study_versions WHERE id = $1",
        [versionId]
      )).rows[0]?.data_json || {};
      const calcResult = {
        summary,
        computed_at: new Date().toISOString(),
        shading: solarnextPayload?.installation?.shading ?? undefined,
      };

      const meterCtx = await resolveStudyVersionMeterContext(pool, {
        studyId,
        versionNumber: versionNum,
        orgId: org,
      });
      const meterSnapshot =
        meterCtx != null
          ? buildMeterSnapshotRecord({
              meterRow: meterCtx.meterRow,
              energyLead: meterCtx.energyLead,
              resolvedSelectedMeterId: meterCtx.resolvedSelectedMeterId,
            })
          : null;

      const prevSnapRaw = dataJson.meter_snapshot;
      const prevSnap =
        prevSnapRaw != null && typeof prevSnapRaw === "object" && !Array.isArray(prevSnapRaw)
          ? { ...prevSnapRaw }
          : null;
      const prevAt =
        typeof dataJson.meter_snapshot_captured_at === "string"
          ? dataJson.meter_snapshot_captured_at
          : null;

      const changeLinesFr =
        prevSnap && meterSnapshot && Object.keys(meterSnapshot).length > 0
          ? buildMeterCalcDiffLinesFr(prevSnap, meterSnapshot)
          : [];

      const merged = {
        ...dataJson,
        ...(dataJson.selected_meter_id == null &&
        meterCtx?.resolvedSelectedMeterId != null
          ? { selected_meter_id: meterCtx.resolvedSelectedMeterId }
          : {}),
        calc_result: calcResult,
        scenarios_v2: ctxFinal.scenarios_v2 ?? [],
        ...(isUseOfficialShadingEnabled() && solarnextPayload?.shading_official
          ? {
              shading_official: solarnextPayload.shading_official,
              ...(solarnextPayload.shading_debug ? { shading_debug: solarnextPayload.shading_debug } : {}),
            }
          : {}),
        ...(isShadingParityPersistEnabled() && solarnextPayload?.shading_parity_debug
          ? { shading_parity_debug: solarnextPayload.shading_parity_debug }
          : {}),
        ...(meterSnapshot && Object.keys(meterSnapshot).length > 0
          ? {
              ...(prevSnap && prevAt
                ? {
                    meter_snapshot_previous: prevSnap,
                    meter_snapshot_previous_captured_at: prevAt,
                  }
                : {}),
              meter_snapshot: meterSnapshot,
              meter_snapshot_captured_at: calcResult.computed_at,
              meter_calc_change_lines_fr: changeLinesFr,
            }
          : {}),
      };

      let finalStudyJson = null;
      const calpinageRes = await pool.query(
        "SELECT geometry_json FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2",
        [versionId, org]
      );
      if (calpinageRes.rows.length > 0 && calpinageRes.rows[0].geometry_json) {
        finalStudyJson = buildFinalStudyJson({
          geometryJson: calpinageRes.rows[0].geometry_json,
          calcResult: { summary, computed_at: calcResult.computed_at },
          production: ctxFinal.production ?? undefined,
        });
      }

      if (finalStudyJson != null) {
        await pool.query(
          "UPDATE study_versions SET data_json = $1::jsonb, final_study_json = $2::jsonb WHERE id = $3",
          [JSON.stringify(merged), JSON.stringify(finalStudyJson), versionId]
        );
      } else {
        await pool.query(
          "UPDATE study_versions SET data_json = $1::jsonb WHERE id = $2",
          [JSON.stringify(merged), versionId]
        );
      }
      if (process.env.NODE_ENV !== "production" || process.env.LOG_STUDY_CALC_PERSIST === "1") {
        const persistedIds = (ctxFinal.scenarios_v2 || []).map((s) => s?.id ?? s?.name).filter(Boolean);
        console.log(
          "[studyCalc] persisted scenarios_v2 → study_versions.id (UUID) =",
          versionId,
          "version_number =",
          versionRow.version_number,
          "ids =",
          persistedIds.join(",")
        );
      }
    }

    const summary = buildSummary(ctxFinal);
    void logAuditEvent({
      action: AuditActions.STUDY_CALC_LAUNCHED,
      entityType: "study_version",
      entityId: auditVersionId,
      organizationId: org,
      userId: userIdFromReq(req),
      req,
      statusCode: 200,
      metadata: {
        study_id: studyId,
        version_number: versionNum,
        calc_source: "study_calc_endpoint",
      },
    });
    if (req._validateDevisTechnique === true && Array.isArray(ctxFinal.scenarios_v2)) {
      const scenarios = buildScenariosSummaryFromV2(ctxFinal.scenarios_v2);
      const ids = (ctxFinal.scenarios_v2 || []).map((s) => s?.id ?? s?.name).filter(Boolean);
      if (process.env.NODE_ENV !== "production" || process.env.LOG_PAYLOAD_BATTERIES === "1") {
        console.log("[studyCalc] calc_result.scenarios_v2 ids =", ids);
      }
      return res.json({
        status: "SCENARIOS_GENERATED",
        scenarios: {
          ids,
          count: scenarios.count,
          base_roi_years: scenarios.base_roi_years,
          physical_roi_years: scenarios.physical_roi_years,
          virtual_roi_years: scenarios.virtual_roi_years,
        },
      });
    }
    res.json({ ok: true, summary });
  } catch (e) {
    console.error("[studyCalc.controller] runStudyCalc:", e);
    res.status(500).json({
      error: e.message || "Erreur lors du calcul",
    });
  }
}

function buildSummary(ctx) {
  const scenarios = ctx?.scenarios || {};
  const BASE = scenarios.BASE || {};
  const pv = ctx?.pv || {};
  return {
    annual_kwh: pv.total_kwh ?? pv.annual_kwh ?? null,
    capex_ttc: BASE.capex_ttc ?? null,
    roi_years: BASE.roi_years ?? null,
    scenarios: {
      BASE: { capex_ttc: BASE.capex_ttc, roi_years: BASE.roi_years },
    },
  };
}

/** Résumé minimal scenarios_v2 pour validate-devis-technique (count + roi_years par type). */
function buildScenariosSummaryFromV2(scenariosV2) {
  if (!Array.isArray(scenariosV2)) {
    return { count: 0, base_roi_years: null, physical_roi_years: null, virtual_roi_years: null };
  }
  let base_roi_years = null;
  let physical_roi_years = null;
  let virtual_roi_years = null;
  for (const sc of scenariosV2) {
    const roi = sc?.finance?.roi_years ?? null;
    if (sc?.id === "BASE") base_roi_years = roi;
    else if (sc?.id === "BATTERY_PHYSICAL") physical_roi_years = roi;
    else if (sc?.id === "BATTERY_VIRTUAL") virtual_roi_years = roi;
  }
  return {
    count: scenariosV2.length,
    base_roi_years,
    physical_roi_years,
    virtual_roi_years,
  };
}
