/**
 * CP-030 — Controller Activités CRM
 */

import * as activityService from "./activity.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

/**
 * GET /api/leads/:id/activities
 */
export async function getActivities(req, res) {
  try {
    const org = orgId(req);
    const { id: leadId } = req.params;
    const { type, from, to, author, limit, page } = req.query;

    const types = req.query.type ? (Array.isArray(req.query.type) ? req.query.type : [req.query.type]) : undefined;

    const belongs = await activityService.assertLeadBelongsToOrg(leadId, org);
    if (!belongs) {
      return res.status(404).json({ error: "Lead non trouvé" });
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

    const belongs = await activityService.assertLeadBelongsToOrg(leadId, org);
    if (!belongs) {
      return res.status(404).json({ error: "Lead non trouvé" });
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
    const { activityId } = req.params;

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
    const { activityId } = req.params;

    const ok = await activityService.deleteActivity(activityId, org);
    if (!ok) {
      return res.status(404).json({ error: "Activité non trouvée" });
    }
    res.status(204).send();
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
