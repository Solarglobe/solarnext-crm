/**
 * CP-028 — Conversion Lead → Client (historique)
 * La fiche `clients` est créée uniquement via l’étape pipeline « Signé » (ensureClientWhenSignedStage).
 * Ces routes ne font plus de création : elles retournent la fiche existante si déjà liée (idempotent), sinon 400.
 */

import { pool } from "../../config/db.js";
import { withTx } from "../../db/tx.js";
import { assertOrgEntity } from "../../services/guards.service.js";
import { getUserPermissions } from "../../rbac/rbac.service.js";
import { logAuditEvent } from "../../services/audit/auditLog.service.js";
import { AuditActions } from "../../services/audit/auditActions.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {{ idempotent: boolean }} opts
 */
async function runConvert(req, res, opts) {
  const { idempotent } = opts;
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

    const { client, lead: updatedLead, alreadyConverted } = await withTx(pool, async (dbClient) => {
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
        if (idempotent) {
          const cr = await dbClient.query(
            `SELECT * FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
            [lead.client_id, org]
          );
          const clientRow = cr.rows[0];
          if (!clientRow) {
            const err = new Error("Client lié introuvable — contactez le support.");
            err.statusCode = 409;
            throw err;
          }
          const updatedLeadResult = await dbClient.query(
            `SELECT l.*, ps.name as stage_name FROM leads l
             LEFT JOIN pipeline_stages ps ON ps.id = l.stage_id
             WHERE l.id = $1 AND l.organization_id = $2`,
            [leadId, org]
          );
          return {
            client: clientRow,
            lead: updatedLeadResult.rows[0],
            alreadyConverted: true,
          };
        }
        const err = new Error("Lead déjà converti en client");
        err.statusCode = 400;
        throw err;
      }

      const err = new Error(
        "La fiche client est créée en déplaçant le dossier vers l'étape « Signé » du pipeline (plus de conversion manuelle ici)."
      );
      err.statusCode = 400;
      err.code = "CLIENT_REQUIRES_PIPELINE_SIGNED";
      throw err;
    });

    if (!alreadyConverted) {
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
    }

    res.json({
      client,
      lead: updatedLead,
      ...(idempotent ? { already_converted: Boolean(alreadyConverted) } : {}),
    });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ error: e.message, ...(e.code ? { code: e.code } : {}) });
  }
}

export async function convertLead(req, res) {
  return runConvert(req, res, { idempotent: false });
}

export async function convertLeadToClient(req, res) {
  return runConvert(req, res, { idempotent: true });
}
