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

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

/**
 * Génère le prochain client_number au format SG-{YYYY}-{NNNN} pour l'organisation
 */
async function generateClientNumber(client, organizationId) {
  const year = new Date().getFullYear();
  const prefix = `SG-${year}-`;
  const result = await client.query(
    `SELECT client_number FROM clients
     WHERE organization_id = $1 AND client_number LIKE $2
     ORDER BY client_number DESC LIMIT 1`,
    [organizationId, prefix + "%"]
  );
  let nextSeq = 1;
  if (result.rows.length > 0) {
    const last = result.rows[0].client_number;
    const match = last.match(new RegExp(`^SG-${year}-(\\d+)$`));
    if (match) nextSeq = parseInt(match[1], 10) + 1;
  }
  return `${prefix}${String(nextSeq).padStart(4, "0")}`;
}

/** Téléphone client : mobile prioritaire, sinon ligne legacy `phone`. */
function resolveLeadPhoneForClient(lead) {
  const mobile = lead.phone_mobile != null ? String(lead.phone_mobile).trim() : "";
  if (mobile) return mobile;
  const legacy = lead.phone != null ? String(lead.phone).trim() : "";
  if (legacy) return legacy;
  return null;
}

export async function convertLead(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id: leadId } = req.params;

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org
    });
    const canUpdateAll = perms.has("lead.update.all");
    const canUpdateSelf = perms.has("lead.update.self");

    const { client, lead: updatedLead } = await withTx(pool, async (dbClient) => {
      const leadRow = await assertOrgEntity(dbClient, "leads", leadId, org);
      const effectiveOwner =
        leadRow.assigned_salesperson_user_id ?? leadRow.assigned_to;
      if (canUpdateSelf && !canUpdateAll && effectiveOwner !== uid) {
        const err = new Error("Lead non trouvé");
        err.statusCode = 404;
        throw err;
      }
      if (leadRow.client_id) {
        const err = new Error("Lead déjà converti en client");
        err.statusCode = 400;
        throw err;
      }

      const lead = leadRow;

      const clientNumber = await generateClientNumber(dbClient, org);

      // PRO : company_name = nom entreprise, first_name/last_name = contact physique
      // PERSON : company_name vide, first_name/last_name = personne
      const isPro = (lead.customer_type ?? "PERSON") === "PRO";
      const clientFirstName = isPro
        ? (lead.contact_first_name ?? null)
        : (lead.first_name ?? null);
      const clientLastName = isPro
        ? (lead.contact_last_name ?? null)
        : (lead.last_name ?? null);
      const clientCompanyName = isPro ? (lead.company_name ?? null) : null;

      const resolvedPhone = resolveLeadPhoneForClient(lead);

      const clientResult = await dbClient.query(
        `INSERT INTO clients (
          organization_id,
          client_number,
          company_name,
          first_name,
          last_name,
          email,
          phone,
          siret,
          created_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, now())
        RETURNING *`,
        [
          lead.organization_id,
          clientNumber,
          clientCompanyName,
          clientFirstName,
          clientLastName,
          lead.email ?? null,
          resolvedPhone,
          lead.siret ?? null
        ]
      );
      const newClient = clientResult.rows[0];
      const clientId = newClient.id;

      await dbClient.query(
        `UPDATE leads
         SET status = 'CLIENT', client_id = $1, updated_at = now()
         WHERE id = $2 AND organization_id = $3`,
        [clientId, leadId, org]
      );

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
        lead: updatedLeadResult.rows[0]
      };
    });

    res.json({
      client,
      lead: updatedLead
    });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ error: e.message });
  }
}
