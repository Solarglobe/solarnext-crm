/**
 * Super admin — liste, archivage, suppression sûre des organisations.
 */
import { pool } from "../../config/db.js";

export const ORG_NAME_SOLAR_GLOBE = "SolarGlobe";

function uuidOk(id) {
  return (
    typeof id === "string" &&
    /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(id)
  );
}

function slugifyName(name) {
  return String(name || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");
}

/**
 * @param {object} opts
 * @param {boolean} [opts.includeArchived]
 * @returns {Promise<Array<{ id: string, name: string, slug: string, created_at: string|null, leads_count: number, clients_count: number, is_archived: boolean, archived_at: string|null }>>}
 */
export async function listSuperAdminOrganizations({ includeArchived = false } = {}) {
  const where = includeArchived
    ? ""
    : " WHERE COALESCE(o.is_archived, false) = false ";
  const r = await pool.query(
    `
    SELECT o.id,
           o.name,
           o.created_at,
           o.is_archived,
           o.archived_at,
           (SELECT COUNT(*)::int FROM leads l
             WHERE l.organization_id = o.id
               AND l.status <> 'CLIENT'
               AND l.archived_at IS NULL) AS leads_count,
           (SELECT COUNT(*)::int FROM leads l
             WHERE l.organization_id = o.id
               AND l.status = 'CLIENT'
               AND l.archived_at IS NULL) AS clients_count
    FROM organizations o
    ${where}
    ORDER BY o.name ASC
  `
  );
  return r.rows.map((row) => ({
    id: row.id,
    name: row.name,
    slug: slugifyName(row.name),
    created_at: row.created_at,
    leads_count: row.leads_count ?? 0,
    clients_count: row.clients_count ?? 0,
    is_archived: Boolean(row.is_archived),
    archived_at: row.archived_at,
  }));
}

export function assertNotSolarGlobeName(name) {
  if (String(name || "").trim() === ORG_NAME_SOLAR_GLOBE) {
    const err = new Error("L’organisation SolarGlobe ne peut pas être supprimée ni archivée de cette manière");
    err.statusCode = 400;
    err.code = "ORG_PROTECTED_SOLAR_GLOBE";
    throw err;
  }
}

/**
 * @param {string} jwtOrgId
 * @param {string} targetId
 */
export function assertNotJwtHomeOrg(jwtOrgId, targetId) {
  if (jwtOrgId && String(jwtOrgId) === String(targetId)) {
    const err = new Error(
      "Impossible de supprimer ou d’archiver l’organisation principale de votre compte (JWT)"
    );
    err.statusCode = 400;
    err.code = "ORG_PROTECTED_JWT_HOME";
    throw err;
  }
}

/**
 * @param {string} organizationId
 * @param {string} [jwtOrgId] — org « maison » du token (jamais l’org effective x-organization-id)
 */
export async function archiveOrganization(organizationId, jwtOrgId) {
  if (!uuidOk(organizationId)) {
    const err = new Error("ID organisation invalide");
    err.statusCode = 400;
    throw err;
  }
  assertNotJwtHomeOrg(jwtOrgId, organizationId);

  const r = await pool.query(`SELECT id, name FROM organizations WHERE id = $1`, [organizationId]);
  if (r.rows.length === 0) {
    const err = new Error("Organisation introuvable");
    err.statusCode = 404;
    throw err;
  }
  const row = r.rows[0];
  assertNotSolarGlobeName(row.name);

  await pool.query(
    `UPDATE organizations SET is_archived = true, archived_at = now() WHERE id = $1`,
    [organizationId]
  );
  return { id: row.id, name: row.name };
}

/**
 * @param {string} organizationId
 */
export async function restoreOrganization(organizationId) {
  if (!uuidOk(organizationId)) {
    const err = new Error("ID organisation invalide");
    err.statusCode = 400;
    throw err;
  }
  const r = await pool.query(
    `UPDATE organizations SET is_archived = false, archived_at = NULL
     WHERE id = $1
     RETURNING id, name`,
    [organizationId]
  );
  if (r.rows.length === 0) {
    const err = new Error("Organisation introuvable");
    err.statusCode = 404;
    throw err;
  }
  return r.rows[0];
}

/**
 * Vérifie absence de factures, paiements, clients actifs ; puis supprime l’org.
 * @param {string} organizationId
 * @param {string} [jwtOrgId]
 */
export async function deleteOrganizationSafe(organizationId, jwtOrgId) {
  if (!uuidOk(organizationId)) {
    const err = new Error("ID organisation invalide");
    err.statusCode = 400;
    throw err;
  }
  assertNotJwtHomeOrg(jwtOrgId, organizationId);

  const o = await pool.query(`SELECT id, name FROM organizations WHERE id = $1`, [organizationId]);
  if (o.rows.length === 0) {
    const err = new Error("Organisation introuvable");
    err.statusCode = 404;
    throw err;
  }
  const org = o.rows[0];
  assertNotSolarGlobeName(org.name);

  const c = await pool.query(
    `
    SELECT
      (SELECT COUNT(*)::int FROM invoices i WHERE i.organization_id = $1) AS inv,
      (SELECT COUNT(*)::int FROM payments p WHERE p.organization_id = $1) AS pay,
      (SELECT COUNT(*)::int FROM leads l
        WHERE l.organization_id = $1
          AND l.status = 'CLIENT'
          AND l.archived_at IS NULL) AS clients
  `,
    [organizationId]
  );
  const { inv, pay, clients } = c.rows[0];
  if (inv > 0 || pay > 0 || clients > 0) {
    const parts = [];
    if (inv > 0) parts.push(`${inv} facture(s)`);
    if (pay > 0) parts.push(`${pay} paiement(s)`);
    if (clients > 0) parts.push(`${clients} client(s) actif(s)`);
    const err = new Error(
      `Suppression refusée : l’organisation contient encore ${parts.join(", ")}. ` +
        `Videz ou transférez ces données avant de supprimer.`
    );
    err.statusCode = 400;
    err.code = "ORG_DELETE_CONFLICT";
    err.details = { invoices: inv, payments: pay, active_clients: clients };
    throw err;
  }

  const del = await pool.query(`DELETE FROM organizations WHERE id = $1 RETURNING id, name`, [
    organizationId,
  ]);
  if (del.rows.length === 0) {
    const err = new Error("Suppression impossible");
    err.statusCode = 500;
    throw err;
  }
  return del.rows[0];
}
