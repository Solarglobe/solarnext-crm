/**
 * Vérité d'accès unique pour les routes lead / meters / consumption (runtime uniquement).
 * Statuts : 404 si inconnu pour l'org, 403 si accès refusé ou lead archivé en écriture « métier ».
 */

import { getUserPermissions } from "../rbac/rbac.service.js";

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
    `SELECT id, organization_id, archived_at, assigned_to, assigned_salesperson_user_id
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
  return (
    idMatchesRowColumn(row.assigned_salesperson_user_id, userId) ||
    idMatchesRowColumn(row.assigned_to, userId)
  );
}

function isArchived(row) {
  return row.archived_at != null;
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
  const readAll = perms.has("lead.read.all");
  const readSelf = perms.has("lead.read.self");
  const updateAll = perms.has("lead.update.all");
  const updateSelf = perms.has("lead.update.self");
  const assignedOk = assignedToUser(lead, userId);

  if (mode === "read") {
    /**
     * Alignement listes (`getAll`, `getKanban`) : si l’utilisateur n’a ni `lead.read.all`
     * ni `lead.read.self` dans le Set RBAC, aucun filtre d’assignation n’est appliqué en SQL
     * → il voit tous les leads de l’org. Le détail doit suivre la même règle (sinon 403 fantôme).
     */
    const implicitOrgWideRead = !readAll && !readSelf;
    if (readAll || (readSelf && assignedOk) || implicitOrgWideRead) {
      accessLog(logContext, {
        leadId,
        user: userId,
        result: "OK_READ",
        implicitOrgWideRead: implicitOrgWideRead ? 1 : 0,
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
    /**
     * Alignement `PATCH /api/leads/:id` (`leads.controller.update`) : sans `lead.update.all`
     * ni `lead.update.self` dans le Set RBAC, aucune contrainte d’assignation n’est ajoutée au WHERE
     * → modification de tout lead de l’org. Même règle que la lecture implicite (RBAC vide / dev).
     */
    const implicitOrgWideWrite = !updateAll && !updateSelf;
    const writeAllowed =
      updateAll || (updateSelf && assignedOk) || implicitOrgWideWrite;

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
      implicitOrgWideWrite: implicitOrgWideWrite ? 1 : 0,
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
