/**
 * POST /api/leads/:id/revert-to-lead
 * Remet un dossier statut CLIENT en LEAD (supprime la fiche client si aucune facture / avoir).
 */

import { pool } from "../../config/db.js";
import { withTx } from "../../db/tx.js";
import { assertOrgEntity } from "../../services/guards.service.js";
import { getUserPermissions } from "../../rbac/rbac.service.js";
import { logAuditEvent } from "../../services/audit/auditLog.service.js";
import { AuditActions } from "../../services/audit/auditActions.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function revertLeadToLead(req, res) {
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

    const out = await withTx(pool, async (dbClient) => {
      await assertOrgEntity(dbClient, "leads", leadId, org);
      const leadFullRes = await dbClient.query(`SELECT * FROM leads WHERE id = $1 AND organization_id = $2`, [
        leadId,
        org,
      ]);
      const lead = leadFullRes.rows[0];
      if (!lead) {
        const err = new Error("Lead non trouvé");
        err.statusCode = 404;
        throw err;
      }
      if (lead.status !== "CLIENT") {
        const err = new Error("Seuls les dossiers au statut client peuvent revenir en lead");
        err.statusCode = 400;
        throw err;
      }

      const effectiveOwner = lead.assigned_user_id;
      if (canUpdateSelf && !canUpdateAll && effectiveOwner !== uid) {
        const err = new Error("Lead non trouvé");
        err.statusCode = 404;
        throw err;
      }

      const clientId = lead.client_id;
      let nInv = 0;
      let nCn = 0;
      if (clientId) {
        const inv = await dbClient.query(`SELECT COUNT(*)::int AS n FROM invoices WHERE client_id = $1`, [clientId]);
        nInv = inv.rows[0].n;
        const cn = await dbClient.query(`SELECT COUNT(*)::int AS n FROM credit_notes WHERE client_id = $1`, [clientId]);
        nCn = cn.rows[0].n;
      }
      if (clientId && (nInv > 0 || nCn > 0)) {
        const err = new Error(
          `Impossible : factures ou avoirs liés à la fiche client (factures: ${nInv}, avoirs: ${nCn}).`
        );
        err.statusCode = 400;
        throw err;
      }

      if (clientId) {
        await dbClient.query(`UPDATE quotes SET client_id = NULL WHERE lead_id = $1`, [leadId]);
        await dbClient.query(`UPDATE studies SET client_id = NULL WHERE lead_id = $1`, [leadId]);
        await dbClient.query(`UPDATE missions SET client_id = NULL WHERE client_id = $1`, [clientId]);
        await dbClient.query(`DELETE FROM clients WHERE id = $1`, [clientId]);
      }

      await dbClient.query(
        `UPDATE leads
         SET status = 'LEAD', client_id = NULL, project_status = NULL, updated_at = now()
         WHERE id = $1 AND organization_id = $2`,
        [leadId, org]
      );

      return { previous_client_id: clientId };
    });

    void logAuditEvent({
      action: AuditActions.LEAD_REVERTED_TO_LEAD,
      entityType: "lead",
      entityId: leadId,
      organizationId: org,
      userId: uid,
      req,
      statusCode: 200,
      metadata: { previous_client_id: out.previous_client_id },
    });

    res.json({ ok: true, lead_id: leadId });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ error: e.message });
  }
}
