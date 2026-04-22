#!/usr/bin/env node
/**
 * CP-082 — Tests tracking mail (service + DB).
 * Usage : node --env-file=./.env scripts/test-mail-tracking.js
 */

import assert from "assert";
import "../config/load-env.js";
import { pool } from "../config/db.js";
import {
  applyTrackingToHtml,
  generateTrackingId,
  getTrackingPixelPngBuffer,
  isMailTrackingEnabled,
  registerClickEvent,
  registerOpenEvent,
  resolveMessageByTrackingId,
} from "../services/mail/mailTracking.service.js";

async function pickOrgAccount() {
  const org = await pool.query(`SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1`);
  if (!org.rows.length) return null;
  const organizationId = org.rows[0].id;
  const ma = await pool.query(
    `SELECT id FROM mail_accounts WHERE organization_id = $1 AND is_active = true LIMIT 1`,
    [organizationId]
  );
  if (!ma.rows.length) return null;
  return { organizationId, mailAccountId: ma.rows[0].id };
}

async function main() {
  process.env.MAIL_TRACKING_ENABLED = "true";
  process.env.MAIL_TRACKING_PUBLIC_BASE_URL = process.env.MAIL_TRACKING_PUBLIC_BASE_URL || "http://127.0.0.1:3000";

  assert.strictEqual(isMailTrackingEnabled(), true);
  const tid = generateTrackingId();
  assert.ok(tid.length > 30);

  const html =
    '<html><body><p>Hi</p><a href="https://example.com/page">x</a><a href="mailto:a@b.com">m</a></body></html>';
  const out = applyTrackingToHtml(html, tid);
  assert.ok(out.includes("/api/mail/track/open/"), "pixel open");
  assert.ok(out.includes("/api/mail/track/click/"), "rewrite click");
  assert.ok(out.includes(encodeURIComponent("https://example.com/page")), "url enc");
  assert.ok(out.includes('href="mailto:a@b.com"'), "mailto non réécrit");

  assert.strictEqual(applyTrackingToHtml("", tid), "");
  assert.strictEqual(applyTrackingToHtml(null, tid), null);

  const png = getTrackingPixelPngBuffer();
  assert.ok(png.length > 50);
  assert.strictEqual(png.slice(0, 8).toString("hex"), "89504e470d0a1a0a");

  const ctx = await pickOrgAccount();
  if (!ctx) {
    console.log("skip DB (no org/account)");
    console.log("MAIL TRACKING OK");
    await pool.end();
    return;
  }

  const { organizationId, mailAccountId } = ctx;
  const trackingId = generateTrackingId();

  const th = await pool.query(
    `INSERT INTO mail_threads (
       organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count, normalized_subject
     ) VALUES ($1, $2, $3, now(), true, false, 0, $4)
     RETURNING id`,
    [organizationId, "track test", "s", "track test"]
  );
  const threadId = th.rows[0].id;

  const msgIns = await pool.query(
    `INSERT INTO mail_messages (
       organization_id, mail_thread_id, mail_account_id, folder_id,
       message_id, in_reply_to, references_ids,
       subject, body_text, body_html,
       direction, status, sent_at, received_at,
       is_read, has_attachments,
       failure_code, failure_reason, retry_count, last_retry_at, provider_response,
       tracking_id
     ) VALUES (
       $1, $2, $3, NULL,
       NULL, NULL, NULL,
       't', 'txt', '<p>h</p>',
       'OUTBOUND', 'SENT'::mail_message_status, now(), NULL,
       true, false,
       NULL, NULL, 0, NULL, NULL,
       $4
     ) RETURNING id`,
    [organizationId, threadId, mailAccountId, trackingId]
  );
  const messageId = msgIns.rows[0].id;

  try {
    const row = await resolveMessageByTrackingId(trackingId);
    assert.strictEqual(row?.id, messageId);

    await registerOpenEvent({ trackingId, ip: "1.2.3.4", userAgent: "test" });
    const o1 = await pool.query(`SELECT opened_at FROM mail_messages WHERE id = $1`, [messageId]);
    assert.ok(o1.rows[0].opened_at);

    const ev = await pool.query(
      `SELECT type FROM mail_tracking_events WHERE mail_message_id = $1 ORDER BY created_at DESC LIMIT 1`,
      [messageId]
    );
    assert.strictEqual(ev.rows[0].type, "OPEN");

    const rClick = await registerClickEvent({
      trackingId,
      url: "https://safe.example/path",
      ip: "5.6.7.8",
      userAgent: "Mozilla",
    });
    assert.strictEqual(rClick.ok, true);
    const c1 = await pool.query(`SELECT clicked_at FROM mail_messages WHERE id = $1`, [messageId]);
    assert.ok(c1.rows[0].clicked_at);
  } finally {
    await pool.query(`DELETE FROM mail_messages WHERE id = $1`, [messageId]);
    await pool.query(`DELETE FROM mail_threads WHERE id = $1`, [threadId]);
  }

  console.log("MAIL TRACKING OK");
  await pool.end();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
