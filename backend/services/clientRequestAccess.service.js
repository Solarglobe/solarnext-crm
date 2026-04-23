/**
 * Vérité d'accès clients : périmètre `client.*.self` = client lié à au moins un lead
 * dont l'utilisateur courant est le commercial assigné (`leads.assigned_user_id`),
 * aligné sur la sémantique `lead.read.self` / `lead.update.self`.
 * Aucun accès org-wide implicite : il faut `client.read.all|self` ou `client.update.all|self`
 * (sauf SUPER_ADMIN avec bypass RBAC, comme pour les leads).
 */

import { getUserPermissions } from "../rbac/rbac.service.js";
import { effectiveSuperAdminRequestBypass } from "../lib/superAdminUserGuards.js";

const LOG_PREFIX = "[client-access]";

function accessLog(context, fields) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);
  console.log(`${LOG_PREFIX} ${context} ${parts.join(" ")}`);
}

export function effectiveSuperAdminClientBypass(req) {
  return !!effectiveSuperAdminRequestBypass(req);
}

/**
 * @param {import("express").Request | null | undefined} req
 * @param {Set<string>} perms
 */
export function hasEffectiveClientReadScope(req, perms) {
  if (effectiveSuperAdminClientBypass(req)) return true;
  return perms.has("client.read.all") || perms.has("client.read.self");
}

/**
 * @param {import("express").Request | null | undefined} req
 * @param {Set<string>} perms
 */
export function hasEffectiveClientUpdateScope(req, perms) {
  if (effectiveSuperAdminClientBypass(req)) return true;
  return perms.has("client.update.all") || perms.has("client.update.self");
}

/**
 * @param {import("express").Request | null | undefined} req
 * @param {Set<string>} perms
 */
export function clientReadFlagsForQuery(req, perms) {
  const sa = effectiveSuperAdminClientBypass(req);
  return {
    readAll: sa || perms.has("client.read.all"),
    readSelf: sa || perms.has("client.read.self"),
  };
}

/**
 * @param {import("express").Request | null | undefined} req
 * @param {Set<string>} perms
 */
export function clientUpdateFlagsForQuery(req, perms) {
  const sa = effectiveSuperAdminClientBypass(req);
  return {
    canUpdateAll: sa || perms.has("client.update.all"),
    canUpdateSelf: sa || perms.has("client.update.self"),
  };
}

/**
 * SQL: le client a au moins un lead dans l'org avec ce client et ce commercial assigné.
 * @param {string} clientAlias alias table clients (ex: `c`)
 * @param {number} userParamIndex index du paramètre UUID utilisateur ($3, etc.)
 */
export function sqlClientInSelfPortfolio(clientAlias, userParamIndex) {
  return `EXISTS (
    SELECT 1 FROM leads l
    WHERE l.organization_id = ${clientAlias}.organization_id
      AND l.client_id = ${clientAlias}.id
      AND l.assigned_user_id = $${userParamIndex}
  )`;
}

/**
 * @param {import("pg").Pool} pool
 * @param {string} organizationId
 * @param {string} clientId
 * @param {string} userId
 */
export async function clientLinkedToAssignedLead(pool, organizationId, clientId, userId) {
  const r = await pool.query(
    `SELECT 1 AS ok
     FROM leads l
     WHERE l.organization_id = $1
       AND l.client_id = $2
       AND l.assigned_user_id = $3
     LIMIT 1`,
    [organizationId, clientId, userId]
  );
  return r.rows.length > 0;
}

/**
 * @param {import("pg").Pool} pool
 * @param {{
 *   clientId: string,
 *   organizationId: string,
 *   userId: string,
 *   mode: "read" | "write",
 *   logContext: string,
 *   req?: import("express").Request | null,
 * }} opts
 * @returns {Promise<{ ok: true } | { ok: false, status: number, body: { error: string, code: string } }>}
 */
export async function assertClientApiAccess(pool, opts) {
  const { clientId, organizationId, userId, mode, logContext, req = null } = opts;

  const perms = await getUserPermissions({ userId, organizationId });
  const readAll = effectiveSuperAdminClientBypass(req) || perms.has("client.read.all");
  const readSelf = effectiveSuperAdminClientBypass(req) || perms.has("client.read.self");
  const updateAll = effectiveSuperAdminClientBypass(req) || perms.has("client.update.all");
  const updateSelf = effectiveSuperAdminClientBypass(req) || perms.has("client.update.self");

  const inPortfolio = await clientLinkedToAssignedLead(pool, organizationId, clientId, userId);

  if (mode === "read") {
    if (readAll || (readSelf && inPortfolio)) {
      accessLog(logContext, { clientId, user: userId, result: "OK_READ" });
      return { ok: true };
    }
    accessLog(logContext, {
      clientId,
      user: userId,
      result: "FORBIDDEN_READ",
      inPortfolio: inPortfolio ? 1 : 0,
    });
    return {
      ok: false,
      status: 403,
      body: {
        error: "Vous n'avez pas l'autorisation de consulter ce client.",
        code: "CLIENT_ACCESS_DENIED",
      },
    };
  }

  if (mode === "write") {
    if (updateAll || (updateSelf && inPortfolio)) {
      accessLog(logContext, { clientId, user: userId, result: "OK_WRITE" });
      return { ok: true };
    }
    accessLog(logContext, {
      clientId,
      user: userId,
      result: "FORBIDDEN_WRITE",
      inPortfolio: inPortfolio ? 1 : 0,
    });
    return {
      ok: false,
      status: 403,
      body: {
        error: "Vous n'avez pas l'autorisation de modifier ce client.",
        code: "CLIENT_ACCESS_DENIED",
      },
    };
  }

  accessLog(logContext, { clientId, result: "INVALID_MODE" });
  return {
    ok: false,
    status: 400,
    body: { error: "Mode d'accès invalide", code: "INVALID_ACCESS_MODE" },
  };
}
