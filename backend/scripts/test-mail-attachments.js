#!/usr/bin/env node
/**
 * CP-075 — Tests pièces jointes mail → entity_documents.
 * Usage : node --env-file=./.env scripts/test-mail-attachments.js
 */

import assert from "assert";
import { simpleParser } from "mailparser";
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { pool } from "../config/db.js";
import {
  extractAttachmentsFromParsedEmail,
  processAttachmentItemsInTransaction,
  processAttachmentsForMessage,
  MAX_MAIL_ATTACHMENT_BYTES,
} from "../services/mail/mailAttachments.service.js";

const TINY_PDF_B64 =
  "JVBERi0xLjQKJeLjz9MKMSAwIG9iago8PC9UeXBlL0NhdGFsb2cvUGFnZXMgMiAwIFI+PmVuZG9iagoyIDAgb2JqCjw8L1R5cGUvUGFnZXMvS2lkc1szIDAgUl0vQ291bnQgMT4+ZW5kb2JqCjMgMCBvYmoKPDwvVHlwZS9QYWdlL1BhcmVudCAyIDAgUi9NZWRpYUJveFswIDAgMyAzXT4+ZW5kb2JqCnhyZWYKMCA0CjAwMDAwMDAwMDAgNjU1MzUgZiAKMDAwMDAwMDA5IDAwMDAwIG4gCjAwMDAwMDAwNTggMDAwMDAgbiAKMDAwMDAwMTE3IDAwMDAwIG4gCnRyYWlsZXIKPDwvU2l6ZSA0L1Jvb3QgMSAwIFI+PgpzdGFydHhyZWYKMTkyCiUlRU9G";

function buildMultipartMail(extraPart = "") {
  return [
    "From: sender@test.local",
    "To: recipient@test.local",
    "Subject: PJ test",
    "MIME-Version: 1.0",
    'Content-Type: multipart/mixed; boundary="b1"',
    "",
    "--b1",
    "Content-Type: text/plain; charset=utf-8",
    "",
    "Hello",
    "--b1",
    'Content-Type: application/pdf; name="doc.pdf"',
    "Content-Transfer-Encoding: base64",
    "",
    TINY_PDF_B64,
    extraPart,
    "--b1--",
    "",
  ].join("\r\n");
}

function section(name) {
  console.log(`\n— ${name}`);
}

async function testExtractOffline() {
  section("A — extract (offline)");

  const raw = buildMultipartMail();
  const parsed = await simpleParser(Buffer.from(raw));
  const list = extractAttachmentsFromParsedEmail(parsed);
  assert.strictEqual(list.length, 1, "1 PJ attendue");
  assert.strictEqual(list[0].fileName, "doc.pdf");
  assert.ok(list[0].mimeType.includes("pdf"), "mime pdf");
  assert.strictEqual(list[0].isInline, false);
  assert.ok(Buffer.isBuffer(list[0].content));
  assert.strictEqual(list[0].size, list[0].content.length);

  const rawMulti = buildMultipartMail(
    [
      "--b1",
      'Content-Type: image/png; name="x.png"',
      "Content-Transfer-Encoding: base64",
      "Content-ID: <cidimg@test>",
      "Content-Disposition: inline",
      "",
      "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
    ].join("\r\n")
  );
  const parsed2 = await simpleParser(Buffer.from(rawMulti));
  const list2 = extractAttachmentsFromParsedEmail(parsed2);
  assert.strictEqual(list2.length, 2, "2 PJ");
  const inline = list2.find((x) => x.isInline);
  assert.ok(inline, "inline détecté");
  assert.strictEqual(inline?.contentId != null, true);

  console.log("extract OK");
}

async function testDb() {
  section("B — DB (rollback)");

  if (!process.env.DATABASE_URL) {
    console.log("skip (no DATABASE_URL)");
    return;
  }

  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const org = await c.query(`SELECT id FROM organizations LIMIT 1`);
    if (org.rows.length === 0) {
      await c.query("ROLLBACK");
      console.log("skip (no organization)");
      return;
    }
    const organizationId = org.rows[0].id;

    let acc = await c.query(`SELECT id, email FROM mail_accounts WHERE organization_id = $1 LIMIT 1`, [organizationId]);
    if (acc.rows.length === 0) {
      const u = await c.query(`SELECT id FROM users WHERE organization_id = $1 LIMIT 1`, [organizationId]);
      const userId = u.rows[0]?.id ?? null;
      const email = `mail-att-${Date.now()}@solarnext-mail-attach.test`;
      const insA = await c.query(
        `INSERT INTO mail_accounts (
          organization_id, user_id, email, display_name,
          encrypted_credentials, is_shared, is_active
        ) VALUES ($1, $2, $3, 'Test PJ', '{}'::jsonb, false, true)
        RETURNING id, email`,
        [organizationId, userId, email]
      );
      acc = insA;
    }
    const mailAccountId = acc.rows[0].id;

    let folder = await c.query(
      `SELECT id FROM mail_folders
       WHERE organization_id = $1 AND mail_account_id = $2 AND type = 'INBOX' LIMIT 1`,
      [organizationId, mailAccountId]
    );
    if (folder.rows.length === 0) {
      const insF = await c.query(
        `INSERT INTO mail_folders (organization_id, mail_account_id, name, type, external_id)
         VALUES ($1, $2, 'INBOX', 'INBOX', 'INBOX')
         RETURNING id`,
        [organizationId, mailAccountId]
      );
      folder = insF;
    }
    const folderId = folder.rows[0].id;

    const clientIns = await c.query(
      `INSERT INTO clients (organization_id, client_number, email)
       VALUES ($1, 'T-MAIL-ATT', 'pj.client@test-crm.local')
       RETURNING id`,
      [organizationId]
    );
    const crmClientId = clientIns.rows[0].id;

    const th = await c.query(
      `INSERT INTO mail_threads (organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count, normalized_subject)
       VALUES ($1, 'att', 's', now(), true, false, 0, 'att')
       RETURNING id`,
      [organizationId]
    );
    const threadId = th.rows[0].id;

    const msg = await c.query(
      `INSERT INTO mail_messages (
        organization_id, mail_thread_id, mail_account_id, folder_id,
        message_id, subject, body_text, body_html,
        direction, status, sent_at, received_at, is_read, has_attachments,
        external_uid, client_id, lead_id
      ) VALUES (
        $1, $2, $3, $4,
        '<att-test@local>', 'sub', 'b', null,
        'INBOUND', 'RECEIVED', now(), now(), false, true,
        888888001, $5, NULL
      )
      RETURNING id`,
      [organizationId, threadId, mailAccountId, folderId, crmClientId]
    );
    const messageId = msg.rows[0].id;

    const raw = buildMultipartMail();
    const parsed = await simpleParser(Buffer.from(raw));

    const r1 = await processAttachmentsForMessage({
      dbClient: c,
      messageId,
      organizationId,
      parsedMail: parsed,
    });
    assert.ok(r1.stored >= 1, "au moins 1 stockée");

    const doc = await c.query(
      `SELECT id, entity_type, entity_id, document_type, mime_type, is_client_visible
       FROM entity_documents
       WHERE organization_id = $1 AND document_type = 'mail_attachment'
       ORDER BY created_at DESC
       LIMIT 1`,
      [organizationId]
    );
    assert.strictEqual(doc.rows.length, 1);
    assert.strictEqual(doc.rows[0].entity_type, "client");
    assert.strictEqual(doc.rows[0].entity_id, crmClientId);
    assert.strictEqual(doc.rows[0].mime_type.includes("pdf"), true);
    assert.strictEqual(doc.rows[0].is_client_visible, true);

    const ma = await c.query(
      `SELECT id, document_id, content_sha256, is_inline
       FROM mail_attachments
       WHERE mail_message_id = $1`,
      [messageId]
    );
    assert.strictEqual(ma.rows.length, 1);
    assert.strictEqual(ma.rows[0].document_id, doc.rows[0].id);
    assert.ok(ma.rows[0].content_sha256?.length === 64);
    assert.strictEqual(ma.rows[0].is_inline, false);

    const items = extractAttachmentsFromParsedEmail(parsed);
    const rDup = await processAttachmentItemsInTransaction(c, {
      messageId,
      organizationId,
      items,
    });
    assert.strictEqual(rDup.stored, 0);
    assert.ok(rDup.skipped >= 1);

    const raw2 = buildMultipartMail(
      [
        "--b1",
        'Content-Type: application/pdf; name="dup.pdf"',
        "Content-Transfer-Encoding: base64",
        "",
        TINY_PDF_B64,
      ].join("\r\n")
    );
    const parsedDupMime = await simpleParser(Buffer.from(raw2));
    const listDup = extractAttachmentsFromParsedEmail(parsedDupMime);
    assert.strictEqual(listDup.length, 2, "deux fichiers distincts (noms différents)");

    await c.query("ROLLBACK");
    console.log("DB OK (rolled back)");
  } catch (e) {
    try {
      await c.query("ROLLBACK");
    } catch {
      // ignore
    }
    throw e;
  } finally {
    c.release();
  }
}

async function testSizeCap() {
  section("C — limite taille");
  assert.ok(MAX_MAIL_ATTACHMENT_BYTES <= 25 * 1024 * 1024);
  console.log("MAX bytes OK");
}

async function main() {
  await testExtractOffline();
  await testDb();
  await testSizeCap();
  console.log("\nMAIL ATTACHMENTS OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
