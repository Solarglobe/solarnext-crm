/**
 * CP-030 — Service Activités CRM
 * CRUD activités + création auto (STATUS_CHANGE, STAGE_CHANGE, ADDRESS_VERIFIED)
 */

import { pool } from "../../config/db.js";
import { recalculateLeadScore } from "../../services/leadScoring.service.js";

const VALID_TYPES = [
  "NOTE",
  "CALL",
  "MEETING",
  "EMAIL",
  "STATUS_CHANGE",
  "STAGE_CHANGE",
  "ADDRESS_VERIFIED",
  "PROJECT_STATUS_CHANGE",
  "DEVIS_SIGNE",
  "INSTALLATION_TERMINEE",
  "LEAD_ARCHIVED"
];
const USER_TYPES = ["NOTE", "CALL", "MEETING", "EMAIL"];

/**
 * Vérifier que le lead appartient à l'org de l'utilisateur
 */
export async function assertLeadBelongsToOrg(leadId, organizationId) {
  const r = await pool.query(
    "SELECT id FROM leads WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [leadId, organizationId]
  );
  if (r.rows.length === 0) return false;
  return true;
}

/**
 * Résout le lead d’une activité (pour assertLeadApiAccess sur PATCH/DELETE /api/activities/:id).
 */
export async function fetchActivityLeadId(activityId, organizationId) {
  const r = await pool.query(
    `SELECT lead_id FROM lead_activities
     WHERE id = $1 AND organization_id = $2 AND (is_deleted IS NOT TRUE)`,
    [activityId, organizationId]
  );
  return r.rows[0]?.lead_id ?? null;
}

/**
 * Lister les activités d'un lead avec filtres
 */
export async function listActivities(leadId, organizationId, options = {}) {
  const { type, types, from, to, author, limit = 50, page = 1 } = options;

  const limitNum = Math.min(200, Math.max(1, parseInt(limit, 10) || 50));
  const offset = (Math.max(1, parseInt(page, 10) || 1) - 1) * limitNum;

  let query = `
    SELECT a.id, a.type, a.title, a.content, a.payload, a.occurred_at, a.created_at,
           a.is_pinned, a.created_by_user_id,
           u.email as created_by_email,
           COALESCE(u.email, '') as created_by_name
    FROM lead_activities a
    LEFT JOIN users u ON u.id = a.created_by_user_id
    WHERE a.lead_id = $1 AND a.organization_id = $2 AND a.is_deleted = false
  `;
  const params = [leadId, organizationId];
  let idx = 3;

  if (type) {
    query += ` AND a.type = $${idx++}`;
    params.push(type);
  }
  if (types && Array.isArray(types) && types.length > 0) {
    query += ` AND a.type = ANY($${idx++})`;
    params.push(types);
  }
  if (from) {
    query += ` AND a.occurred_at >= $${idx++}`;
    params.push(from);
  }
  if (to) {
    query += ` AND a.occurred_at <= $${idx++}`;
    params.push(to);
  }
  if (author) {
    query += ` AND a.created_by_user_id = $${idx++}`;
    params.push(author);
  }

  query += ` ORDER BY a.is_pinned DESC, a.occurred_at DESC LIMIT $${idx++} OFFSET $${idx++}`;
  params.push(limitNum, offset);

  const result = await pool.query(query, params);
  const items = result.rows.map((r) => ({
    id: r.id,
    type: r.type,
    title: r.title,
    content: r.content,
    payload: r.payload,
    occurred_at: r.occurred_at,
    created_at: r.created_at,
    created_by: {
      id: r.created_by_user_id,
      name: r.created_by_name || r.created_by_email || "—",
      email: r.created_by_email || null
    },
    is_pinned: r.is_pinned
  }));

  return { items };
}

/**
 * Créer une activité (NOTE, CALL, MEETING, EMAIL)
 */
export async function createActivity(leadId, organizationId, userId, body) {
  const { type, title, content, occurred_at, payload } = body;

  if (!USER_TYPES.includes(type)) {
    throw new Error(`type doit être parmi: ${USER_TYPES.join(", ")}`);
  }
  if (type === "NOTE" && (!content || String(content).trim() === "")) {
    throw new Error("Une note doit avoir un contenu non vide");
  }

  const occurredAt = occurred_at ? new Date(occurred_at) : new Date();
  const payloadJson = payload != null ? JSON.stringify(payload) : null;

  const result = await pool.query(
    `INSERT INTO lead_activities (
      organization_id, lead_id, type, title, content, payload, occurred_at, created_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
    RETURNING id, type, title, content, payload, occurred_at, created_at, is_pinned, created_by_user_id`,
    [
      organizationId,
      leadId,
      type,
      title || null,
      content || null,
      payloadJson,
      occurredAt,
      userId
    ]
  );

  const row = result.rows[0];

  // Mise à jour de last_activity_at sur le lead + recalcul inactivité immédiat
  await pool.query(
    `UPDATE leads SET last_activity_at = now(), updated_at = now()
     WHERE id = $1 AND organization_id = $2`,
    [leadId, organizationId]
  );
  await recalculateLeadScore(leadId, organizationId).catch(() => {});

  const userRes = await pool.query(
    "SELECT email FROM users WHERE id = $1",
    [row.created_by_user_id]
  );
  const u = userRes.rows[0];

  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    payload: row.payload,
    occurred_at: row.occurred_at,
    created_at: row.created_at,
    created_by: {
      id: row.created_by_user_id,
      name: u?.email || "—",
      email: u?.email || null
    },
    is_pinned: row.is_pinned
  };
}

/**
 * Mettre à jour une activité (title, content, occurred_at, is_pinned)
 */
export async function updateActivity(activityId, organizationId, body) {
  const allowed = ["title", "content", "occurred_at", "is_pinned"];
  const updates = [];
  const values = [];
  let idx = 1;

  for (const k of allowed) {
    if (body[k] !== undefined) {
      if (k === "occurred_at") {
        updates.push(`occurred_at = $${idx++}`);
        values.push(new Date(body[k]));
      } else if (k === "is_pinned") {
        updates.push(`is_pinned = $${idx++}`);
        values.push(!!body[k]);
      } else {
        updates.push(`${k} = $${idx++}`);
        values.push(body[k]);
      }
    }
  }

  if (updates.length === 0) {
    const r = await pool.query(
      "SELECT * FROM lead_activities WHERE id = $1 AND organization_id = $2",
      [activityId, organizationId]
    );
    if (r.rows.length === 0) return null;
    return formatActivity(r.rows[0]);
  }

  updates.push("updated_at = now()");
  values.push(activityId, organizationId);
  const query = `UPDATE lead_activities SET ${updates.join(", ")} WHERE id = $${idx++} AND organization_id = $${idx++} RETURNING *`;
  const result = await pool.query(query, values);
  if (result.rows.length === 0) return null;
  return formatActivity(result.rows[0]);
}

/**
 * Soft delete
 */
export async function deleteActivity(activityId, organizationId) {
  const result = await pool.query(
    `UPDATE lead_activities SET is_deleted = true, updated_at = now()
     WHERE id = $1 AND organization_id = $2 RETURNING id`,
    [activityId, organizationId]
  );
  return result.rows.length > 0;
}

/**
 * Vérifier qu'une activité appartient à l'org
 */
export async function assertActivityBelongsToOrg(activityId, organizationId) {
  const r = await pool.query(
    "SELECT id FROM lead_activities WHERE id = $1 AND organization_id = $2",
    [activityId, organizationId]
  );
  return r.rows.length > 0;
}

/**
 * Types d'activités auto qui réinitialisent l’inactivité (alignés sur la vérité métier affichée).
 * NOTE/CALL/MEETING/EMAIL : rafraîchissent via createActivity().
 * LEAD_ARCHIVED : exclu — dossier archivé, pas de relance commerciale sur ce signal.
 */
const AUTO_TYPES_REFRESH_ACTIVITY = new Set([
  "STAGE_CHANGE",
  "STATUS_CHANGE",
  "PROJECT_STATUS_CHANGE",
  "DEVIS_SIGNE",
  "INSTALLATION_TERMINEE",
  "ADDRESS_VERIFIED",
]);

/**
 * Créer une activité auto (STATUS_CHANGE, STAGE_CHANGE, ADDRESS_VERIFIED…)
 * Utilisé par les handlers métier, pas par l'API directe.
 * Pour les types commercialement significatifs, met à jour last_activity_at.
 */
export async function createAutoActivity(organizationId, leadId, userId, type, title, payload) {
  if (!VALID_TYPES.includes(type)) {
    throw new Error(`type invalide: ${type}`);
  }

  const result = await pool.query(
    `INSERT INTO lead_activities (
      organization_id, lead_id, type, title, payload, occurred_at, created_by_user_id
    ) VALUES ($1, $2, $3, $4, $5, now(), $6)
    RETURNING id`,
    [organizationId, leadId, type, title, payload ? JSON.stringify(payload) : null, userId]
  );

  // Réinitialisation inactivité + recalcul score / inactivity_level (même chaîne que createActivity)
  if (AUTO_TYPES_REFRESH_ACTIVITY.has(type)) {
    await pool
      .query(
        `UPDATE leads SET last_activity_at = now(), updated_at = now()
       WHERE id = $1 AND organization_id = $2`,
        [leadId, organizationId]
      )
      .catch(() => {});
    await recalculateLeadScore(leadId, organizationId).catch(() => {});
  }

  return result.rows[0]?.id;
}

async function formatActivity(row) {
  let u = null;
  if (row.created_by_user_id) {
    const userRes = await pool.query(
      "SELECT email FROM users WHERE id = $1",
      [row.created_by_user_id]
    );
    u = userRes.rows[0];
  }
  return {
    id: row.id,
    type: row.type,
    title: row.title,
    content: row.content,
    payload: row.payload,
    occurred_at: row.occurred_at,
    created_at: row.created_at,
    created_by: {
      id: row.created_by_user_id,
      name: u?.email || "—",
      email: u?.email || null
    },
    is_pinned: row.is_pinned
  };
}
