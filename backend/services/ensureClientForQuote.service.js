/**
 * Garantit un client facturable pour un devis accepté (transaction PoolClient).
 * Ne crée pas de doublon si email ou téléphone existe déjà sur un client de l’org.
 */

import {
  createClientAndLinkLead,
} from "./leadClientConversion.service.js";

/**
 * @param {import("pg").PoolClient} dbClient
 * @param {Record<string, unknown>} quoteRow — ligne quotes (déjà verrouillée FOR UPDATE recommandé)
 * @param {string} organizationId
 * @returns {Promise<string>} client_id résolu
 */
export async function ensureClientForQuote(dbClient, quoteRow, organizationId) {
  const qid = quoteRow.id;
  const org = organizationId;
  if (String(quoteRow.organization_id) !== String(org)) {
    throw new Error("Incohérence d’organisation : devis hors périmètre.");
  }

  let cid = quoteRow.client_id ?? null;
  if (cid) {
    const ok = await dbClient.query(
      `SELECT id FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [cid, org]
    );
    if (ok.rows.length === 0) {
      throw new Error("Le devis référence un client introuvable ou archivé.");
    }
    if (quoteRow.lead_id) {
      await dbClient.query(
        `UPDATE leads
         SET status = 'CLIENT', updated_at = now()
         WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [quoteRow.lead_id, org]
      );
    }
    return String(cid);
  }

  const leadId = quoteRow.lead_id ?? null;
  if (!leadId) {
    throw new Error(
      "Impossible de facturer ce devis : aucun client ou lead exploitable."
    );
  }

  const leadRes = await dbClient.query(
    `SELECT * FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL) FOR UPDATE`,
    [leadId, org]
  );
  const lead = leadRes.rows[0];
  if (!lead) {
    throw new Error("Impossible de facturer ce devis : lead introuvable ou archivé.");
  }

  if (String(lead.organization_id) !== String(org)) {
    throw new Error("Incohérence d’organisation : lead hors périmètre.");
  }

  if (lead.client_id) {
    const okC = await dbClient.query(
      `SELECT id FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [lead.client_id, org]
    );
    if (okC.rows.length === 0) {
      throw new Error("Lead lié à un client introuvable ou archivé — correction données requise.");
    }
    await dbClient.query(
      `UPDATE quotes SET client_id = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
      [lead.client_id, qid, org]
    );
    await dbClient.query(
      `UPDATE leads SET status = 'CLIENT', updated_at = now()
       WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [leadId, org]
    );
    return String(lead.client_id);
  }

  const emailRaw = lead.email != null ? String(lead.email).trim().toLowerCase() : "";
  if (emailRaw) {
    const byEmail = await dbClient.query(
      `SELECT id FROM clients
       WHERE organization_id = $1 AND (archived_at IS NULL)
         AND LOWER(TRIM(email)) = $2
       ORDER BY created_at ASC
       LIMIT 2`,
      [org, emailRaw]
    );
    if (byEmail.rows.length > 1) {
      throw new Error(
        "Plusieurs clients partagent cet e-mail dans l’organisation — résolution manuelle requise avant facturation."
      );
    }
    if (byEmail.rows.length === 1) {
      const foundId = byEmail.rows[0].id;
      await dbClient.query(
        `UPDATE leads SET client_id = $1, status = 'CLIENT', updated_at = now() WHERE id = $2 AND organization_id = $3`,
        [foundId, leadId, org]
      );
      await dbClient.query(
        `UPDATE quotes SET client_id = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
        [foundId, qid, org]
      );
      return String(foundId);
    }
  }

  const phoneCandidates = [];
  const m = lead.phone_mobile != null ? String(lead.phone_mobile).trim() : "";
  const p = lead.phone != null ? String(lead.phone).trim() : "";
  if (m) phoneCandidates.push(m);
  if (p && p !== m) phoneCandidates.push(p);

  for (const phoneVal of phoneCandidates) {
    if (!phoneVal) continue;
    const byPhone = await dbClient.query(
      `SELECT id FROM clients
       WHERE organization_id = $1 AND (archived_at IS NULL)
         AND (
           (NULLIF(TRIM(phone), '') IS NOT NULL AND TRIM(phone) = $2)
           OR (NULLIF(TRIM(mobile), '') IS NOT NULL AND TRIM(mobile) = $2)
         )
       ORDER BY created_at ASC
       LIMIT 2`,
      [org, phoneVal]
    );
    if (byPhone.rows.length > 1) {
      throw new Error(
        "Plusieurs clients partagent ce numéro de téléphone dans l’organisation — résolution manuelle requise avant facturation."
      );
    }
    if (byPhone.rows.length === 1) {
      const foundId = byPhone.rows[0].id;
      await dbClient.query(
        `UPDATE leads SET client_id = $1, status = 'CLIENT', updated_at = now() WHERE id = $2 AND organization_id = $3`,
        [foundId, leadId, org]
      );
      await dbClient.query(
        `UPDATE quotes SET client_id = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
        [foundId, qid, org]
      );
      return String(foundId);
    }
  }

  const { client } = await createClientAndLinkLead(dbClient, lead, org, {});
  await dbClient.query(
    `UPDATE quotes SET client_id = $1, updated_at = now() WHERE id = $2 AND organization_id = $3`,
    [client.id, qid, org]
  );
  return String(client.id);
}
