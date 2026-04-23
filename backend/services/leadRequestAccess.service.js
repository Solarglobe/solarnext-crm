/**
 * Vérité d'accès unique pour les routes lead / meters / consumption / activités (runtime uniquement).
 * Statuts : 404 si inconnu pour l'org, 403 si accès refusé ou lead archivé en écriture « métier ».
 * Aucun accès org-wide implicite : il faut explicitement lead.read.all/self ou lead.update.all/self
 * (sauf SUPER_ADMIN avec bypass, aligné sur rbac.middleware).
 */

import { getUserPermissions } from "../rbac/rbac.service.js";
import { effectiveSuperAdminRequestBypass } from "../lib/superAdminUserGuards.js";

const LOG_PREFIX = "[lead-access]";

/**
 * @param {string} context
 * @param {object} fields
 */
function accessLog(context, fields) {
  const parts = Object.entries(fields)
    .filter(([, v]) => v !== undefined && v !== null)
    .map(([k, v]) => `${k}=${v}`);
  console.log(`${LOG_PREFIX} ${context} ${parts.join(" ")}`);
}

/**
 * Ligne minimale pour décisions d'accès (pas de jointure).
 * @param {import("pg").Pool} pool
 * @param {string} leadId
 * @param {string} organizationId
 */
export async function fetchLeadAccessRow(pool, leadId, organizationId) {
  const r = await pool.query(
    `SELECT id, organization_id, archived_at, assigned_user_id
     FROM leads
     WHERE id = $1 AND organization_id = $2`,
    [leadId, organizationId]
  );
  return r.rows[0] ?? null;
}

/**
 * Comparaison UUID / id utilisateur tolérante (casse, espaces, tirets).
 * Alignée sur le filtre SQL `uuid = $text` côté listes leads.
 */
function idMatchesRowColumn(cell, userId) {
  if (cell == null || userId == null) return false;
  const a = String(cell).trim().toLowerCase();
  const b = String(userId).trim().toLowerCase();
  if (a === b) return true;
  const strip = (s) => s.replace(/-/g, "");
  const na = strip(a);
  const nb = strip(b);
  return na.length >= 32 && nb.length >= 32 && na === nb;
}

function assignedToUser(row, userId) {
  return idMatchesRowColumn(row.assigned_user_id, userId);
}

function isArchived(row) {
  return row.archived_at != null;
}

/**
 * SUPER_ADMIN avec bypass RBAC : accès complet aux leads de l’org (comme requirePermission).
 */
export function effectiveSuperAdminLeadBypass(req) {
  return !!effectiveSuperAdminRequestBypass(req);
}

/**
 * @param {import("express").Request | null | undefined} req
 * @param {Set<string>} perms
 */
export function hasEffectiveLeadReadScope(req, perms) {
  if (effectiveSuperAdminLeadBypass(req)) return true;
  return perms.has("lead.read.all") || perms.has("lead.read.self");
}

/**
 * @param {import("express").Request | null | undefined} req
 * @param {Set<string>} perms
 */
export function hasEffectiveLeadUpdateScope(req, perms) {
  if (effectiveSuperAdminLeadBypass(req)) return true;
  return perms.has("lead.update.all") || perms.has("lead.update.self");
}

/**
 * Filtres SQL `assigned_user_id` (PATCH lead, patch stage) : aligné sur assertLeadApiAccess write.
 * @param {Set<string>} perms
 */
export function leadUpdateFlagsForQuery(req, perms) {
  const sa = effectiveSuperAdminLeadBypass(req);
  return {
    canUpdateAll: sa || perms.has("lead.update.all"),
    canUpdateSelf: sa || perms.has("lead.update.self"),
  };
}

/**
 * Filtres listes leads (getAll, kanban, quickSearch) — alignés sur la lecture détail.
 * @param {Set<string>} perms
 */
export function leadReadFlagsForQuery(req, perms) {
  const sa = effectiveSuperAdminLeadBypass(req);
  return {
    readAll: sa || perms.has("lead.read.all"),
    readSelf: sa || perms.has("lead.read.self"),
  };
}

/**
 * @typedef {{ ok: true, lead: object }} LeadAccessOk
 * @typedef {{ ok: false, status: number, body: { error: string, code: string } }} LeadAccessFail
 */

/**
 * @param {import("pg").Pool} pool
 * @param {{
 *   leadId: string,
 *   organizationId: string,
 *   userId: string,
 *   mode: 'read' | 'write',
 *   forbidArchivedWrite?: boolean,
 *   logContext: string,
 *   req?: import("express").Request | null,
 * }} opts
 * @returns {Promise<LeadAccessOk | LeadAccessFail>}
 */
export async function assertLeadApiAccess(pool, opts) {
  const {
    leadId,
    organizationId,
    userId,
    mode,
    forbidArchivedWrite = false,
    logContext,
    req = null,
  } = opts;

  const lead = await fetchLeadAccessRow(pool, leadId, organizationId);
  if (!lead) {
    accessLog(logContext, {
      leadId,
      org: organizationId,
      user: userId,
      result: "NOT_FOUND",
    });
    return {
      ok: false,
      status: 404,
      body: {
        error: "Aucun lead ne correspond à cet identifiant pour votre organisation.",
        code: "LEAD_NOT_FOUND",
      },
    };
  }

  const perms = await getUserPermissions({ userId, organizationId });
  const readAll = effectiveSuperAdminLeadBypass(req) || perms.has("lead.read.all");
  const readSelf = effectiveSuperAdminLeadBypass(req) || perms.has("lead.read.self");
  const updateAll = effectiveSuperAdminLeadBypass(req) || perms.has("lead.update.all");
  const updateSelf = effectiveSuperAdminLeadBypass(req) || perms.has("lead.update.self");
  const assignedOk = assignedToUser(lead, userId);

  if (mode === "read") {
    if (readAll || (readSelf && assignedOk)) {
      accessLog(logContext, {
        leadId,
        user: userId,
        result: "OK_READ",
      });
      return { ok: true, lead };
    }
    accessLog(logContext, {
      leadId,
      user: userId,
      result: "FORBIDDEN_READ",
      readAll: readAll ? 1 : 0,
      readSelf: readSelf ? 1 : 0,
      assignedOk: assignedOk ? 1 : 0,
    });
    return {
      ok: false,
      status: 403,
      body: {
        error: "Vous n'avez pas l'autorisation de consulter ce dossier.",
        code: "LEAD_ACCESS_DENIED",
      },
    };
  }

  if (mode === "write") {
    const writeAllowed = updateAll || (updateSelf && assignedOk);

    if (!writeAllowed) {
      accessLog(logContext, {
        leadId,
        user: userId,
        result: "FORBIDDEN_WRITE",
        updateAll: updateAll ? 1 : 0,
        updateSelf: updateSelf ? 1 : 0,
        assignedOk: assignedOk ? 1 : 0,
      });
      return {
        ok: false,
        status: 403,
        body: {
          error: "Vous n'avez pas l'autorisation de modifier ce dossier.",
          code: "LEAD_ACCESS_DENIED",
        },
      };
    }
    if (forbidArchivedWrite && isArchived(lead)) {
      accessLog(logContext, { leadId, user: userId, result: "ARCHIVED_WRITE_BLOCKED" });
      return {
        ok: false,
        status: 403,
        body: {
          error:
            "Ce dossier est archivé : la consommation et les compteurs ne peuvent pas être modifiés.",
          code: "LEAD_ARCHIVED_READ_ONLY",
        },
      };
    }
    accessLog(logContext, {
      leadId,
      user: userId,
      result: "OK_WRITE",
    });
    return { ok: true, lead };
  }

  accessLog(logContext, { leadId, result: "INVALID_MODE" });
  return {
    ok: false,
    status: 400,
    body: { error: "Mode d'accès invalide", code: "INVALID_ACCESS_MODE" },
  };
}

/**
 * Réponse standard refus accès compteur (mauvais lead/meter).
 * @param {import("express").Response} res
 * @param {string} [meterId]
 */
export function respondMeterNotFound(res, meterId) {
  accessLog("meters", { meterId: meterId ?? "?", result: "METER_NOT_FOUND" });
  return res.status(404).json({
    error: "Ce compteur n'existe pas pour ce dossier.",
    code: "METER_NOT_FOUND",
  });
}
