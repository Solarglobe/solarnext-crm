/**
 * Mission Engine V1 — Service missions
 * Anti-chevauchement strict par user, drag & drop time only, création depuis client
 */

import { pool } from "../config/db.js";

/**
 * Vérifie qu'aucun user assigné n'a de conflit horaire.
 * @param {{ userIds: string[], startAt: string, endAt: string, excludeMissionId?: string }} params
 * @throws {Error} SCHEDULE_CONFLICT si conflit
 */
export async function checkScheduleConflicts({ userIds, startAt, endAt, excludeMissionId }) {
  if (!userIds?.length) return;

  for (const uid of userIds) {
    const params = excludeMissionId
      ? [uid, endAt, startAt, excludeMissionId]
      : [uid, endAt, startAt];
    const conflictQuery = excludeMissionId
      ? `SELECT 1 FROM mission_assignments ma
         JOIN missions m ON m.id = ma.mission_id
         WHERE ma.user_id = $1 AND m.id != $4
         AND m.start_at < $2 AND m.end_at > $3`
      : `SELECT 1 FROM mission_assignments ma
         JOIN missions m ON m.id = ma.mission_id
         WHERE ma.user_id = $1
         AND m.start_at < $2 AND m.end_at > $3`;

    const r = await pool.query(conflictQuery, params);
    if (r.rows.length > 0) {
      const err = new Error("Conflit horaire pour un utilisateur assigné");
      err.code = "SCHEDULE_CONFLICT";
      throw err;
    }
  }
}

/**
 * Crée une mission avec assignations.
 * @param {Object} params
 * @param {string} params.organizationId
 * @param {string} params.createdBy
 * @param {string} params.title
 * @param {string} [params.description]
 * @param {string} [params.missionTypeId]
 * @param {string} params.startAt
 * @param {string} params.endAt
 * @param {string} [params.status]
 * @param {string} [params.clientId]
 * @param {string} [params.projectId]
 * @param {string} [params.agencyId]
 * @param {boolean} [params.isPrivateBlock]
 * @param {{ userId: string, teamId?: string }[]} [params.assignments]
 */
export async function createMission(params) {
  const {
    organizationId,
    createdBy,
    title,
    description,
    missionTypeId,
    startAt,
    endAt,
    status = "scheduled",
    clientId,
    projectId,
    agencyId,
    isPrivateBlock = false,
    assignments = [],
  } = params;

  const userIds = assignments.map((a) => a.userId).filter(Boolean);
  await checkScheduleConflicts({ userIds, startAt, endAt });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const missionRes = await client.query(
      `INSERT INTO missions (
        organization_id, title, description, mission_type_id,
        start_at, end_at, status, client_id, project_id, agency_id,
        is_private_block, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
      RETURNING *`,
      [
        organizationId,
        title,
        description ?? null,
        missionTypeId ?? null,
        startAt,
        endAt,
        status,
        clientId ?? null,
        projectId ?? null,
        agencyId ?? null,
        isPrivateBlock,
        createdBy,
      ]
    );
    const mission = missionRes.rows[0];

    for (const a of assignments) {
      if (a.userId) {
        await client.query(
          `INSERT INTO mission_assignments (mission_id, user_id, team_id)
           VALUES ($1, $2, $3)`,
          [mission.id, a.userId, a.teamId ?? null]
        );
      }
    }

    await client.query("COMMIT");

    // Google Sync V1 — Hook préparation (non implémenté)
    // TODO: if (user.google_sync_enabled) { enqueueGooglePush(mission.id) }
    // for (const a of assignments) {
    //   const userRow = await pool.query('SELECT google_sync_enabled FROM users WHERE id = $1', [a.userId]);
    //   if (userRow.rows[0]?.google_sync_enabled) {
    //     enqueueGooglePush(mission.id);
    //     break;
    //   }
    // }

    return mission;
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Met à jour uniquement start_at et end_at (drag & drop).
 * Ne modifie jamais les assignments.
 * @param {{ missionId: string, startAt: string, endAt: string }} params
 */
export async function updateMissionTime({ missionId, startAt, endAt }) {
  const missionRes = await pool.query(
    "SELECT id, organization_id FROM missions WHERE id = $1",
    [missionId]
  );
  if (missionRes.rows.length === 0) {
    const err = new Error("Mission non trouvée");
    err.code = "NOT_FOUND";
    throw err;
  }

  const assignRes = await pool.query(
    "SELECT user_id FROM mission_assignments WHERE mission_id = $1",
    [missionId]
  );
  const userIds = assignRes.rows.map((r) => r.user_id);
  await checkScheduleConflicts({
    userIds,
    startAt,
    endAt,
    excludeMissionId: missionId,
  });

  const up = await pool.query(
    `UPDATE missions SET start_at = $1, end_at = $2, updated_at = now()
     WHERE id = $3 RETURNING *`,
    [startAt, endAt, missionId]
  );

  // Google Sync V1 — Hook préparation
  // TODO: if (user.google_sync_enabled) { enqueueGooglePush(missionId) }

  return up.rows[0];
}

/**
 * Met à jour une mission (tous champs sauf created_by).
 * @param {{ missionId: string, organizationId: string, ... }} params
 */
export async function updateMission(params) {
  const {
    missionId,
    organizationId,
    title,
    description,
    missionTypeId,
    startAt,
    endAt,
    status,
    clientId,
    projectId,
    agencyId,
    isPrivateBlock,
    assignments,
  } = params;

  const missionRes = await pool.query(
    "SELECT id, organization_id FROM missions WHERE id = $1 AND organization_id = $2",
    [missionId, organizationId]
  );
  if (missionRes.rows.length === 0) {
    const err = new Error("Mission non trouvée");
    err.code = "NOT_FOUND";
    throw err;
  }

  const userIds = (assignments || []).map((a) => a.userId).filter(Boolean);
  if (userIds.length && (startAt || endAt)) {
    const mission = missionRes.rows[0];
    const currentRes = await pool.query(
      "SELECT start_at, end_at FROM missions WHERE id = $1",
      [missionId]
    );
    const current = currentRes.rows[0];
    await checkScheduleConflicts({
      userIds,
      startAt: startAt || current.start_at,
      endAt: endAt || current.end_at,
      excludeMissionId: missionId,
    });
  }

  const updates = [];
  const values = [];
  let idx = 1;

  if (title !== undefined) {
    updates.push(`title = $${idx++}`);
    values.push(title);
  }
  if (description !== undefined) {
    updates.push(`description = $${idx++}`);
    values.push(description ?? null);
  }
  if (missionTypeId !== undefined) {
    updates.push(`mission_type_id = $${idx++}`);
    values.push(missionTypeId || null);
  }
  if (startAt !== undefined) {
    updates.push(`start_at = $${idx++}`);
    values.push(startAt);
  }
  if (endAt !== undefined) {
    updates.push(`end_at = $${idx++}`);
    values.push(endAt);
  }
  if (status !== undefined) {
    updates.push(`status = $${idx++}`);
    values.push(status);
  }
  if (clientId !== undefined) {
    updates.push(`client_id = $${idx++}`);
    values.push(clientId || null);
  }
  if (projectId !== undefined) {
    updates.push(`project_id = $${idx++}`);
    values.push(projectId || null);
  }
  if (agencyId !== undefined) {
    updates.push(`agency_id = $${idx++}`);
    values.push(agencyId || null);
  }
  if (isPrivateBlock !== undefined) {
    updates.push(`is_private_block = $${idx++}`);
    values.push(isPrivateBlock);
  }

  if (updates.length === 0 && !assignments) {
    const r = await pool.query(
      `SELECT m.*, mt.name as mission_type_name, mt.color as mission_type_color,
              (SELECT json_agg(json_build_object('user_id', ma.user_id, 'team_id', ma.team_id))
                 FROM mission_assignments ma WHERE ma.mission_id = m.id) as assignments
       FROM missions m
       LEFT JOIN mission_types mt ON mt.id = m.mission_type_id
       WHERE m.id = $1`,
      [missionId]
    );
    return r.rows[0];
  }

  const client = await pool.connect();
  try {
    if (updates.length > 0) {
      values.push(missionId);
      const upQuery = `UPDATE missions SET ${updates.join(", ")}, updated_at = now() WHERE id = $${idx} RETURNING *`;
      const upRes = await client.query(upQuery, values);
      if (upRes.rows.length === 0) {
        const err = new Error("Mission non trouvée");
        err.code = "NOT_FOUND";
        throw err;
      }
    }

    if (Array.isArray(assignments)) {
      await client.query("DELETE FROM mission_assignments WHERE mission_id = $1", [missionId]);
      for (const a of assignments) {
        if (a.userId) {
          await client.query(
            `INSERT INTO mission_assignments (mission_id, user_id, team_id) VALUES ($1, $2, $3)`,
            [missionId, a.userId, a.teamId ?? null]
          );
        }
      }
    }

    const finalRes = await client.query(
      `SELECT m.*, mt.name as mission_type_name, mt.color as mission_type_color,
              (SELECT json_agg(json_build_object('user_id', ma.user_id, 'team_id', ma.team_id))
                 FROM mission_assignments ma WHERE ma.mission_id = m.id) as assignments
       FROM missions m
       LEFT JOIN mission_types mt ON mt.id = m.mission_type_id
       WHERE m.id = $1`,
      [missionId]
    );
    return finalRes.rows[0];
  } finally {
    client.release();
  }
}

/**
 * Supprime une mission (delete direct, pas de soft delete).
 * @param {{ missionId: string, organizationId: string }} params
 */
export async function deleteMission({ missionId, organizationId }) {
  const r = await pool.query(
    "DELETE FROM missions WHERE id = $1 AND organization_id = $2 RETURNING id",
    [missionId, organizationId]
  );
  if (r.rows.length === 0) {
    const err = new Error("Mission non trouvée");
    err.code = "NOT_FOUND";
    throw err;
  }
}

/**
 * Crée une mission depuis une fiche client.
 * Préremplit: client_id, organization_id, agency_id (si client en a une)
 */
export async function createMissionFromClient(clientId, body, organizationId, createdBy) {
  const clientRow = await pool.query(
    "SELECT id, organization_id, agency_id FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [clientId, organizationId]
  );
  if (clientRow.rows.length === 0) {
    const err = new Error("Client non trouvé");
    err.code = "NOT_FOUND";
    throw err;
  }
  const c = clientRow.rows[0];

  return createMission({
    ...body,
    organizationId,
    createdBy,
    clientId: c.id,
    agencyId: body.agencyId ?? c.agency_id ?? undefined,
  });
}
