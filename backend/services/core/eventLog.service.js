/**
 * CP-085 — Persistance optionnelle des événements (audit / debug / replay futur).
 */

import { pool } from "../../config/db.js";

const MAX_PAYLOAD_BYTES = 48_000;

/**
 * @param {unknown} obj
 */
function truncatePayload(obj) {
  try {
    const s = JSON.stringify(obj);
    if (s.length <= MAX_PAYLOAD_BYTES) return obj;
    return { _truncated: true, preview: s.slice(0, MAX_PAYLOAD_BYTES) };
  } catch {
    return { _error: "non_serializable" };
  }
}

/**
 * @param {{ type: string, payload: object, organizationId?: string | null }} p
 */
export async function logEvent(p) {
  const { type, organizationId = null } = p;
  const payload = truncatePayload(p.payload ?? {});
  await pool.query(`INSERT INTO system_events (organization_id, type, payload) VALUES ($1, $2, $3)`, [
    organizationId,
    String(type),
    payload,
  ]);
}
