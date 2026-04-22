/**
 * CP-MAIRIES-002 — Accès SQL mairies (périmètre organization_id imposé par l’appelant).
 * CP-MAIRIES-HARDENING — pas de logique métier ici ; évolutions futures possibles :
 * filtres par `insee_code`, tri par pertinence, index pg_trgm pour recherche tolérante.
 */

import { pool } from "../../config/db.js";

const LIST_SELECT = `
  SELECT
    m.id,
    m.name,
    m.postal_code,
    m.city,
    m.portal_url,
    m.portal_type,
    m.account_status,
    m.account_email,
    m.bitwarden_ref,
    m.notes,
    m.last_used_at,
    m.created_at,
    m.updated_at,
    (SELECT COUNT(*)::int FROM leads l
     WHERE l.organization_id = m.organization_id AND l.mairie_id = m.id) AS linked_leads_count
  FROM mairies m
`;

const SORT_MAP = {
  name: "m.name",
  postal_code: "m.postal_code",
  created_at: "m.created_at",
  updated_at: "m.updated_at",
  last_used_at: "m.last_used_at",
};

/**
 * @param {object} q
 * @param {string} q.organizationId
 * @param {Record<string, string | undefined>} q.query — req.query
 */
export async function listMairies({ organizationId, query }) {
  const rawPage = query.page;
  const rawLimit = query.limit;
  const pageNum = Math.max(1, parseInt(String(rawPage ?? "1"), 10) || 1);
  const limitNum = Math.min(100, Math.max(1, parseInt(String(rawLimit ?? "50"), 10) || 50));
  const offset = (pageNum - 1) * limitNum;

  const sortKey = String(query.sort || "name").toLowerCase();
  const orderRaw = String(query.order || "asc").toLowerCase();
  const order = orderRaw === "desc" ? "DESC" : "ASC";
  const sortCol = SORT_MAP[sortKey] || SORT_MAP.name;

  const conditions = ["m.organization_id = $1"];
  const params = [organizationId];
  let idx = 2;

  const qText = String(query.q ?? "").trim();
  if (qText.length >= 1) {
    const esc = qText.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
    const pat = `%${esc}%`;
    conditions.push(
      `(m.name ILIKE $${idx} ESCAPE '!' OR m.city ILIKE $${idx} ESCAPE '!' OR m.postal_code ILIKE $${idx} ESCAPE '!')`
    );
    params.push(pat);
    idx++;
  }

  const st = String(query.account_status ?? "").trim();
  if (st) {
    conditions.push(`m.account_status = $${idx}`);
    params.push(st);
    idx++;
  }

  const pt = String(query.portal_type ?? "").trim();
  if (pt) {
    conditions.push(`m.portal_type = $${idx}`);
    params.push(pt);
    idx++;
  }

  const pc = String(query.postal_code ?? "").trim();
  if (pc) {
    conditions.push(`m.postal_code = $${idx}`);
    params.push(pc);
    idx++;
  }

  const city = String(query.city ?? "").trim();
  if (city) {
    const esc = city.replace(/!/g, "!!").replace(/%/g, "!%").replace(/_/g, "!_");
    const pat = `%${esc}%`;
    conditions.push(`m.city ILIKE $${idx} ESCAPE '!'`);
    params.push(pat);
    idx++;
  }

  const whereSql = `WHERE ${conditions.join(" AND ")}`;

  const countRes = await pool.query(
    `SELECT COUNT(*)::int AS n FROM mairies m ${whereSql}`,
    params
  );
  const total = countRes.rows[0]?.n ?? 0;

  const limitIdx = idx;
  const offsetIdx = idx + 1;
  const dataSql = `${LIST_SELECT} ${whereSql} ORDER BY ${sortCol} ${order} NULLS LAST, m.id ASC LIMIT $${limitIdx} OFFSET $${offsetIdx}`;
  params.push(limitNum, offset);

  const dataRes = await pool.query(dataSql, params);

  return {
    items: dataRes.rows,
    page: pageNum,
    limit: limitNum,
    total,
  };
}

/**
 * @param {string} organizationId
 * @param {string} id
 */
export async function getMairieById(organizationId, id) {
  const r = await pool.query(
    `${LIST_SELECT} WHERE m.organization_id = $1 AND m.id = $2`,
    [organizationId, id]
  );
  return r.rows[0] ?? null;
}

/**
 * @param {string} organizationId
 * @param {object} data — champs validés
 */
export async function insertMairie(organizationId, data) {
  const r = await pool.query(
    `INSERT INTO mairies (
      organization_id, name, postal_code, city, portal_url, portal_type,
      account_status, account_email, bitwarden_ref, notes, last_used_at
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
    RETURNING
      id, name, postal_code, city, portal_url, portal_type, account_status,
      account_email, bitwarden_ref, notes, last_used_at, created_at, updated_at`,
    [
      organizationId,
      data.name,
      data.postal_code,
      data.city,
      data.portal_url,
      data.portal_type,
      data.account_status,
      data.account_email,
      data.bitwarden_ref,
      data.notes,
      data.last_used_at,
    ]
  );
  const row = r.rows[0];
  row.linked_leads_count = 0;
  return row;
}

/**
 * @param {string} organizationId
 * @param {string} id
 * @param {object} patch
 */
export async function updateMairie(organizationId, id, patch) {
  const keys = Object.keys(patch);
  if (keys.length === 0) return null;

  const sets = [];
  const vals = [organizationId, id];
  let i = 3;
  for (const k of keys) {
    sets.push(`${k} = $${i}`);
    vals.push(patch[k]);
    i++;
  }
  sets.push(`updated_at = now()`);

  const r = await pool.query(
    `UPDATE mairies SET ${sets.join(", ")}
     WHERE organization_id = $1 AND id = $2
     RETURNING
      id, name, postal_code, city, portal_url, portal_type, account_status,
      account_email, bitwarden_ref, notes, last_used_at, created_at, updated_at`,
    vals
  );
  if (r.rows.length === 0) return null;
  const row = r.rows[0];
  const c = await pool.query(
    `SELECT COUNT(*)::int AS n FROM leads WHERE organization_id = $1 AND mairie_id = $2`,
    [organizationId, id]
  );
  row.linked_leads_count = c.rows[0]?.n ?? 0;
  return row;
}

/**
 * @param {string} organizationId
 * @param {string} id
 * @returns {Promise<boolean>} true si une ligne supprimée
 */
export async function deleteMairie(organizationId, id) {
  const r = await pool.query(
    `DELETE FROM mairies WHERE organization_id = $1 AND id = $2`,
    [organizationId, id]
  );
  return (r.rowCount ?? 0) > 0;
}
