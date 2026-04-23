/**
 * CP-1 — API Calpinage Persist
 * GET/POST /api/studies/:studyId/versions/:versionId/calpinage
 * PROMPT 8 : garde is_locked (409) sur upsert.
 */

import { pool } from "../config/db.js";
import { withTx } from "../db/tx.js";
import * as studiesService from "../routes/studies/service.js";
import { V2_SCHEMA_VERSION } from "../services/calpinage/calpinageShadingNormalizer.js";
import { adaptLegacyShadingToV2, getNormalizedShadingFromGeometry } from "../services/calpinage/calpinageShadingLegacyAdapter.js";
import { mergeLayoutSnapshotForUpsert } from "../services/calpinage/mergeGeometryLayoutSnapshot.js";
import { computeCalpinageGeometryHash } from "../services/calpinage/calpinageGeometryHash.js";
import { lockCalpinageVersion } from "../services/calpinage/calpinageDataConcurrency.js";
import { withPgRetryOnce } from "../utils/pgRetry.js";
import {
  resolvePanelPowerWc,
  isInstalledKwcDivergent,
} from "../utils/resolvePanelPowerWc.js";
import { DEFAULT_PANEL_POWER_WC } from "../services/core/engineConstants.js";
import { fetchPvPanelRowById } from "../services/pv/resolvePanelFromDb.service.js";
import { fetchPvInverterRowById } from "../services/pv/resolveInverterFromDb.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

function traceCalpinageEnabled() {
  return process.env.SN_CALPINAGE_TRACE === "1";
}

function traceCalpinageLog(event, fields) {
  if (!traceCalpinageEnabled()) return;
  console.warn("[SN-CALPINAGE-TRACE]", JSON.stringify({ ts: new Date().toISOString(), event, ...fields }));
}

function snapMeta(label, geometryJson) {
  if (!geometryJson || typeof geometryJson !== "object") {
    return { label, hasLayoutSnapshot: false, layoutSnapshotLen: 0, hasGeometryHash: false };
  }
  const s = geometryJson.layout_snapshot;
  const h = geometryJson.geometry_hash;
  return {
    label,
    hasLayoutSnapshot: typeof s === "string" && s.length > 0,
    layoutSnapshotLen: typeof s === "string" ? s.length : 0,
    hasGeometryHash: typeof h === "string" && h.length > 0,
    geometryHashHead: typeof h === "string" ? h.slice(0, 16) : null,
  };
}

function assignPanelPatchFromDb(patch, dbPanel) {
  if (!dbPanel || typeof dbPanel !== "object") return;
  if (dbPanel.brand != null && String(dbPanel.brand).trim() !== "") {
    patch.brand = dbPanel.brand;
  }
  const modelRef = dbPanel.model_ref != null ? String(dbPanel.model_ref) : "";
  const name = dbPanel.name != null ? String(dbPanel.name) : "";
  if (modelRef.trim() !== "") {
    patch.model_ref = dbPanel.model_ref;
    patch.model = dbPanel.model_ref;
  } else if (name.trim() !== "") {
    patch.model = dbPanel.name;
  }
  const wm = dbPanel.width_mm != null ? Number(dbPanel.width_mm) : null;
  const hm = dbPanel.height_mm != null ? Number(dbPanel.height_mm) : null;
  if (wm != null && Number.isFinite(wm) && wm > 0) patch.width_mm = wm;
  if (hm != null && Number.isFinite(hm) && hm > 0) patch.height_mm = hm;
  if (dbPanel.temp_coeff_pct_per_deg != null && Number.isFinite(Number(dbPanel.temp_coeff_pct_per_deg))) {
    patch.temp_coeff_pct_per_deg = Number(dbPanel.temp_coeff_pct_per_deg);
  }
  if (dbPanel.degradation_annual_pct != null && Number.isFinite(Number(dbPanel.degradation_annual_pct))) {
    patch.degradation_annual_pct = Number(dbPanel.degradation_annual_pct);
  }
  if (dbPanel.degradation_first_year_pct != null && Number.isFinite(Number(dbPanel.degradation_first_year_pct))) {
    patch.degradation_first_year_pct = Number(dbPanel.degradation_first_year_pct);
  }
}

function assignInverterPatchFromDb(patch, row) {
  if (!row || typeof row !== "object") return;
  if (row.brand != null && String(row.brand).trim() !== "") patch.brand = row.brand;
  if (row.name != null && String(row.name).trim() !== "") patch.name = row.name;
  if (row.model_ref != null && String(row.model_ref).trim() !== "") patch.model_ref = row.model_ref;
  if (row.inverter_type != null && String(row.inverter_type).trim() !== "") {
    patch.inverter_type = String(row.inverter_type).trim().toLowerCase();
  }
  if (row.inverter_family != null && String(row.inverter_family).trim() !== "") {
    patch.inverter_family = String(row.inverter_family).trim().toUpperCase();
  }
  if (row.nominal_power_kw != null && Number.isFinite(Number(row.nominal_power_kw))) {
    patch.nominal_power_kw = Number(row.nominal_power_kw);
  }
  if (row.nominal_va != null && Number.isFinite(Number(row.nominal_va))) {
    patch.nominal_va = Number(row.nominal_va);
  }
  if (
    row.euro_efficiency_pct != null &&
    Number.isFinite(Number(row.euro_efficiency_pct)) &&
    Number(row.euro_efficiency_pct) > 50
  ) {
    patch.euro_efficiency_pct = Number(row.euro_efficiency_pct);
  }
  if (
    row.modules_per_inverter != null &&
    Number.isFinite(Number(row.modules_per_inverter)) &&
    Number(row.modules_per_inverter) > 0
  ) {
    patch.modules_per_inverter = Number(row.modules_per_inverter);
  }
}

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

/**
 * Résout study_version_id depuis studyId + versionNumber
 */
async function resolveStudyVersion(studyId, versionNumber, organizationId) {
  const version = await studiesService.getVersion(studyId, versionNumber, organizationId);
  if (!version) return null;
  return version.id; // study_version_id (uuid)
}

/**
 * GET /api/studies/:studyId/versions/:versionId/calpinage
 */
export async function getCalpinage(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const studyId = req.params.studyId;
    const versionNum = parseInt(req.params.versionId, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      return res.status(400).json({ error: "Numéro de version invalide" });
    }

    const studyVersionId = await resolveStudyVersion(studyId, versionNum, org);
    if (!studyVersionId) {
      return res.status(404).json({ error: "Étude ou version non trouvée" });
    }

    const r = await pool.query(
      `SELECT id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct, created_at
       FROM calpinage_data
       WHERE study_version_id = $1 AND organization_id = $2`,
      [studyVersionId, org]
    );

    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Calpinage non trouvé" });
    }

    const row = r.rows[0];
    let geometryJson = row.geometry_json || {};
    if (geometryJson && typeof geometryJson === "object" && geometryJson.shading) {
      const { shading } = getNormalizedShadingFromGeometry(geometryJson);
      geometryJson = { ...geometryJson, shading };
    }
    res.json({
      ok: true,
      calpinageData: {
        id: row.id,
        geometry_json: geometryJson,
        total_panels: row.total_panels,
        total_power_kwc: row.total_power_kwc ? Number(row.total_power_kwc) : null,
        annual_production_kwh: row.annual_production_kwh ? Number(row.annual_production_kwh) : null,
        total_loss_pct: row.total_loss_pct ? Number(row.total_loss_pct) : null,
        created_at: row.created_at,
      },
    });
  } catch (e) {
    console.error("[calpinage.controller] getCalpinage:", e);
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/studies/:studyId/versions/:versionId/calpinage
 * Body: { geometry_json, total_panels?, total_power_kwc?, annual_production_kwh?, total_loss_pct? }
 */
export async function upsertCalpinage(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const studyId = req.params.studyId;
    const versionNum = parseInt(req.params.versionId, 10);
    if (isNaN(versionNum) || versionNum < 1) {
      return res.status(400).json({ error: "Numéro de version invalide" });
    }

    const version = await studiesService.getVersion(studyId, versionNum, org);
    if (!version) return res.status(404).json({ error: "Étude ou version non trouvée" });
    if (version.is_locked) return res.status(400).json({ error: "LOCKED_VERSION" });
    const studyVersionId = version.id;

    const body = req.body || {};
    let geometryJson = body.geometry_json;
    if (geometryJson === undefined) {
      geometryJson = body;
    }
    if (!geometryJson || typeof geometryJson !== "object") {
      return res.status(400).json({ error: "geometry_json requis (objet JSON)" });
    }

    let toSave = { ...geometryJson };
    if (!toSave.schemaVersion) toSave.schemaVersion = V2_SCHEMA_VERSION;
    if (toSave.shading && typeof toSave.shading === "object") {
      toSave.shading = adaptLegacyShadingToV2(toSave.shading, toSave.schemaVersion);
    }

    let totalPanels = body.total_panels;
    let totalPowerKwc =
      body.total_power_kwc != null && body.total_power_kwc !== ""
        ? Number(body.total_power_kwc)
        : null;
    const annualProductionKwh = body.annual_production_kwh ?? null;
    const totalLossPct = body.total_loss_pct ?? 0;

    // Déduire depuis geometry_json si absent
    if (totalPanels == null && geometryJson.panels) {
      totalPanels = geometryJson.panels.count ?? 0;
    }
    if (totalPanels == null && geometryJson.frozenBlocks) {
      const blocks = geometryJson.frozenBlocks || [];
      totalPanels = blocks.reduce((sum, b) => sum + (b.panels?.length || 0), 0);
    }
    totalPanels = totalPanels != null ? parseInt(totalPanels, 10) : 0;
    if (!Number.isFinite(totalPowerKwc)) totalPowerKwc = null;

    const rawPanel = toSave.panelSpec ?? toSave.panel ?? null;
    let resolvedWp = null;
    const panelUuidRaw = rawPanel?.panel_id ?? rawPanel?.id ?? null;
    const panelUuid =
      panelUuidRaw != null && String(panelUuidRaw).trim() !== ""
        ? String(panelUuidRaw).trim()
        : null;
    let dbPanel = null;
    if (panelUuid) {
      dbPanel = await fetchPvPanelRowById(pool, panelUuid);
      if (dbPanel && dbPanel.power_wc != null) {
        const pw = Number(dbPanel.power_wc);
        if (Number.isFinite(pw) && pw > 50) resolvedWp = pw;
      }
    }
    if (resolvedWp == null) resolvedWp = resolvePanelPowerWc(rawPanel);

    if (panelUuid) {
      const patch = { id: panelUuid, panel_id: panelUuid };
      if (resolvedWp != null) patch.power_wc = resolvedWp;
      assignPanelPatchFromDb(patch, dbPanel);
      const next = { ...toSave };
      next.panel =
        toSave.panel && typeof toSave.panel === "object"
          ? { ...toSave.panel, ...patch }
          : { ...patch };
      if (next.panelSpec && typeof next.panelSpec === "object") {
        next.panelSpec = { ...next.panelSpec, ...patch };
      } else if (resolvedWp != null || dbPanel) {
        next.panelSpec = { ...patch };
      }
      toSave = next;
    }

    const rawInv = toSave.inverter && typeof toSave.inverter === "object" ? toSave.inverter : null;
    const invUuidRaw = rawInv?.inverter_id ?? rawInv?.id ?? null;
    const invUuid =
      invUuidRaw != null && String(invUuidRaw).trim() !== ""
        ? String(invUuidRaw).trim()
        : null;
    if (invUuid) {
      const dbInv = await fetchPvInverterRowById(pool, invUuid);
      const invPatch = { id: invUuid, inverter_id: invUuid };
      assignInverterPatchFromDb(invPatch, dbInv);
      const nextGeom = { ...toSave };
      nextGeom.inverter =
        toSave.inverter && typeof toSave.inverter === "object"
          ? { ...toSave.inverter, ...invPatch }
          : { ...invPatch };
      toSave = nextGeom;
    }

    if (totalPanels > 0 && resolvedWp != null) {
      const recomputed = (totalPanels * resolvedWp) / 1000;
      if (totalPowerKwc == null || isInstalledKwcDivergent(totalPowerKwc, recomputed)) {
        totalPowerKwc = recomputed;
      }
    } else if (totalPowerKwc == null && totalPanels > 0) {
      // Compat : aucune puissance panneau dans la géométrie — dernier recours (DEFAULT_PANEL_POWER_WC moteur)
      totalPowerKwc = (totalPanels * DEFAULT_PANEL_POWER_WC) / 1000;
    }

    const row = await withPgRetryOnce(() =>
      withTx(pool, async (client) => {
        await lockCalpinageVersion(client, org, studyVersionId);

        const existingRes = await client.query(
          `SELECT id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct, created_at
           FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2 FOR UPDATE`,
          [studyVersionId, org]
        );
        const existingGeometry = existingRes.rows[0]?.geometry_json ?? null;

        const newHash = computeCalpinageGeometryHash(toSave);
        const existingHash = existingGeometry?.geometry_hash;
        const hasStoredHash = typeof existingHash === "string" && existingHash.length > 0;
        const invalidated = hasStoredHash && newHash !== existingHash;

        const working = { ...toSave };
        if (invalidated) {
          delete working.layout_snapshot;
          delete working.geometry_hash;
        }

        const mergeSourceExisting =
          invalidated && existingGeometry && typeof existingGeometry === "object"
            ? { ...existingGeometry, layout_snapshot: undefined, geometry_hash: undefined }
            : existingGeometry;

        const mergedGeometry = mergeLayoutSnapshotForUpsert(working, mergeSourceExisting);
        if (invalidated) {
          delete mergedGeometry.geometry_hash;
        } else {
          mergedGeometry.geometry_hash = newHash;
        }

        traceCalpinageLog("upsert_before_persist", {
          studyId,
          versionNum,
          studyVersionId,
          organizationId: org,
          invalidated,
          existingHash: existingHash ?? null,
          newHash,
          existingSnap: snapMeta("existing_row", existingGeometry),
          workingSnap: snapMeta("working_after_strip", working),
          mergedSnap: snapMeta("mergedGeometry", mergedGeometry),
        });

        const r = await client.query(
          `INSERT INTO calpinage_data (organization_id, study_version_id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct)
           VALUES ($1, $2, $3::jsonb, $4, $5, $6, $7)
           ON CONFLICT (study_version_id)
           DO UPDATE SET
             geometry_json = EXCLUDED.geometry_json,
             total_panels = EXCLUDED.total_panels,
             total_power_kwc = EXCLUDED.total_power_kwc,
             annual_production_kwh = EXCLUDED.annual_production_kwh,
             total_loss_pct = EXCLUDED.total_loss_pct
           RETURNING id, geometry_json, total_panels, total_power_kwc, annual_production_kwh, total_loss_pct, created_at`,
          [org, studyVersionId, JSON.stringify(mergedGeometry), totalPanels, totalPowerKwc, annualProductionKwh, totalLossPct]
        );
        const persisted = r.rows[0];
        traceCalpinageLog("upsert_after_returning", {
          studyId,
          versionNum,
          studyVersionId,
          persistedSnap: snapMeta("returned_row", persisted?.geometry_json),
        });
        return persisted;
      })
    );
    const uid = req.user?.userId ?? req.user?.id ?? null;
    void logAuditEvent({
      action: AuditActions.CALPINAGE_SAVED,
      entityType: "study_version",
      entityId: studyVersionId,
      organizationId: org,
      userId: uid,
      req,
      statusCode: 200,
      metadata: {
        study_id: studyId,
        version_number: versionNum,
        total_panels: row.total_panels,
        total_power_kwc: row.total_power_kwc != null ? Number(row.total_power_kwc) : null,
      },
    });
    res.json({
      ok: true,
      calpinageData: {
        id: row.id,
        geometry_json: row.geometry_json,
        total_panels: row.total_panels,
        total_power_kwc: row.total_power_kwc ? Number(row.total_power_kwc) : null,
        annual_production_kwh: row.annual_production_kwh ? Number(row.annual_production_kwh) : null,
        total_loss_pct: row.total_loss_pct ? Number(row.total_loss_pct) : null,
        created_at: row.created_at,
      },
    });
  } catch (e) {
    console.error("[calpinage.controller] upsertCalpinage:", e);
    res.status(500).json({ error: e.message });
  }
}
