/**
 * Recherche globale CRM — leads + clients (dossiers leads status LEAD / CLIENT)
 */

import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import { hasEffectiveLeadReadScope, leadReadFlagsForQuery } from "../services/leadRequestAccess.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function globalSearch(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const raw = String(req.query.q ?? "").trim();
    if (raw.length < 2) {
      return res.json([]);
    }

    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org,
    });
    if (!hasEffectiveLeadReadScope(req, perms)) {
      return res.status(403).json({
        error: "Vous n'avez pas l'autorisation de consulter les dossiers.",
        code: "LEAD_ACCESS_DENIED",
      });
    }
    const { readAll: canReadAll, readSelf: canReadSelf } = leadReadFlagsForQuery(req, perms);

    const esc = raw.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
    const pat = `%${esc}%`;

    let sql = `
      SELECT
        l.id,
        CASE WHEN l.status = 'CLIENT' THEN 'client' ELSE 'lead' END AS type,
        COALESCE(
          NULLIF(TRIM(l.full_name), ''),
          NULLIF(TRIM(CONCAT_WS(' ', c.first_name, c.last_name)), ''),
          NULLIF(TRIM(c.company_name), ''),
          NULLIF(TRIM(l.company_name), ''),
          NULLIF(TRIM(l.email), ''),
          NULLIF(TRIM(c.email), ''),
          'Sans nom'
        ) AS full_name,
        COALESCE(NULLIF(TRIM(l.email), ''), NULLIF(TRIM(c.email), '')) AS email,
        COALESCE(
          NULLIF(TRIM(l.phone), ''),
          NULLIF(TRIM(l.phone_mobile), ''),
          NULLIF(TRIM(l.phone_landline), ''),
          NULLIF(TRIM(c.phone), ''),
          NULLIF(TRIM(c.mobile), '')
        ) AS phone,
        l.status::text AS status
      FROM leads l
      LEFT JOIN clients c ON c.id = l.client_id AND c.organization_id = l.organization_id
      WHERE l.organization_id = $1
        AND l.archived_at IS NULL
        AND l.status IN ('LEAD', 'CLIENT')
        AND (
          l.email ILIKE $2 ESCAPE '!'
          OR l.phone ILIKE $2 ESCAPE '!'
          OR l.phone_mobile ILIKE $2 ESCAPE '!'
          OR l.phone_landline ILIKE $2 ESCAPE '!'
          OR l.first_name ILIKE $2 ESCAPE '!'
          OR l.last_name ILIKE $2 ESCAPE '!'
          OR l.full_name ILIKE $2 ESCAPE '!'
          OR l.company_name ILIKE $2 ESCAPE '!'
          OR c.email ILIKE $2 ESCAPE '!'
          OR c.phone ILIKE $2 ESCAPE '!'
          OR c.mobile ILIKE $2 ESCAPE '!'
          OR c.first_name ILIKE $2 ESCAPE '!'
          OR c.last_name ILIKE $2 ESCAPE '!'
          OR c.company_name ILIKE $2 ESCAPE '!'
        )
    `;
    const params = [org, pat];
    let idx = 3;
    if (canReadSelf && !canReadAll) {
      sql += ` AND l.assigned_user_id = $${idx++}`;
      params.push(uid);
    }
    sql += ` ORDER BY l.updated_at DESC NULLS LAST LIMIT 20`;

    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
