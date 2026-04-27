/**
 * Listes déroulantes facturation — sources strictes tables clients / leads uniquement.
 * Routes : GET /api/clients/select, GET /api/leads/select, GET /api/contacts/select
 */

import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import { effectiveSuperAdminRequestBypass } from "../lib/superAdminUserGuards.js";
import {
  hasEffectiveLeadReadScope,
  leadReadFlagsForQuery,
} from "../services/leadRequestAccess.service.js";
import {
  CLIENT_BILLING_SELECT_QUERY,
  leadsBillingSelectQueryAndParams,
} from "../services/billingSelectSql.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

/** GET /api/clients/select */
export async function getClientsSelect(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(CLIENT_BILLING_SELECT_QUERY, [org]);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

function resolveLeadsSelfScope(req, perms) {
  const superBypass = effectiveSuperAdminRequestBypass(req);
  if (superBypass) return false;
  const { readAll: canReadAll, readSelf: canReadSelf } = leadReadFlagsForQuery(req, perms);
  return !!(canReadSelf && !canReadAll);
}

/** GET /api/leads/select */
export async function getLeadsSelect(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
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
    const selfOnly = resolveLeadsSelfScope(req, perms);
    const { sql, params } = leadsBillingSelectQueryAndParams(org, uid, selfOnly);
    const result = await pool.query(sql, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/** GET /api/contacts/select — clients + leads typés, jamais mélangés côté SQL (deux requêtes). */
export async function getContactsSelect(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const perms = await getUserPermissions({
      userId: uid,
      organizationId: org,
    });

    const clientResult = await pool.query(CLIENT_BILLING_SELECT_QUERY, [org]);
    const clients = clientResult.rows.map((r) => ({
      id: r.id,
      full_name: r.full_name,
      type: "CLIENT",
    }));

    let leads = [];
    if (effectiveSuperAdminRequestBypass(req) || hasEffectiveLeadReadScope(req, perms)) {
      const selfOnly = resolveLeadsSelfScope(req, perms);
      const { sql, params } = leadsBillingSelectQueryAndParams(org, uid, selfOnly);
      const lr = await pool.query(sql, params);
      leads = lr.rows.map((r) => ({
        id: r.id,
        full_name: r.full_name,
        type: "LEAD",
      }));
    }

    res.json({ clients, leads });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
