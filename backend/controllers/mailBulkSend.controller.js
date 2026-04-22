/**
 * Envoi email groupé depuis segment leads (filtres GET /api/leads + opt-in marketing + email présent)
 */

import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import { enqueueOutboundMail } from "../services/mail/mailOutbox.service.js";
import { canSendMailAccount } from "../services/mailAccess.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import { LEADS_LIST_FROM_JOINS, buildLeadsListFilterSql } from "../services/leadsListFilterSql.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

const MAX_BULK = 200;

function stripHtmlToText(html) {
  const s = String(html || "");
  return s
    .replace(/<style[^>]*>[\s\S]*?<\/style>/gi, "")
    .replace(/<script[^>]*>[\s\S]*?<\/script>/gi, "")
    .replace(/<[^>]+>/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * @param {import('express').Request} req
 */
async function resolveMailAccountId(req, preferred) {
  const uid = userId(req);
  const org = orgId(req);
  const isSuperAdmin = req.user.role === "SUPER_ADMIN";

  if (preferred && typeof preferred === "string" && preferred.trim()) {
    const id = preferred.trim();
    if (isSuperAdmin || (await canSendMailAccount({ userId: uid, organizationId: org, mailAccountId: id }))) {
      const chk = await pool.query(
        `SELECT id FROM mail_accounts WHERE id = $1 AND organization_id = $2 AND is_active = true`,
        [id, org]
      );
      if (chk.rows.length > 0) return id;
    }
    const err = new Error("Compte mail invalide ou envoi non autorisé");
    err.code = "MAIL_ACCOUNT_DENIED";
    throw err;
  }

  const r = await pool.query(
    `SELECT id FROM mail_accounts WHERE organization_id = $1 AND is_active = true ORDER BY created_at ASC`,
    [org]
  );
  for (const row of r.rows) {
    if (isSuperAdmin || (await canSendMailAccount({ userId: uid, organizationId: org, mailAccountId: row.id }))) {
      return row.id;
    }
  }
  const err = new Error("Aucun compte mail d’envoi disponible pour votre utilisateur");
  err.code = "NO_MAIL_ACCOUNT";
  throw err;
}

/**
 * POST /api/mail/bulk-send
 * Body: { filters, subject?, html?, preview?: boolean, mail_account_id?: string }
 */
export async function postBulkSend(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const body = req.body && typeof req.body === "object" ? req.body : {};
    const filters = body.filters && typeof body.filters === "object" ? body.filters : {};
    const preview = body.preview === true || body.preview === "true";
    const subject = String(body.subject ?? "").trim();
    const html = String(body.html ?? "").trim();
    const mailAccountPreferred = body.mail_account_id;

    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    const canReadAll = perms.has("lead.read.all");
    const canReadSelf = perms.has("lead.read.self");

    let whereResult;
    try {
      whereResult = buildLeadsListFilterSql(filters, org, uid, { canReadAll, canReadSelf });
    } catch (e) {
      if (e.statusCode === 400) {
        return res.status(400).json({ error: e.message, code: e.code });
      }
      throw e;
    }

    const { sql: whereSql, params: whereParams } = whereResult;

    const marketingAndEmail = ` AND l.marketing_opt_in = true
      AND l.email IS NOT NULL AND BTRIM(l.email) <> ''`;

    const listSql = `
      SELECT DISTINCT ON (lower(trim(l.email)))
        l.id, l.email, l.full_name
      ${LEADS_LIST_FROM_JOINS}
      ${whereSql}
      ${marketingAndEmail}
      ORDER BY lower(trim(l.email)), l.updated_at DESC NULLS LAST
      LIMIT ${MAX_BULK}
    `;

    const listR = await pool.query(listSql, whereParams);
    const rows = listR.rows;

    if (preview) {
      return res.json({
        success: true,
        preview: true,
        count: rows.length,
      });
    }

    if (!subject) {
      return res.status(400).json({ error: "subject requis", code: "SUBJECT_REQUIRED" });
    }
    if (!html) {
      return res.status(400).json({ error: "html requis", code: "HTML_REQUIRED" });
    }

    if (rows.length === 0) {
      return res.status(400).json({
        error: "Aucun destinataire éligible (opt-in marketing + email) pour ce segment",
        code: "NO_RECIPIENTS",
        count: 0,
      });
    }

    const mailAccountId = await resolveMailAccountId(req, mailAccountPreferred);
    const bodyText = stripHtmlToText(html) || "(voir version HTML)";
    const isSuperAdmin = req.user.role === "SUPER_ADMIN";

    let queued = 0;
    const errors = [];
    for (const row of rows) {
      const to = String(row.email).trim();
      if (!to) continue;
      try {
        await enqueueOutboundMail({
          userId: uid,
          organizationId: org,
          isSuperAdmin,
          body: {
            mail_account_id: mailAccountId,
            to,
            subject,
            bodyHtml: html,
            bodyText,
          },
        });
        queued += 1;
      } catch (e) {
        errors.push({ email: to, message: e?.message || String(e) });
      }
    }

    void logAuditEvent({
      action: AuditActions.BULK_EMAIL_SENT,
      entityType: "mail",
      organizationId: org,
      userId: uid,
      req,
      statusCode: 200,
      metadata: {
        recipient_count: queued,
        filters_snapshot: filters,
        subject,
        mail_account_id: mailAccountId,
        errors: errors.length ? errors.slice(0, 20) : undefined,
      },
    });

    return res.json({
      success: true,
      queued,
      total: rows.length,
      errors: errors.length ? errors : undefined,
    });
  } catch (e) {
    if (e?.code === "MAIL_ACCOUNT_DENIED" || e?.code === "NO_MAIL_ACCOUNT") {
      return res.status(400).json({ error: e.message, code: e.code });
    }
    console.error("postBulkSend", e);
    return res.status(500).json({ error: e?.message || "Erreur serveur" });
  }
}
