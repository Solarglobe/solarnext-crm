/**
 * CP-082 — Tracking ouverture / clic (pixel + réécriture liens).
 */

import crypto from "crypto";
import { pool } from "../../config/db.js";
import { emitEventAsync } from "../core/eventBus.service.js";

const PNG_1X1_TRANSPARENT = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==",
  "base64"
);

/** Réponse HTTP pour GET /track/open — PNG 1×1 transparent. */
export function getTrackingPixelPngBuffer() {
  return PNG_1X1_TRANSPARENT;
}

function truthyEnv(v) {
  if (v === undefined || v === null) return false;
  const s = String(v).toLowerCase().trim();
  return s === "1" || s === "true" || s === "yes" || s === "on";
}

/**
 * Opt-in explicite (RGPD) : désactivé par défaut.
 */
export function isMailTrackingEnabled() {
  return truthyEnv(process.env.MAIL_TRACKING_ENABLED);
}

/**
 * Base publique absolue pour les URLs dans les e-mails (obligatoire en prod).
 * Ex. https://api.votredomaine.com ou http://127.0.0.1:3000 en dev.
 */
export function getTrackingPublicBaseUrl() {
  const raw = process.env.MAIL_TRACKING_PUBLIC_BASE_URL || process.env.API_PUBLIC_URL || process.env.PUBLIC_API_URL || "";
  let u = String(raw).trim().replace(/\/$/, "");
  if (u) return u;
  const port = process.env.PORT || "3000";
  return `http://127.0.0.1:${port}`;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isValidTrackingUuid(s) {
  return typeof s === "string" && UUID_RE.test(s.trim());
}

/**
 * @returns {string} Nouvel UUID v4 pour mail_messages.tracking_id
 */
export function generateTrackingId() {
  return crypto.randomUUID();
}

export function buildOpenPixelUrl(trackingId) {
  const base = getTrackingPublicBaseUrl();
  return `${base}/api/mail/track/open/${encodeURIComponent(trackingId)}`;
}

export function buildClickThroughUrl(trackingId, targetUrl) {
  const base = getTrackingPublicBaseUrl();
  const enc = encodeURIComponent(targetUrl);
  return `${base}/api/mail/track/click/${encodeURIComponent(trackingId)}?url=${enc}`;
}

/**
 * @param {string} html
 * @param {string} trackingId
 */
export function injectTrackingPixel(html, trackingId) {
  if (!html || typeof html !== "string") return html;
  const src = buildOpenPixelUrl(trackingId);
  const img = `<img src="${src}" width="1" height="1" alt="" style="display:none;border:0;" />`;
  if (/<\/body\s*>/i.test(html)) {
    return html.replace(/<\/body\s*>/i, `${img}</body>`);
  }
  return `${html}${img}`;
}

/**
 * Réécrit les href http(s) ; ignore mailto:, ancres, liens déjà trackés.
 * @param {string} html
 * @param {string} trackingId
 */
export function rewriteLinksForTracking(html, trackingId) {
  if (!html || typeof html !== "string") return html;
  return html.replace(/\bhref\s*=\s*(["'])((?:\\\1|.)*?)\1/gi, (full, q, hrefRaw) => {
    const href = String(hrefRaw)
      .replace(/\\(.)/g, "$1")
      .trim();
    if (/^mailto:/i.test(href)) return full;
    if (/^#/i.test(href)) return full;
    if (href.includes("/api/mail/track/click/")) return full;
    if (!/^https?:\/\//i.test(href)) return full;
    try {
      const u = new URL(href);
      if (u.protocol !== "http:" && u.protocol !== "https:") return full;
    } catch {
      return full;
    }
    const wrapped = buildClickThroughUrl(trackingId, href);
    return `href=${q}${wrapped}${q}`;
  });
}

/**
 * Applique réécriture puis pixel (ordre spec).
 * @param {string} html
 * @param {string} trackingId
 */
export function applyTrackingToHtml(html, trackingId) {
  let h = rewriteLinksForTracking(html, trackingId);
  h = injectTrackingPixel(h, trackingId);
  return h;
}

/**
 * @param {string} trackingId
 */
export async function resolveMessageByTrackingId(trackingId) {
  if (!isValidTrackingUuid(trackingId)) return null;
  const r = await pool.query(`SELECT * FROM mail_messages WHERE tracking_id = $1 LIMIT 1`, [trackingId.trim()]);
  return r.rows[0] || null;
}

/**
 * @param {{ trackingId: string, ip?: string | null, userAgent?: string | null }} p
 */
export async function registerOpenEvent(p) {
  const { trackingId, ip = null, userAgent = null } = p;
  const row = await resolveMessageByTrackingId(trackingId);
  if (!row) return { ok: false, code: "NOT_FOUND" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO mail_tracking_events (organization_id, mail_message_id, type, ip, user_agent, url)
       VALUES ($1, $2, 'OPEN', $3, $4, NULL)`,
      [row.organization_id, row.id, ip, userAgent]
    );
    await client.query(`UPDATE mail_messages SET opened_at = COALESCE(opened_at, now()) WHERE id = $1`, [row.id]);
    await client.query("COMMIT");
    emitEventAsync("MAIL_OPENED", {
      organizationId: row.organization_id,
      messageId: row.id,
      threadId: row.mail_thread_id,
      trackingId: trackingId.trim(),
    });
    return { ok: true };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}

/**
 * Valide une URL de redirection (http/https uniquement, longueur raisonnable).
 * @param {string} raw
 */
export function sanitizeRedirectUrl(raw) {
  if (raw == null || typeof raw !== "string") return null;
  const s = raw.trim();
  if (s.length > 8192) return null;
  try {
    const u = new URL(s);
    if (u.protocol !== "http:" && u.protocol !== "https:") return null;
    return u.toString();
  } catch {
    return null;
  }
}

/**
 * @param {{ trackingId: string, url: string, ip?: string | null, userAgent?: string | null }} p
 */
export async function registerClickEvent(p) {
  const { trackingId, url, ip = null, userAgent = null } = p;
  const target = sanitizeRedirectUrl(url);
  if (!target) return { ok: false, code: "BAD_URL" };

  const row = await resolveMessageByTrackingId(trackingId);
  if (!row) return { ok: false, code: "NOT_FOUND" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `INSERT INTO mail_tracking_events (organization_id, mail_message_id, type, ip, user_agent, url)
       VALUES ($1, $2, 'CLICK', $3, $4, $5)`,
      [row.organization_id, row.id, ip, userAgent, target]
    );
    await client.query(`UPDATE mail_messages SET clicked_at = COALESCE(clicked_at, now()) WHERE id = $1`, [row.id]);
    await client.query("COMMIT");
    emitEventAsync("MAIL_CLICKED", {
      organizationId: row.organization_id,
      messageId: row.id,
      threadId: row.mail_thread_id,
      trackingId: String(trackingId).trim(),
      url: target,
    });
    return { ok: true, redirectUrl: target };
  } catch (e) {
    await client.query("ROLLBACK");
    throw e;
  } finally {
    client.release();
  }
}
