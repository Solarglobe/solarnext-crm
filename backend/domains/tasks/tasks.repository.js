import { pool } from "../../config/db.js";

const TASK_SELECT = `
  t.*,
  l.full_name AS lead_full_name,
  l.company_name AS lead_company_name,
  l.email AS lead_email,
  l.phone AS lead_phone,
  l.phone_mobile AS lead_phone_mobile,
  NULLIF(TRIM(COALESCE(c.first_name, '') || ' ' || COALESCE(c.last_name, '')), '') AS client_full_name,
  c.company_name AS client_company_name,
  u.email AS assigned_user_email,
  u.first_name AS assigned_user_first_name,
  u.last_name AS assigned_user_last_name
`;

const TASK_JOINS = `
  LEFT JOIN leads l ON l.id = t.lead_id AND l.organization_id = t.organization_id
  LEFT JOIN clients c ON c.id = t.client_id AND c.organization_id = t.organization_id
  LEFT JOIN users u ON u.id = t.assigned_user_id
`;

export function taskSelectSql(alias = "t") {
  if (alias !== "t") return TASK_SELECT.replace(/\bt\./g, `${alias}.`);
  return TASK_SELECT;
}

export function mapTaskRow(row) {
  if (!row) return null;
  return {
    ...row,
    entity_label:
      row.lead_full_name ||
      row.lead_company_name ||
      row.client_full_name ||
      row.client_company_name ||
      null,
    assigned_user_label:
      [row.assigned_user_first_name, row.assigned_user_last_name].filter(Boolean).join(" ").trim() ||
      row.assigned_user_email ||
      null,
  };
}

export async function listTasks({
  organizationId,
  readAll,
  userId,
  filters = {},
  limit = 100,
  offset = 0,
}) {
  const params = [organizationId];
  let idx = 2;
  const where = ["t.organization_id = $1"];

  if (!readAll) {
    where.push(`t.assigned_user_id = $${idx++}`);
    params.push(userId);
  }

  if (filters.statuses?.length) {
    where.push(`t.status = ANY($${idx++}::text[])`);
    params.push(filters.statuses);
  }
  if (filters.assigned_user_id) {
    where.push(`t.assigned_user_id = $${idx++}`);
    params.push(filters.assigned_user_id);
  }
  if (filters.type) {
    where.push(`t.type = $${idx++}`);
    params.push(filters.type);
  }
  if (filters.priority) {
    where.push(`t.priority = $${idx++}`);
    params.push(filters.priority);
  }
  if (filters.lead_id) {
    where.push(`t.lead_id = $${idx++}`);
    params.push(filters.lead_id);
  }
  if (filters.client_id) {
    where.push(`t.client_id = $${idx++}`);
    params.push(filters.client_id);
  }
  if (filters.project_id) {
    where.push(`t.project_id = $${idx++}`);
    params.push(filters.project_id);
  }
  if (filters.entity === "lead") where.push("t.lead_id IS NOT NULL");
  if (filters.entity === "client") where.push("t.client_id IS NOT NULL");

  if (filters.bucket === "overdue") {
    where.push("t.status IN ('OPEN', 'SNOOZED') AND t.due_at < now()");
  } else if (filters.bucket === "today") {
    where.push("t.status IN ('OPEN', 'SNOOZED') AND t.due_at >= date_trunc('day', now()) AND t.due_at < date_trunc('day', now()) + interval '1 day'");
  } else if (filters.bucket === "week") {
    where.push("t.status IN ('OPEN', 'SNOOZED') AND t.due_at >= date_trunc('day', now()) AND t.due_at < date_trunc('day', now()) + interval '7 days'");
  }

  params.push(limit, offset);
  const sql = `
    SELECT ${TASK_SELECT}
    FROM crm_tasks t
    ${TASK_JOINS}
    WHERE ${where.join(" AND ")}
    ORDER BY
      CASE WHEN t.status IN ('OPEN', 'SNOOZED') AND t.due_at < now() THEN 0 ELSE 1 END,
      t.due_at ASC,
      t.created_at DESC
    LIMIT $${idx++} OFFSET $${idx++}
  `;
  const res = await pool.query(sql, params);
  return res.rows.map(mapTaskRow);
}

export async function getTaskById(taskId, organizationId) {
  const res = await pool.query(
    `SELECT ${TASK_SELECT}
     FROM crm_tasks t
     ${TASK_JOINS}
     WHERE t.id = $1 AND t.organization_id = $2`,
    [taskId, organizationId]
  );
  return mapTaskRow(res.rows[0]);
}

export async function insertTask(data, { idempotent = false } = {}) {
  const cols = [
    "organization_id",
    "lead_id",
    "client_id",
    "project_id",
    "assigned_user_id",
    "type",
    "title",
    "description",
    "due_at",
    "status",
    "priority",
    "created_from",
    "automation_key",
    "created_by_user_id",
    "updated_by_user_id",
  ];
  const values = cols.map((col) => data[col] ?? null);
  const placeholders = cols.map((_, i) => `$${i + 1}`).join(", ");
  const conflict = idempotent
    ? `ON CONFLICT (organization_id, automation_key) WHERE automation_key IS NOT NULL DO NOTHING`
    : "";
  const res = await pool.query(
    `INSERT INTO crm_tasks (${cols.join(", ")})
     VALUES (${placeholders})
     ${conflict}
     RETURNING *`,
    values
  );
  if (res.rows[0]) return { row: await getTaskById(res.rows[0].id, data.organization_id), created: true };

  if (idempotent && data.automation_key) {
    const existing = await pool.query(
      `SELECT id FROM crm_tasks WHERE organization_id = $1 AND automation_key = $2`,
      [data.organization_id, data.automation_key]
    );
    if (existing.rows[0]) {
      return { row: await getTaskById(existing.rows[0].id, data.organization_id), created: false };
    }
  }
  return { row: null, created: false };
}

export async function updateTask(taskId, organizationId, patch) {
  const allowed = [
    "assigned_user_id",
    "type",
    "title",
    "description",
    "due_at",
    "status",
    "priority",
    "completed_at",
    "updated_by_user_id",
  ];
  const sets = [];
  const params = [];
  let idx = 1;
  for (const key of allowed) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      sets.push(`${key} = $${idx++}`);
      params.push(patch[key]);
    }
  }
  if (sets.length === 0) return getTaskById(taskId, organizationId);
  sets.push("updated_at = now()");
  params.push(taskId, organizationId);
  const res = await pool.query(
    `UPDATE crm_tasks SET ${sets.join(", ")}
     WHERE id = $${idx++} AND organization_id = $${idx++}
     RETURNING id`,
    params
  );
  if (!res.rows[0]) return null;
  return getTaskById(taskId, organizationId);
}

export async function entityExists(table, id, organizationId) {
  if (!id) return true;
  const allowed = new Set(["leads", "clients", "studies", "users"]);
  if (!allowed.has(table)) return false;
  const res = await pool.query(`SELECT id FROM ${table} WHERE id = $1 AND organization_id = $2`, [id, organizationId]);
  return res.rows.length > 0;
}
