/**
 * domains/leads/sub/detail.js — Migré depuis routes/leads/detail.js (Step #8).
 * Chemins relatifs mis à jour : "../../" → "../../../"
 */

/**
 * CP-028 Phase 2 — Routes détail Lead
 * GET /api/leads/:id — lead + stage + history
 * PATCH /api/leads/:id/stage — changement stage atomique + historique
 */

import express from "express";
import { verifyJWT } from "../../../middleware/auth.middleware.js";
import { requireAnyPermission } from "../../../rbac/rbac.middleware.js";
import { pool } from "../../../config/db.js";
import { getUserPermissions } from "../../../rbac/rbac.service.js";
import { recalculateLeadScore } from "../../../services/leadScoring.service.js";
import { createAutoActivity } from "../../../modules/activities/activity.service.js";
import { pickLeadEquipmentApiFields } from "../../../services/leadEquipmentMerge.service.js";
import {
  ensureDefaultLeadMeter,
  getDefaultMeterRow,
  hydrateLeadWithDefaultMeterFields,
  syncDefaultMeterFromLeadRow,
} from "../../../services/leadMeters.service.js";
import {
  assertLeadApiAccess,
  hasEffectiveLeadUpdateScope,
  leadUpdateFlagsForQuery,
} from "../../../services/leadRequestAccess.service.js";
import { logAuditEvent } from "../../../services/audit/auditLog.service.js";
import { AuditActions } from "../../../services/audit/auditActions.js";
import { ensureClientWhenSignedStage } from "../../../services/leadClientConversion.service.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

/**
 * GET /api/leads/:id
 * Retourne lead, stage, history (stage_history)
 */
async function getDetail(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;

    const gate = await assertLeadApiAccess(pool, {
      leadId: id,
      organizationId: org,
      userId: uid,
      mode: "read",
      logContext: "GET /api/leads/:id",
      req,
    });
    if (!gate.ok) {
      return res.status(gate.status).json(gate.body);
    }

    const leadQuery = `SELECT l.*, ps.name as stage_name, ps.code as stage_code, ps.position as stage_position, ps.is_closed as stage_is_closed,
       ls.name as source_name,
       ls.slug as source_slug,
       ma.name AS mairie_name,
       ma.postal_code AS mairie_postal_code,
       ma.city AS mairie_city,
       ma.portal_url AS mairie_portal_url,
       ma.portal_type AS mairie_portal_type,
       ma.account_status AS mairie_account_status,
       ma.account_email AS mairie_account_email,
       ma.bitwarden_ref AS mairie_bitwarden_ref
       FROM leads l
       LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
       LEFT JOIN lead_sources ls ON ls.id = l.source_id
       LEFT JOIN mairies ma ON ma.id = l.mairie_id AND ma.organization_id = l.organization_id
       WHERE l.id = $1 AND l.organization_id = $2`;
    const leadParams = [id, org];

    const leadResult = await pool.query(leadQuery, leadParams);
    if (leadResult.rows.length === 0) {
      return res.status(404).json({
        error: "Aucun lead ne correspond à cet identifiant pour votre organisation.",
        code: "LEAD_NOT_FOUND",
      });
    }

    const leadRow = leadResult.rows[0];
    const lead = {
      id: leadRow.id,
      organization_id: leadRow.organization_id,
      civility: leadRow.civility,
      full_name: leadRow.full_name,
      first_name: leadRow.first_name,
      last_name: leadRow.last_name,
      company_name: leadRow.company_name ?? null,
      contact_first_name: leadRow.contact_first_name ?? null,
      contact_last_name: leadRow.contact_last_name ?? null,
      siret: leadRow.siret ?? null,
      birth_date:
        leadRow.birth_date != null
          ? typeof leadRow.birth_date === "string"
            ? leadRow.birth_date.slice(0, 10)
            : leadRow.birth_date instanceof Date
              ? leadRow.birth_date.toISOString().slice(0, 10)
              : String(leadRow.birth_date).slice(0, 10)
          : null,
      email: leadRow.email,
      phone: leadRow.phone,
      phone_mobile: leadRow.phone_mobile,
      phone_landline: leadRow.phone_landline,
      address: leadRow.address,
      source_id: leadRow.source_id,
      source_name: leadRow.source_name ?? null,
      source_slug: leadRow.source_slug ?? null,
      assigned_user_id: leadRow.assigned_user_id,
      customer_type: leadRow.customer_type,
      stage_id: leadRow.stage_id,
      status: leadRow.status ?? "LEAD",
      client_id: leadRow.client_id,
      site_address_id: leadRow.site_address_id,
      mairie_id: leadRow.mairie_id ?? null,
      mairie_name: leadRow.mairie_id ? leadRow.mairie_name ?? null : null,
      mairie_postal_code: leadRow.mairie_id ? leadRow.mairie_postal_code ?? null : null,
      mairie_city: leadRow.mairie_id ? leadRow.mairie_city ?? null : null,
      mairie_portal_url: leadRow.mairie_id ? leadRow.mairie_portal_url ?? null : null,
      mairie_portal_type: leadRow.mairie_id ? leadRow.mairie_portal_type ?? null : null,
      mairie_account_status: leadRow.mairie_id ? leadRow.mairie_account_status ?? null : null,
      mairie_account_email: leadRow.mairie_id ? leadRow.mairie_account_email ?? null : null,
      mairie_bitwarden_ref: leadRow.mairie_id ? leadRow.mairie_bitwarden_ref ?? null : null,
      billing_address_id: leadRow.billing_address_id,
      notes: leadRow.notes,
      internal_note: leadRow.internal_note,
      score: leadRow.score,
      potential_revenue: leadRow.potential_revenue,
      inactivity_level: leadRow.inactivity_level,
      estimated_kw: leadRow.estimated_kw,
      consumption_mode: leadRow.consumption_mode,
      consumption_annual_kwh: leadRow.consumption_annual_kwh,
      consumption_annual_calculated_kwh: leadRow.consumption_annual_calculated_kwh,
      consumption_pdl: leadRow.consumption_pdl,
      hp_hc: leadRow.hp_hc,
      supplier_name: leadRow.supplier_name,
      consumption_profile: leadRow.consumption_profile,
      tariff_type: leadRow.tariff_type,
      grid_type: leadRow.grid_type,
      meter_power_kva: leadRow.meter_power_kva,
      property_type: leadRow.property_type,
      household_size: leadRow.household_size,
      construction_year: leadRow.construction_year,
      insulation_level: leadRow.insulation_level,
      roof_type: leadRow.roof_type,
      frame_type: leadRow.frame_type,
      estimated_budget_eur: leadRow.estimated_budget_eur,
      project_status: leadRow.project_status,
      financing_mode: leadRow.financing_mode,
      project_timing: leadRow.project_timing,
      is_primary_residence: leadRow.is_primary_residence,
      house_over_2_years: leadRow.house_over_2_years,
      is_abf_zone: leadRow.is_abf_zone,
      has_asbestos_roof: leadRow.has_asbestos_roof,
      rgpd_consent: leadRow.rgpd_consent,
      rgpd_consent_at: leadRow.rgpd_consent_at,
      marketing_opt_in: leadRow.marketing_opt_in ?? false,
      marketing_opt_in_at: leadRow.marketing_opt_in_at ?? null,
      last_activity_at: leadRow.last_activity_at,
      created_at: leadRow.created_at,
      updated_at: leadRow.updated_at,
      energy_profile: leadRow.energy_profile ?? null,
      ...pickLeadEquipmentApiFields(leadRow),
    };

    let defaultMeter = await getDefaultMeterRow(pool, leadRow.id, org);
    if (!defaultMeter) {
      await ensureDefaultLeadMeter(pool, leadRow.id, org);
      defaultMeter = await getDefaultMeterRow(pool, leadRow.id, org);
    }
    const leadForApi = hydrateLeadWithDefaultMeterFields(lead, defaultMeter);

    const stage = leadRow.stage_id
      ? {
          id: leadRow.stage_id,
          name: leadRow.stage_name,
          code: leadRow.stage_code,
          position: leadRow.stage_position,
          is_closed: leadRow.stage_is_closed
        }
      : null;

    const historyResult = await pool.query(
      `SELECT h.id, h.lead_id, h.from_stage_id, h.to_stage_id, h.changed_by, h.changed_at,
        ps_from.name as from_stage_name,
        ps_to.name as to_stage_name,
        u.email as changed_by_email
       FROM lead_stage_history h
       LEFT JOIN pipeline_stages ps_from ON ps_from.id = h.from_stage_id
       LEFT JOIN pipeline_stages ps_to ON ps_to.id = h.to_stage_id
       LEFT JOIN users u ON u.id = h.changed_by
       WHERE h.lead_id = $1
       ORDER BY h.changed_at ASC`,
      [id]
    );

    const history = historyResult.rows.map((r) => ({
      id: r.id,
      lead_id: r.lead_id,
      from_stage_id: r.from_stage_id,
      to_stage_id: r.to_stage_id,
      from_stage_name: r.from_stage_name,
      to_stage_name: r.to_stage_name,
      changed_by: r.changed_by,
      changed_by_email: r.changed_by_email,
      changed_at: r.changed_at
    }));

    const stagesResult = await pool.query(
      `SELECT id, name, code, position, is_closed FROM pipeline_stages
       WHERE organization_id = $1 ORDER BY position ASC`,
      [org]
    );

    let site_address = null;
    let billing_address = null;
    if (leadRow.site_address_id) {
      const saRes = await pool.query(
        "SELECT * FROM addresses WHERE id = $1 AND organization_id = $2",
        [leadRow.site_address_id, org]
      );
      site_address = saRes.rows[0] || null;
    }
    if (leadRow.billing_address_id) {
      const baRes = await pool.query(
        "SELECT * FROM addresses WHERE id = $1 AND organization_id = $2",
        [leadRow.billing_address_id, org]
      );
      billing_address = baRes.rows[0] || null;
    }

    let consumption_monthly = [];
    if (leadRow.consumption_mode === "MONTHLY") {
      const cmRes = await pool.query(
        `SELECT lcm.month, lcm.kwh FROM lead_consumption_monthly lcm
         INNER JOIN lead_meters lm ON lm.id = lcm.meter_id AND lm.lead_id = lcm.lead_id
         WHERE lcm.lead_id = $1 AND lcm.year = extract(year from now())::int
           AND lm.is_default = true
         ORDER BY lcm.month`,
        [id]
      );
      consumption_monthly = cmRes.rows;
    }

    res.json({
      lead: leadForApi,
      stage,
      history,
      stages: stagesResult.rows,
      site_address,
      billing_address,
      consumption_monthly
    });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PATCH /api/leads/:id/stage
 * Changement stage atomique + entrée historique
 */
async function patchStage(req, res) {
  const client = await pool.connect();
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;
    const { stageId } = req.body;

    if (!stageId) {
      return res.status(400).json({ error: "stageId requis" });
    }

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org
    });
    if (!hasEffectiveLeadUpdateScope(req, perms)) {
      return res.status(403).json({
        error: "Vous n'avez pas l'autorisation de modifier ce dossier.",
        code: "LEAD_ACCESS_DENIED",
      });
    }
    const { canUpdateAll, canUpdateSelf } = leadUpdateFlagsForQuery(req, perms);

    await client.query("BEGIN");

    const leadCheck = await client.query(
      `SELECT l.id, l.stage_id, l.status FROM leads l
       WHERE l.id = $1 AND l.organization_id = $2 AND (l.archived_at IS NULL)${canUpdateSelf && !canUpdateAll ? " AND l.assigned_user_id = $3" : ""}`,
      canUpdateSelf && !canUpdateAll ? [id, org, uid] : [id, org]
    );

    if (leadCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: "Lead non trouvé" });
    }

    if (leadCheck.rows[0].status === "CLIENT") {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Les clients convertis ne peuvent pas être déplacés dans le pipeline" });
    }

    const currentStageId = leadCheck.rows[0].stage_id;

    const stageCheck = await client.query(
      `SELECT id, name, code FROM pipeline_stages WHERE id = $1 AND organization_id = $2`,
      [stageId, org]
    );

    if (stageCheck.rows.length === 0) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: "Stage invalide ou n'appartient pas à votre organisation" });
    }

    if (currentStageId === stageId) {
      await client.query("ROLLBACK");
      return res.json({
        stage: { id: stageCheck.rows[0].id, name: stageCheck.rows[0].name }
      });
    }

    const stageCode = stageCheck.rows[0].code;

    // CP-AUTO-CONVERT-ARCHIVE-08 : archivage auto si stage LOST
    const isLostStage = stageCode === "LOST";

    if (isLostStage) {
      await client.query(
        `UPDATE leads SET stage_id = $1, updated_at = now(), last_activity_at = now(),
          archived_at = now(), archived_by = $2, archived = true, archived_reason = 'LOST'
         WHERE id = $3 AND organization_id = $4`,
        [stageId, uid, id, org]
      );
    } else {
      await client.query(
        `UPDATE leads SET stage_id = $1, updated_at = now(), last_activity_at = now()
         WHERE id = $2 AND organization_id = $3`,
        [stageId, id, org]
      );
    }

    // CP-LEAD-CLIENT-SPLIT-06-LOCK : étape SIGNED = conversion complète (fiche clients + client_id)
    const isSignedStage = stageCode === "SIGNED";
    if (isSignedStage) {
      await ensureClientWhenSignedStage(client, id, org, "SIGNE");
    }

    await client.query(
      `INSERT INTO lead_stage_history (lead_id, from_stage_id, to_stage_id, changed_by)
       VALUES ($1, $2, $3, $4)`,
      [id, currentStageId, stageId, uid]
    );

    await client.query("COMMIT");

    try {
      await createAutoActivity(org, id, uid, "STAGE_CHANGE", "Étape pipeline modifiée", {
        from_stage_id: currentStageId,
        to_stage_id: stageId
      });
      if (isSignedStage) {
        await createAutoActivity(org, id, uid, "DEVIS_SIGNE", "Lead converti en client (stage Signé)", {
          from_stage_id: currentStageId,
          to_stage_id: stageId
        });
      }
      if (isLostStage) {
        await createAutoActivity(org, id, uid, "LEAD_ARCHIVED", "Lead archivé (stage Perdu)", {
          from_stage_id: currentStageId,
          to_stage_id: stageId,
          archived_reason: "LOST"
        });
      }
    } catch (_) {}

    await recalculateLeadScore(id, org);

    void logAuditEvent({
      action: AuditActions.LEAD_STAGE_CHANGED,
      entityType: "lead",
      entityId: id,
      organizationId: org,
      userId: uid,
      req,
      statusCode: 200,
      metadata: {
        old_stage_id: currentStageId,
        new_stage_id: stageId,
        stage_code: stageCode,
      },
    });

    res.json({
      stage: { id: stageCheck.rows[0].id, name: stageCheck.rows[0].name }
    });
  } catch (e) {
    await client.query("ROLLBACK");
    res.status(500).json({ error: e.message });
  } finally {
    client.release();
  }
}

/**
 * DELETE /api/leads/:id/energy-profile
 * Met à NULL le profil énergie du lead.
 */
async function deleteEnergyProfile(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;

    const gate = await assertLeadApiAccess(pool, {
      leadId: id,
      organizationId: org,
      userId: uid,
      mode: "write",
      forbidArchivedWrite: true,
      logContext: "DELETE /api/leads/:id/energy-profile",
      req,
    });
    if (!gate.ok) {
      return res.status(gate.status).json(gate.body);
    }

    const r = await pool.query(
      "UPDATE leads SET energy_profile = NULL, updated_at = CURRENT_TIMESTAMP WHERE id = $1 AND organization_id = $2 RETURNING *",
      [id, org]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({
        error: "Aucun lead ne correspond à cet identifiant pour votre organisation.",
        code: "LEAD_NOT_FOUND",
      });
    }
    await syncDefaultMeterFromLeadRow(pool, r.rows[0]);
    res.json({ success: true, code: "ENERGY_PROFILE_CLEARED" });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

router.get("/:id", verifyJWT, requireAnyPermission(["lead.read.all", "lead.read.self"]), getDetail);
router.patch(
  "/:id/stage",
  verifyJWT,
  requireAnyPermission(["lead.update.all", "lead.update.self"]),
  patchStage
);

export default router;
export { getDetail, patchStage, deleteEnergyProfile };
