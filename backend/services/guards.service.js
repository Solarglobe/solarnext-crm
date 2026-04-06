/**
 * CP-032C — Guards d'intégrité standardisés
 * assertOrgEntity, assertStatus, assertSameOrg
 */

const ALLOWED_TABLES = new Set([
  "leads",
  "clients",
  "studies",
  "quotes",
  "entity_documents",
  "invoices"
]);

function createNotFoundError() {
  const err = new Error("Non trouvé");
  err.statusCode = 404;
  return err;
}

function createForbiddenError(msg = "Action interdite") {
  const err = new Error(msg);
  err.statusCode = 403;
  return err;
}

function createBadRequestError(msg = "Requête invalide") {
  const err = new Error(msg);
  err.statusCode = 400;
  return err;
}

/**
 * Vérifie qu'une entité existe, appartient à l'org, et n'est pas archivée (sauf si allowArchived)
 * @param {object} client - Client pg
 * @param {string} table - Nom de table (whitelist)
 * @param {string} id - UUID
 * @param {string} orgId - UUID organisation
 * @param {{ allowArchived?: boolean }} opts
 * @returns {Promise<object>} row
 */
export async function assertOrgEntity(client, table, id, orgId, opts = {}) {
  if (!ALLOWED_TABLES.has(table)) {
    throw createBadRequestError("Table invalide");
  }
  const cols = ["id", "organization_id", "archived_at"];
  if (table === "studies") cols.push("deleted_at");
  if (table === "leads") cols.push("status", "assigned_to", "stage_id");
  if (table === "quotes") cols.push("status");
  if (table === "invoices") cols.push("status", "client_id", "quote_id", "total_paid", "total_credited", "total_ttc", "amount_due");
  let whereClause = "id = $1";
  if (table === "studies") whereClause += " AND (deleted_at IS NULL)";
  const res = await client.query(
    `SELECT ${cols.join(", ")} FROM ${table} WHERE ${whereClause}`,
    [id]
  );
  if (res.rows.length === 0) {
    throw createNotFoundError();
  }
  const row = res.rows[0];
  if (row.organization_id !== orgId) {
    throw createNotFoundError();
  }
  if (row.archived_at != null && opts.allowArchived !== true) {
    throw createNotFoundError();
  }
  if (table === "studies" && row.deleted_at != null) {
    throw createNotFoundError();
  }
  return row;
}

/**
 * Vérifie que row.status est dans allowedStatuses
 * @param {object} row - Row avec champ status
 * @param {string[]} allowedStatuses
 */
export function assertStatus(row, allowedStatuses) {
  const status = row?.status;
  if (!status || !allowedStatuses.includes(status)) {
    throw createForbiddenError(`Statut invalide ou action interdite (statut: ${status || "?"})`);
  }
}

/**
 * Vérifie que l'entité existe et appartient à l'org (simple check)
 * @param {object} client
 * @param {string} table
 * @param {string} id
 * @param {string} orgId
 */
export async function assertSameOrg(client, table, id, orgId) {
  if (!ALLOWED_TABLES.has(table)) {
    throw createBadRequestError("Table invalide");
  }
  const res = await client.query(
    `SELECT id FROM ${table} WHERE id = $1 AND organization_id = $2`,
    [id, orgId]
  );
  if (res.rows.length === 0) {
    throw createBadRequestError("Entité non trouvée ou n'appartient pas à l'organisation");
  }
}
