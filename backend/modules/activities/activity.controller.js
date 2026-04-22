/**
 * CP-030 — Controller Activités CRM
 */

import { pool } from "../../config/db.js";
import { assertLeadApiAccess } from "../../services/leadRequestAccess.service.js";
import * as activityService from "./activity.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

/**
 * GET /api/leads/:id/activities
 */
export async function getActivities(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id: leadId } = req.params;
    const { type, from, to, author, limit, page } = req.query;

    const types = req.query.type ? (Array.isArray(req.query.type) ? req.query.type : [req.query.type]) : undefined;

    const gate = await assertLeadApiAccess(pool, {
      leadId,
      organizationId: org,
      userId: uid,
      mode: "read",
      logContext: "GET /api/leads/:id/activities",
      req,
    });
    if (!gate.ok) {
      return res.status(gate.status).json(gate.body);
    }

    const result = await activityService.listActivities(leadId, org, {
      type: types ? undefined : type,
      types,
      from,
      to,
      author,
      limit,
      page
    });

    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/leads/:id/activities
 */
export async function postActivity(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { id: leadId } = req.params;

    const gate = await assertLeadApiAccess(pool, {
      leadId,
      organizationId: org,
      userId: uid,
      mode: "write",
      forbidArchivedWrite: true,
      logContext: "POST /api/leads/:id/activities",
      req,
    });
    if (!gate.ok) {
      return res.status(gate.status).json(gate.body);
    }

    const activity = await activityService.createActivity(leadId, org, uid, req.body);
    res.status(201).json(activity);
  } catch (e) {
    if (e.message?.includes("doit")) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * PATCH /api/activities/:activityId
 */
export async function patchActivity(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { activityId } = req.params;

    const leadId = await activityService.fetchActivityLeadId(activityId, org);
    if (!leadId) {
      return res.status(404).json({ error: "Activité non trouvée", code: "ACTIVITY_NOT_FOUND" });
    }

    const gate = await assertLeadApiAccess(pool, {
      leadId,
      organizationId: org,
      userId: uid,
      mode: "write",
      forbidArchivedWrite: true,
      logContext: "PATCH /api/activities/:activityId",
      req,
    });
    if (!gate.ok) {
      return res.status(gate.status).json(gate.body);
    }

    const activity = await activityService.updateActivity(activityId, org, req.body);
    if (!activity) {
      return res.status(404).json({ error: "Activité non trouvée" });
    }
    res.json(activity);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/activities/:activityId
 */
export async function deleteActivity(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const { activityId } = req.params;

    const leadId = await activityService.fetchActivityLeadId(activityId, org);
    if (!leadId) {
      return res.status(404).json({ error: "Activité non trouvée", code: "ACTIVITY_NOT_FOUND" });
    }

    const gate = await assertLeadApiAccess(pool, {
      leadId,
      organizationId: org,
      userId: uid,
      mode: "write",
      forbidArchivedWrite: true,
      logContext: "DELETE /api/activities/:activityId",
      req,
    });
    if (!gate.ok) {
      return res.status(gate.status).json(gate.body);
    }

    const ok = await activityService.deleteActivity(activityId, org);
    if (!ok) {
      return res.status(404).json({ error: "Activité non trouvée" });
    }
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
