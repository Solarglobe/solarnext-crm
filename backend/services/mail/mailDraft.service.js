/**
 * Brouillons mail — CRUD strictement scopé organisation + utilisateur.
 * Un brouillon est personnel : seul son auteur le voit et le modifie.
 */

import { pool } from "../../config/db.js";

const BODY_HTML_MAX_LENGTH = 2_000_000;
const FIELD_MAX_LENGTH = 10_000;

function asTrimmedString(v, max = FIELD_MAX_LENGTH) {
  if (typeof v !== "string") return "";
  return v.slice(0, max);
}

/** Normalise et valide le payload d'écriture. Lève une erreur 400 si invalide. */
export function normalizeDraftPayload(body) {
  const bodyHtml = typeof body?.bodyHtml === "string" ? body.bodyHtml : "";
  if (bodyHtml.length > BODY_HTML_MAX_LENGTH) {
    const err = new Error("Brouillon trop volumineux.");
    err.statusCode = 413;
    throw err;
  }
  return {
    mailAccountId:
      typeof body?.mailAccountId === "string" && body.mailAccountId.trim()
        ? body.mailAccountId.trim()
        : null,
    to: asTrimmedString(body?.to),
    cc: asTrimmedString(body?.cc),
    bcc: asTrimmedString(body?.bcc),
    subject: asTrimmedString(body?.subject),
    bodyHtml,
  };
}

function rowToDraft(r) {
  return {
    id: r.id,
    mail_account_id: r.mail_account_id,
    to: r.to_recipients,
    cc: r.cc_recipients,
    bcc: r.bcc_recipients,
    subject: r.subject,
    body_html: r.body_html,
    created_at: r.created_at,
    updated_at: r.updated_at,
  };
}

/** @param {{ userId: string, organizationId: string }} p */
export async function listDrafts({ userId, organizationId }) {
  const { rows } = await pool.query(
    `SELECT id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
            subject, body_html, created_at, updated_at
       FROM mail_drafts
      WHERE organization_id = $1 AND user_id = $2
      ORDER BY updated_at DESC
      LIMIT 200`,
    [organizationId, userId]
  );
  return rows.map(rowToDraft);
}

/** @param {{ id: string, userId: string, organizationId: string }} p */
export async function getDraftById({ id, userId, organizationId }) {
  const { rows } = await pool.query(
    `SELECT id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
            subject, body_html, created_at, updated_at
       FROM mail_drafts
      WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
    [id, organizationId, userId]
  );
  return rows[0] ? rowToDraft(rows[0]) : null;
}

/**
 * @param {{ userId: string, organizationId: string,
 *   draft: ReturnType<typeof normalizeDraftPayload> }} p
 */
export async function createDraft({ userId, organizationId, draft }) {
  const { rows } = await pool.query(
    `INSERT INTO mail_drafts
       (organization_id, user_id, mail_account_id,
        to_recipients, cc_recipients, bcc_recipients, subject, body_html)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
     RETURNING id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
               subject, body_html, created_at, updated_at`,
    [
      organizationId,
      userId,
      draft.mailAccountId,
      draft.to,
      draft.cc,
      draft.bcc,
      draft.subject,
      draft.bodyHtml,
    ]
  );
  return rowToDraft(rows[0]);
}

/**
 * @param {{ id: string, userId: string, organizationId: string,
 *   draft: ReturnType<typeof normalizeDraftPayload> }} p
 * @returns brouillon mis à jour, ou null si introuvable / pas à l'utilisateur.
 */
export async function updateDraft({ id, userId, organizationId, draft }) {
  const { rows } = await pool.query(
    `UPDATE mail_drafts
        SET mail_account_id = $4,
            to_recipients = $5,
            cc_recipients = $6,
            bcc_recipients = $7,
            subject = $8,
            body_html = $9,
            updated_at = now()
      WHERE id = $1 AND organization_id = $2 AND user_id = $3
      RETURNING id, mail_account_id, to_recipients, cc_recipients, bcc_recipients,
                subject, body_html, created_at, updated_at`,
    [
      id,
      organizationId,
      userId,
      draft.mailAccountId,
      draft.to,
      draft.cc,
      draft.bcc,
      draft.subject,
      draft.bodyHtml,
    ]
  );
  return rows[0] ? rowToDraft(rows[0]) : null;
}

/**
 * @param {{ id: string, userId: string, organizationId: string }} p
 * @returns true si supprimé.
 */
export async function deleteDraft({ id, userId, organizationId }) {
  const { rowCount } = await pool.query(
    `DELETE FROM mail_drafts WHERE id = $1 AND organization_id = $2 AND user_id = $3`,
    [id, organizationId, userId]
  );
  return rowCount > 0;
}
