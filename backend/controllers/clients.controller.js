/**
 * CP-026 — Clients controller
 * Logique métier : isolation org
 */

import { pool } from "../config/db.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import { assertOrgOwnership } from "../services/security/assertOrgOwnership.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import { effectiveSuperAdminRequestBypass } from "../lib/superAdminUserGuards.js";
import { archiveEntity, restoreEntity } from "../services/archive.service.js";
import {
  assertClientApiAccess,
  clientReadFlagsForQuery,
  clientUpdateFlagsForQuery,
  hasEffectiveClientReadScope,
  hasEffectiveClientUpdateScope,
  sqlClientInSelfPortfolio,
} from "../services/clientRequestAccess.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

function parseIsoDateOnly(s) {
  if (!s || typeof s !== "string") return null;
  const t = s.trim();
  if (!t) return null;
  const m = t.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  return `${m[1]}-${m[2]}-${m[3]}`;
}

function parseQueryBool(v) {
  if (v === undefined || v === null || v === "") return undefined;
  const s = String(v).toLowerCase().trim();
  if (s === "true" || s === "1") return true;
  if (s === "false" || s === "0") return false;
  return undefined;
}

export async function getAll(req, res) {
  try {
    const org = orgId(req);
    const { created_from, created_to, marketing_opt_in } = req.query;

    const parts = [`organization_id = $1`, `(archived_at IS NULL)`];
    const params = [org];
    let idx = 2;

    const cf = parseIsoDateOnly(created_from);
    const ct = parseIsoDateOnly(created_to);
    if (cf) {
      parts.push(`created_at::date >= $${idx++}::date`);
      params.push(cf);
    }
    if (ct) {
      parts.push(`created_at::date <= $${idx++}::date`);
      params.push(ct);
    }

    const mo = parseQueryBool(marketing_opt_in);
    if (mo === true) {
      parts.push(`marketing_opt_in = true`);
    } else if (mo === false) {
      parts.push(`marketing_opt_in = false`);
    }

    const whereSql = parts.join(" AND ");
    const result = await pool.query(
      `SELECT * FROM clients WHERE ${whereSql} ORDER BY updated_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** GET ?q= — autocomplétion légère (mail, filtres CRM). */
export async function quickSearch(req, res) {
  try {
    const org = orgId(req);
    const q = String(req.query.q ?? "").trim();
    if (q.length < 2) {
      return res.json({ items: [] });
    }
    const esc = q.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
    const pat = `%${esc}%`;
    const result = await pool.query(
      `SELECT id,
        COALESCE(
          NULLIF(TRIM(company_name), ''),
          NULLIF(TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')), ''),
          NULLIF(TRIM(email), '')
        ) AS label,
        email
       FROM clients
       WHERE organization_id = $1 AND archived_at IS NULL
         AND (
           company_name ILIKE $2 ESCAPE '!'
           OR email ILIKE $2 ESCAPE '!'
           OR TRIM(COALESCE(first_name, '') || ' ' || COALESCE(last_name, '')) ILIKE $2 ESCAPE '!'
         )
       ORDER BY updated_at DESC
       LIMIT 20`,
      [org, pat]
    );
    res.json({ items: result.rows });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /clients/me — « Mes clients » : clients dont au moins un lead (même org) a
 * `assigned_user_id` = utilisateur courant (cohérent avec lead.read.self).
 * Pas une copie de GET / (liste org complète).
 */
export async function getSelf(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { created_from, created_to, marketing_opt_in } = req.query;

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org,
    });
    if (!hasEffectiveClientReadScope(req, perms)) {
      return res.status(403).json({
        error: "Vous n'avez pas l'autorisation de consulter les clients.",
        code: "CLIENT_ACCESS_DENIED",
      });
    }

    const parts = [`c.organization_id = $1`, `(c.archived_at IS NULL)`, sqlClientInSelfPortfolio("c", 2)];
    const params = [org, uid];
    let idx = 3;

    const cf = parseIsoDateOnly(created_from);
    const ct = parseIsoDateOnly(created_to);
    if (cf) {
      parts.push(`c.created_at::date >= $${idx++}::date`);
      params.push(cf);
    }
    if (ct) {
      parts.push(`c.created_at::date <= $${idx++}::date`);
      params.push(ct);
    }

    const mo = parseQueryBool(marketing_opt_in);
    if (mo === true) {
      parts.push(`c.marketing_opt_in = true`);
    } else if (mo === false) {
      parts.push(`c.marketing_opt_in = false`);
    }

    const whereSql = parts.join(" AND ");
    const result = await pool.query(
      `SELECT c.* FROM clients c WHERE ${whereSql} ORDER BY c.updated_at DESC`,
      params
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

export async function getById(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org,
    });
    if (!hasEffectiveClientReadScope(req, perms)) {
      return res.status(403).json({
        error: "Vous n'avez pas l'autorisation de consulter ce client.",
        code: "CLIENT_ACCESS_DENIED",
      });
    }
    const { readAll: canReadAll, readSelf: canReadSelf } = clientReadFlagsForQuery(req, perms);

    let query =
      "SELECT * FROM clients c WHERE c.id = $1 AND c.organization_id = $2 AND (c.archived_at IS NULL)";
    const params = [id, org];
    if (canReadSelf && !canReadAll) {
      query += ` AND ${sqlClientInSelfPortfolio("c", 3)}`;
      params.push(uid);
    }

    const result = await pool.query(query, params);
    if (result.rows.length === 0) return res.status(404).json({ error: "Client non trouvé" });
    assertOrgOwnership(result.rows[0].organization_id, org);
    res.json(result.rows[0]);
  } catch (e) {
    const code = e?.statusCode;
    if (code === 403) return res.status(403).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
}

export async function update(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;
    const body = req.body;

    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    if (!hasEffectiveClientUpdateScope(req, perms)) {
      return res.status(403).json({
        error: "Vous n'avez pas l'autorisation de modifier ce client.",
        code: "CLIENT_ACCESS_DENIED",
      });
    }
    const { canUpdateAll, canUpdateSelf } = clientUpdateFlagsForQuery(req, perms);

    if (body.marketing_opt_in !== undefined || body.rgpd_consent !== undefined) {
      const superOk = effectiveSuperAdminRequestBypass(req);
      const canConsent =
        superOk ||
        perms.has("org.settings.manage") ||
        perms.has("client.update.all") ||
        perms.has("client.update.self");
      if (!canConsent) {
        return res.status(403).json({
          error: "Modification des consentements non autorisée",
          code: "CLIENT_CONSENT_FORBIDDEN",
        });
      }
    }

    const allowed = [
      "company_name", "first_name", "last_name", "email", "phone", "mobile",
      "address_line_1", "address_line_2", "postal_code", "city", "country",
      "installation_address_line_1", "installation_postal_code", "installation_city",
      "notes",
      "birth_date",
    ];
    const updates = [];
    const values = [];
    let idx = 1;
    for (const k of allowed) {
      if (body[k] !== undefined) {
        updates.push(`${k} = $${idx++}`);
        values.push(body[k]);
      }
    }
    if (body.rgpd_consent !== undefined) {
      const on = !!body.rgpd_consent;
      updates.push(`rgpd_consent = $${idx++}`);
      values.push(on);
      updates.push(`rgpd_consent_at = $${idx++}`);
      values.push(on ? new Date() : null);
    }
    if (body.marketing_opt_in !== undefined) {
      const on = !!body.marketing_opt_in;
      updates.push(`marketing_opt_in = $${idx++}`);
      values.push(on);
      updates.push(`marketing_opt_in_at = $${idx++}`);
      values.push(on ? new Date() : null);
    }
    if (updates.length === 0) {
      let sel = "SELECT * FROM clients c WHERE c.id = $1 AND c.organization_id = $2 AND (c.archived_at IS NULL)";
      const selParams = [id, org];
      if (canUpdateSelf && !canUpdateAll) {
        sel += ` AND ${sqlClientInSelfPortfolio("c", 3)}`;
        selParams.push(uid);
      }
      const r = await pool.query(sel, selParams);
      if (r.rows.length === 0) return res.status(404).json({ error: "Client non trouvé" });
      assertOrgOwnership(r.rows[0].organization_id, org);
      return res.json(r.rows[0]);
    }
    const idPh = idx;
    const orgPh = idx + 1;
    values.push(id, org);
    let whereSql = `WHERE id = $${idPh} AND organization_id = $${orgPh} AND (archived_at IS NULL)`;
    if (canUpdateSelf && !canUpdateAll) {
      const uidPh = idx + 2;
      whereSql += ` AND ${sqlClientInSelfPortfolio("clients", uidPh)}`;
      values.push(uid);
    }
    const query = `UPDATE clients SET updated_at = now(), ${updates.join(", ")} ${whereSql} RETURNING *`;
    const result = await pool.query(query, values);
    if (result.rows.length === 0) return res.status(404).json({ error: "Client non trouvé" });
    const row = result.rows[0];
    assertOrgOwnership(row.organization_id, org);
    const changedFields = [
      ...allowed.filter((k) => body[k] !== undefined),
      ...(body.rgpd_consent !== undefined ? ["rgpd_consent"] : []),
      ...(body.marketing_opt_in !== undefined ? ["marketing_opt_in"] : []),
    ];
    void logAuditEvent({
      action: AuditActions.CLIENT_UPDATED,
      entityType: "client",
      entityId: id,
      organizationId: org,
      userId: uid,
      targetLabel: row.client_number || row.email || undefined,
      req,
      statusCode: 200,
      metadata: { changed_fields: changedFields },
    });
    if (body.marketing_opt_in !== undefined) {
      void logAuditEvent({
        action: AuditActions.CLIENT_MARKETING_OPT_IN_UPDATED,
        entityType: "client",
        entityId: id,
        organizationId: org,
        userId: uid,
        targetLabel: row.client_number || row.email || undefined,
        req,
        statusCode: 200,
        metadata: { marketing_opt_in: !!row.marketing_opt_in },
      });
    }
    res.json(row);
  } catch (e) {
    const code = e?.statusCode;
    if (code === 403) return res.status(403).json({ error: e.message, code: e.code });
    res.status(500).json({ error: e.message });
  }
}

/** PATCH archive — après garde périmètre client (self = lien lead assigné). */
export async function patchArchive(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;
    const access = await assertClientApiAccess(pool, {
      clientId: id,
      organizationId: org,
      userId: uid,
      mode: "write",
      logContext: "clients.patchArchive",
      req,
    });
    if (!access.ok) return res.status(access.status).json(access.body);
    const data = await archiveEntity("clients", id, org, uid);
    if (!data) return res.status(404).json({ error: "Client non trouvé" });
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/** PATCH restore — client archivé, même règle self / all. */
export async function patchRestore(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id } = req.params;
    const access = await assertClientApiAccess(pool, {
      clientId: id,
      organizationId: org,
      userId: uid,
      mode: "write",
      logContext: "clients.patchRestore",
      req,
    });
    if (!access.ok) return res.status(access.status).json(access.body);
    const data = await restoreEntity("clients", id, org);
    if (!data) return res.status(404).json({ error: "Client non trouvé" });
    res.json(data);
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}
