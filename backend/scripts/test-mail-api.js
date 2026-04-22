#!/usr/bin/env node
/**
 * CP-076 — Tests API mail (service + accès).
 * Usage : node --env-file=./.env scripts/test-mail-api.js
 */

import assert from "assert";
import "../config/load-env.js";
import { pool } from "../config/db.js";
import {
  listMailInbox,
  getMailThreadDetail,
  markMessageReadInTransaction,
  archiveThreadInTransaction,
} from "../services/mail/mailApi.service.js";

function section(name) {
  console.log(`\n— ${name}`);
}

async function testEmptyInbox() {
  section("A — inbox sans compte accessible");
  const r = await listMailInbox(pool, {
    organizationId: "00000000-0000-0000-0000-000000000001",
    accessibleAccountIds: new Set(),
    limit: 10,
    offset: 0,
    filter: "all",
  });
  assert.strictEqual(r.total, 0);
  assert.deepStrictEqual(r.items, []);
  console.log("OK");
}

async function testDbFlow() {
  section("B — DB (service, rollback)");
  if (!process.env.DATABASE_URL) {
    console.log("skip");
    return;
  }

  const c = await pool.connect();
  try {
    await c.query("BEGIN");

    const org = await c.query(`SELECT id FROM organizations LIMIT 1`);
    if (org.rows.length === 0) {
      await c.query("ROLLBACK");
      console.log("skip (no org)");
      return;
    }
    const organizationId = org.rows[0].id;

    const u = await c.query(`SELECT id FROM users WHERE organization_id = $1 LIMIT 1`, [organizationId]);
    const userId = u.rows[0]?.id ?? null;

    const email = `api-mail-${Date.now()}@solarnext-mail-api.test`;
    const accIns = await c.query(
      `INSERT INTO mail_accounts (
        organization_id, user_id, email, display_name,
        encrypted_credentials, is_shared, is_active
      ) VALUES ($1, $2, $3, 'API test', '{}'::jsonb, false, true)
      RETURNING id`,
      [organizationId, userId, email]
    );
    const mailAccountId = accIns.rows[0].id;

    const folderIns = await c.query(
      `INSERT INTO mail_folders (organization_id, mail_account_id, name, type, external_id)
       VALUES ($1, $2, 'INBOX', 'INBOX', 'INBOX')
       RETURNING id`,
      [organizationId, mailAccountId]
    );
    const folderId = folderIns.rows[0].id;

    const th = await c.query(
      `INSERT INTO mail_threads (
        organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count,
        normalized_subject
      ) VALUES ($1, 'API subject', 'snippet', now(), false, true, 0, 'api subject')
       RETURNING id`,
      [organizationId]
    );
    const threadId = th.rows[0].id;

    const msg = await c.query(
      `INSERT INTO mail_messages (
        organization_id, mail_thread_id, mail_account_id, folder_id,
        message_id, subject, body_text, body_html,
        direction, status, sent_at, received_at, is_read, has_attachments,
        external_uid
      ) VALUES (
        $1, $2, $3, $4,
        '<api-test@local>', 'API subject', 'body text', null,
        'INBOUND', 'RECEIVED', now(), now(), false, false,
        777777001
      )
      RETURNING id`,
      [organizationId, threadId, mailAccountId, folderId]
    );
    const messageId = msg.rows[0].id;

    await c.query(
      `INSERT INTO mail_participants (organization_id, mail_message_id, type, email, name)
       VALUES ($1, $2, 'FROM', 'ext@test.local', 'Ext')`,
      [organizationId, messageId]
    );

    const { rebuildThreadMetadata } = await import("../services/mail/mailThreading.service.js");
    await rebuildThreadMetadata({ client: c, threadId });

    const accessible = new Set([mailAccountId]);

    const inbox = await listMailInbox(c, {
      organizationId,
      accessibleAccountIds: accessible,
      limit: 20,
      offset: 0,
      filter: "all",
    });
    assert.ok(inbox.total >= 1);
    assert.ok(inbox.items.some((x) => x.threadId === threadId));

    const unreadOnly = await listMailInbox(c, {
      organizationId,
      accessibleAccountIds: accessible,
      filter: "unread",
    });
    assert.ok(unreadOnly.items.length >= 1);

    const detail = await getMailThreadDetail(c, {
      organizationId,
      threadId,
      accessibleAccountIds: accessible,
    });
    assert.ok(detail);
    assert.strictEqual(detail.messages.length, 1);
    assert.strictEqual(detail.messages[0].id, messageId);

    await markMessageReadInTransaction(c, {
      organizationId,
      messageId,
      isRead: true,
      accessibleAccountIds: accessible,
    });
    const afterRead = await c.query(`SELECT is_read FROM mail_messages WHERE id = $1`, [messageId]);
    assert.strictEqual(afterRead.rows[0].is_read, true);

    await archiveThreadInTransaction(c, {
      organizationId,
      threadId,
      accessibleAccountIds: accessible,
    });
    const arch = await c.query(`SELECT archived_at FROM mail_threads WHERE id = $1`, [threadId]);
    assert.ok(arch.rows[0].archived_at != null);

    const inboxAfter = await listMailInbox(c, {
      organizationId,
      accessibleAccountIds: accessible,
    });
    assert.ok(!inboxAfter.items.some((x) => x.threadId === threadId));

    const noDetail = await getMailThreadDetail(c, {
      organizationId,
      threadId,
      accessibleAccountIds: accessible,
    });
    assert.strictEqual(noDetail, null);

    const detailInc = await getMailThreadDetail(c, {
      organizationId,
      threadId,
      accessibleAccountIds: accessible,
      includeArchived: true,
    });
    assert.ok(detailInc);

    const denied = await getMailThreadDetail(c, {
      organizationId,
      threadId,
      accessibleAccountIds: new Set(),
    });
    assert.strictEqual(denied, null);

    await c.query("ROLLBACK");
    console.log("DB flow OK (rolled back)");
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

async function main() {
  await testEmptyInbox();
  await testDbFlow();
  console.log("\nMAIL API OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
