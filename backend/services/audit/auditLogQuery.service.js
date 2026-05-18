import { pool } from "../../config/db.js";

const MAX_LIMIT = 200;

function clampLimit(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 50;
  return Math.max(1, Math.min(MAX_LIMIT, Math.floor(n)));
}

function clampOffset(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.floor(n));
}

function addFilter(parts, params, sql, value) {
  if (value === undefined || value === null || String(value).trim() === "") return;
  params.push(String(value).trim());
  parts.push(sql.replace("?", `$${params.length}`));
}

function buildWhere({ organizationId, filters = {}, isSuperAdmin = false }) {
  const where = [];
  const params = [];
  if (!isSuperAdmin) {
    params.push(organizationId);
    where.push(`al.organization_id = $${params.length}`);
  } else if (filters.organizationId) {
    params.push(filters.organizationId);
    where.push(`al.organization_id = $${params.length}`);
  }
  addFilter(where, params, "al.action = ?", filters.action);
  addFilter(where, params, "al.user_id = ?::uuid", filters.userId);
  addFilter(where, params, "al.entity_type = ?", filters.entityType);
  if (filters.dateFrom) {
    params.push(filters.dateFrom);
    where.push(`al.created_at >= $${params.length}::timestamptz`);
  }
  if (filters.dateTo) {
    params.push(filters.dateTo);
    where.push(`al.created_at <= $${params.length}::timestamptz`);
  }
  return { whereSql: where.length ? `WHERE ${where.join(" AND ")}` : "", params };
}

function rowSelect() {
  return `
    SELECT al.id, al.organization_id, al.user_id, al.action, al.entity_type, al.entity_id,
           al.ip_address, al.target_label, al.request_id, al.method, al.route,
           al.user_agent, al.status_code, al.metadata_json, al.created_at,
           NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS user_name,
           u.email AS user_email,
           o.name AS organization_name
    FROM audit_logs al
    LEFT JOIN users u ON u.id = al.user_id
    LEFT JOIN organizations o ON o.id = al.organization_id
  `;
}

export async function listAuditLogs(organizationId, options = {}) {
  const limit = clampLimit(options.limit);
  const offset = clampOffset(options.offset);
  const { whereSql, params } = buildWhere({
    organizationId,
    filters: options,
    isSuperAdmin: options.isSuperAdmin === true,
  });

  const count = await pool.query(
    `SELECT COUNT(*)::int AS total FROM audit_logs al ${whereSql}`,
    params
  );
  const rows = await pool.query(
    `${rowSelect()} ${whereSql}
     ORDER BY al.created_at DESC
     LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
    [...params, limit, offset]
  );
  return { rows: rows.rows, total: count.rows[0]?.total ?? 0, limit, offset };
}

export async function exportAuditLogsCsv(organizationId, options = {}) {
  const { whereSql, params } = buildWhere({
    organizationId,
    filters: options,
    isSuperAdmin: options.isSuperAdmin === true,
  });
  const rows = await pool.query(
    `${rowSelect()} ${whereSql}
     ORDER BY al.created_at DESC
     LIMIT 5000`,
    params
  );
  const columns = [
    "created_at",
    "organization_name",
    "user_email",
    "action",
    "entity_type",
    "target_label",
    "ip_address",
    "method",
    "route",
    "status_code",
    "user_agent",
  ];
  const escape = (value) => {
    const text = value == null ? "" : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  };
  const lines = [columns.join(",")];
  for (const row of rows.rows) {
    lines.push(columns.map((column) => escape(row[column])).join(","));
  }
  return lines.join("\n");
}
