/**
 * Mission Engine V1 — Controller missions
 */

import { pool } from "../config/db.js";
import * as missionService from "../services/missionService.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.userId ?? req.user?.id;

/**
 * GET /missions — Liste missions avec filtres
 * Filtres: user_id, team_id, agency_id, mission_type_id, from, to
 */
export async function list(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const {
      user_id,
      team_id,
      agency_id,
      mission_type_id,
      from,
      to,
    } = req.query;

    const perms = await (await import("../rbac/rbac.service.js")).getUserPermissions({
      userId: uid,
      organizationId: org,
    });

    let filterUser = user_id;
    if (!filterUser && perms.has("mission.read.self") && !perms.has("mission.read.all")) {
      filterUser = uid;
    }

    const conditions = ["m.organization_id = $1"];
    const params = [org];
    let idx = 2;

    if (filterUser) {
      conditions.push(`EXISTS (SELECT 1 FROM mission_assignments ma WHERE ma.mission_id = m.id AND ma.user_id = $${idx})`);
      params.push(filterUser);
      idx++;
    }
    if (team_id) {
      conditions.push(`EXISTS (SELECT 1 FROM mission_assignments ma WHERE ma.mission_id = m.id AND ma.team_id = $${idx})`);
      params.push(team_id);
      idx++;
    }
    if (agency_id) {
      conditions.push(`m.agency_id = $${idx}`);
      params.push(agency_id);
      idx++;
    }
    if (mission_type_id) {
      conditions.push(`m.mission_type_id = $${idx}`);
      params.push(mission_type_id);
      idx++;
    }
    if (from) {
      conditions.push(`m.end_at >= $${idx}`);
      params.push(from);
      idx++;
    }
    if (to) {
      conditions.push(`m.start_at <= $${idx}`);
      params.push(to);
      idx++;
    }

    const query = `
      SELECT m.*, mt.name as mission_type_name, mt.color as mission_type_color,
             c.client_number, c.first_name as client_first_name, c.last_name as client_last_name, c.company_name as client_company_name,
             s.study_number, s.title as study_title,
             (SELECT json_agg(json_build_object('user_id', ma.user_id, 'team_id', ma.team_id))
                FROM mission_assignments ma WHERE ma.mission_id = m.id) as assignments
      FROM missions m
      LEFT JOIN mission_types mt ON mt.id = m.mission_type_id
      LEFT JOIN clients c ON c.id = m.client_id AND (c.archived_at IS NULL)
      LEFT JOIN studies s ON s.id = m.project_id AND (s.archived_at IS NULL)
      WHERE ${conditions.join(" AND ")}
      ORDER BY m.start_at ASC
    `;
    const result = await pool.query(query, params);
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /missions/:id — Détail mission
 */
export async function getById(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;

    const result = await pool.query(
      `SELECT m.*, mt.name as mission_type_name, mt.color as mission_type_color,
              (SELECT json_agg(json_build_object('user_id', ma.user_id, 'team_id', ma.team_id))
                 FROM mission_assignments ma WHERE ma.mission_id = m.id) as assignments
       FROM missions m
       LEFT JOIN mission_types mt ON mt.id = m.mission_type_id
       WHERE m.id = $1 AND m.organization_id = $2`,
      [id, org]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Mission non trouvée" });
    }
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /missions — Créer mission
 */
export async function create(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const body = req.body;

    const mission = await missionService.createMission({
      organizationId: org,
      createdBy: uid,
      title: body.title,
      description: body.description,
      missionTypeId: body.mission_type_id,
      startAt: body.start_at,
      endAt: body.end_at,
      status: body.status,
      clientId: body.client_id,
      projectId: body.project_id,
      agencyId: body.agency_id,
      isPrivateBlock: body.is_private_block ?? false,
      assignments: (body.assignments || []).map((a) => ({
        userId: a.user_id,
        teamId: a.team_id,
      })),
    });
    res.status(201).json(mission);
  } catch (e) {
    if (e.code === "SCHEDULE_CONFLICT") {
      return res.status(409).json({ error: "Conflit horaire", code: "SCHEDULE_CONFLICT" });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * PATCH /missions/:id — Mise à jour complète mission
 */
export async function update(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const body = req.body;

    const mission = await missionService.updateMission({
      missionId: id,
      organizationId: org,
      title: body.title,
      description: body.description,
      missionTypeId: body.mission_type_id,
      startAt: body.start_at,
      endAt: body.end_at,
      status: body.status,
      clientId: body.client_id,
      projectId: body.project_id,
      agencyId: body.agency_id,
      isPrivateBlock: body.is_private_block,
      assignments: (body.assignments || []).map((a) => ({
        userId: a.user_id,
        teamId: a.team_id,
      })),
    });
    res.json(mission);
  } catch (e) {
    if (e.code === "SCHEDULE_CONFLICT") {
      return res.status(409).json({ error: "Conflit horaire", code: "SCHEDULE_CONFLICT" });
    }
    if (e.code === "NOT_FOUND") {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /missions/:id — Suppression mission
 */
export async function remove(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;

    await missionService.deleteMission({ missionId: id, organizationId: org });
    res.status(204).send();
  } catch (e) {
    if (e.code === "NOT_FOUND") {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * PATCH /missions/:id/time — Drag & drop: modifie uniquement start_at, end_at
 */
export async function updateTime(req, res) {
  try {
    const { id } = req.params;
    const { start_at, end_at } = req.body;

    if (!start_at || !end_at) {
      return res.status(400).json({ error: "start_at et end_at requis" });
    }

    const mission = await missionService.updateMissionTime({
      missionId: id,
      startAt: start_at,
      endAt: end_at,
    });
    res.json(mission);
  } catch (e) {
    if (e.code === "SCHEDULE_CONFLICT") {
      return res.status(409).json({ error: "Conflit horaire", code: "SCHEDULE_CONFLICT" });
    }
    if (e.code === "NOT_FOUND") {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /clients/:id/missions — Créer mission depuis fiche client
 */
export async function createFromClient(req, res) {
  try {
    const org = orgId(req);
    const uid = userId(req);
    const clientId = req.params.id;
    const body = req.body;

    const mission = await missionService.createMissionFromClient(
      clientId,
      {
        title: body.title,
        description: body.description,
        missionTypeId: body.mission_type_id,
        startAt: body.start_at,
        endAt: body.end_at,
        status: body.status,
        projectId: body.project_id,
        agencyId: body.agency_id,
        isPrivateBlock: body.is_private_block ?? false,
        assignments: (body.assignments || []).map((a) => ({
          userId: a.user_id,
          teamId: a.team_id,
        })),
      },
      org,
      uid
    );
    res.status(201).json(mission);
  } catch (e) {
    if (e.code === "SCHEDULE_CONFLICT") {
      return res.status(409).json({ error: "Conflit horaire", code: "SCHEDULE_CONFLICT" });
    }
    if (e.code === "NOT_FOUND") {
      return res.status(404).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /clients/:id/missions — Liste missions liées au client
 */
export async function listByClient(req, res) {
  try {
    const org = orgId(req);
    const clientId = req.params.id;

    const result = await pool.query(
      `SELECT m.*, mt.name as mission_type_name, mt.color as mission_type_color,
              (SELECT json_agg(json_build_object('user_id', ma.user_id, 'team_id', ma.team_id))
                 FROM mission_assignments ma WHERE ma.mission_id = m.id) as assignments
       FROM missions m
       LEFT JOIN mission_types mt ON mt.id = m.mission_type_id
       WHERE m.client_id = $1 AND m.organization_id = $2
       ORDER BY m.start_at DESC`,
      [clientId, org]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}
