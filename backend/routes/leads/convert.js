/**
 * CP-028 — Conversion Lead → Client
 * CP-032C — withTx + assertOrgEntity
 * POST /api/leads/:id/convert
 * Transaction atomique : client créé, lead mis à jour, historique inséré
 */

import { pool } from "../../config/db.js";
import { withTx } from "../../db/tx.js";
import { assertOrgEntity } from "../../services/guards.service.js";
import { getUserPermissions } from "../../rbac/rbac.service.js";
import { logAuditEvent } from "../../services/audit/auditLog.service.js";
import { AuditActions } from "../../services/audit/auditActions.js";
import { createClientAndLinkLead } from "../../services/leadClientConversion.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function convertLead(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id: leadId } = req.params;

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org,
    });
    const canUpdateAll = perms.has("lead.update.all");
    const canUpdateSelf = perms.has("lead.update.self");

    const { client, lead: updatedLead } = await withTx(pool, async (dbClient) => {
      await assertOrgEntity(dbClient, "leads", leadId, org);
      const leadFullRes = await dbClient.query(
        `SELECT * FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [leadId, org]
      );
      const lead = leadFullRes.rows[0];
      if (!lead) {
        const err = new Error("Lead non trouvé");
        err.statusCode = 404;
        throw err;
      }
      const effectiveOwner = lead.assigned_user_id;
      if (canUpdateSelf && !canUpdateAll && effectiveOwner !== uid) {
        const err = new Error("Lead non trouvé");
        err.statusCode = 404;
        throw err;
      }
      if (lead.client_id) {
        const err = new Error("Lead déjà converti en client");
        err.statusCode = 400;
        throw err;
      }

      const { client: newClient } = await createClientAndLinkLead(dbClient, lead, org, {});

      await dbClient.query(
        `INSERT INTO lead_stage_history (
          lead_id,
          from_stage_id,
          to_stage_id,
          changed_by,
          note
        ) VALUES ($1, $2, $2, $3, $4)`,
        [leadId, lead.stage_id, uid, "Lead converti en client"]
      );

      const updatedLeadResult = await dbClient.query(
        `SELECT l.*, ps.name as stage_name FROM leads l
         LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
         WHERE l.id = $1 AND l.organization_id = $2`,
        [leadId, org]
      );

      return {
        client: newClient,
        lead: updatedLeadResult.rows[0],
      };
    });

    void logAuditEvent({
      action: AuditActions.LEAD_CONVERTED_TO_CLIENT,
      entityType: "lead",
      entityId: leadId,
      organizationId: org,
      userId: uid,
      targetLabel: updatedLead?.full_name || client?.email || undefined,
      req,
      statusCode: 200,
      metadata: {
        client_id: client?.id,
        client_number: client?.client_number,
      },
    });

    res.json({
      client,
      lead: updatedLead,
    });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ error: e.message });
  }
}
