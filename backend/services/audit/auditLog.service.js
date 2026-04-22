/**
 * CP-072 — Écriture audit_logs (résiliente : n’interrompt jamais le flux métier)
 */

import { randomUUID } from "crypto";
import { pool } from "../../config/db.js";
import { sanitizeAuditMetadata } from "./auditSanitize.js";
import { buildAuditHttpContext } from "./auditRequestContext.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function toUuidOrNull(v) {
  if (v == null) return null;
  const s = String(v).trim();
  return UUID_RE.test(s) ? s : null;
}

/**
 * @typedef {Object} LogAuditEventInput
 * @property {string} action
 * @property {string} [entityType]
 * @property {string|number|null} [entityId]
 * @property {string|null} [organizationId]
 * @property {string|null} [userId]
 * @property {string|null} [targetLabel]
 * @property {import("express").Request} [req]
 * @property {number|null} [statusCode]
 * @property {Record<string, unknown>} [metadata]
 */

/**
 * @param {LogAuditEventInput} input
 */
export async function logAuditEvent(input) {
  const {
    action,
    entityType = "system",
    entityId = null,
    organizationId = null,
    userId = null,
    targetLabel = null,
    req = null,
    statusCode = null,
    metadata = {},
  } = input;

  const http = buildAuditHttpContext(req);
  const meta = sanitizeAuditMetadata({
    ...metadata,
  });

  const org =
    organizationId !== null && organizationId !== undefined
      ? String(organizationId)
      : null;
  const uid = toUuidOrNull(userId);
  const et = entityType != null && String(entityType).trim() !== "" ? String(entityType) : "system";
  const eid = toUuidOrNull(entityId);
  const label =
    targetLabel !== null && targetLabel !== undefined
      ? String(targetLabel).slice(0, 500)
      : null;

  try {
    await pool.query(
      `INSERT INTO audit_logs (
        organization_id, user_id, action, entity_type, entity_id,
        before_hash, after_hash, ip_address, metadata_json, created_at,
        target_label, request_id, method, route, user_agent, status_code
      ) VALUES (
        $1, $2, $3, $4, $5,
        NULL, NULL, $6, $7::jsonb, NOW(),
        $8, $9, $10, $11, $12, $13
      )`,
      [
        org,
        uid,
        action,
        et,
        eid,
        http.ip,
        JSON.stringify(meta || {}),
        label,
        http.requestId,
        http.method,
        http.route,
        http.userAgent ? String(http.userAgent).slice(0, 1024) : null,
        statusCode,
      ]
    );
  } catch (e) {
    console.error("[audit_logs] insert failed (non-blocking):", e?.message || e);
  }
}

/**
 * @param {import("express").Request} req
 */
export function attachAuditRequestId(req, _res, next) {
  if (req && !req.auditRequestId) {
    req.auditRequestId = randomUUID();
  }
  next();
}
