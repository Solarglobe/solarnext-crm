#!/usr/bin/env node
/**
 * CP-072 — Tests sync IMAP (hors ligne + optionnel live).
 * Usage : node --env-file=./.env scripts/test-mail-sync.js
 */

import assert from "assert";
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { createImapClient, getMailboxes } from "../services/mail/imap.service.js";
import {
  INITIAL_IMPORT_LIMIT,
  resolveDirection,
  selectUidsToSync,
  importImapMessage,
} from "../services/mail/mailSync.service.js";
import {
  normalizeSubject,
  parseReferencesHeader,
  findExistingMessageId,
  refreshMailThreadAggregates,
} from "../services/mail/mailSyncPersistence.service.js";
import { resolveThreadForMessage, normalizeSubjectForThreading } from "../services/mail/mailThreading.service.js";
import { pool } from "../config/db.js";

function section(name) {
  console.log(`\n— ${name}`);
}

async function testOffline() {
  section("A — logique hors ligne");

  assert.strictEqual(normalizeSubject("  "), "(Sans objet)");
  assert.strictEqual(normalizeSubjectForThreading("Re: Re: Hello "), "hello");
  assert.strictEqual(
    resolveDirection({
      folderType: "INBOX",
      fromAddr: "A@x.com",
      accountEmail: "a@x.com",
    }),
    "OUTBOUND"
  );
  assert.strictEqual(
    resolveDirection({
      folderType: "INBOX",
      fromAddr: "b@y.com",
      accountEmail: "a@x.com",
    }),
    "INBOUND"
  );
  assert.strictEqual(
    resolveDirection({
      folderType: "SENT",
      fromAddr: "b@y.com",
      accountEmail: "a@x.com",
    }),
    "OUTBOUND"
  );

  const uids = Array.from({ length: 300 }, (_, i) => i + 1);
  const first = selectUidsToSync(uids, false, false, null);
  assert.strictEqual(first.length, INITIAL_IMPORT_LIMIT);
  assert.strictEqual(first[0], 151);

  const inc = selectUidsToSync(uids, true, false, "200");
  assert.deepStrictEqual(
    inc,
    uids.filter((u) => u > 200)
  );

  const refs = parseReferencesHeader("<a@b> <c@d>");
  assert.ok(refs.length >= 1);

  const mockClient = {
    async query(sql, params) {
      if (sql.includes("FROM mail_messages") && sql.includes("in_reply_to")) {
        return { rows: [] };
      }
      if (sql.includes("FROM mail_messages") && sql.includes("message_id = ANY")) {
        return { rows: [] };
      }
      if (sql.includes("FROM mail_threads")) {
        return { rows: [] };
      }
      return { rows: [] };
    },
  };

  const tid = await resolveThreadForMessage(mockClient, {
    organizationId: "00000000-0000-0000-0000-000000000001",
    mailAccountId: "00000000-0000-0000-0000-000000000002",
    accountEmail: "u@test.com",
    messageId: null,
    inReplyTo: null,
    referencesIds: [],
    subject: "Unique subject xyz",
    messageDate: new Date(),
    participantEmails: ["x@y.com"],
  });
  assert.strictEqual(tid.threadId, null);

  console.log("offline assertions OK");
}

async function testDbHelpers() {
  section("B — helpers DB (si DATABASE_URL)");

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

    const th = await c.query(
      `INSERT INTO mail_threads (organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count)
       VALUES ($1, 't', 's', now(), true, false, 0)
       RETURNING id`,
      [organizationId]
    );
    const threadId = th.rows[0].id;

    const acc = await c.query(
      `SELECT id, email FROM mail_accounts WHERE organization_id = $1 LIMIT 1`,
      [organizationId]
    );
    if (acc.rows.length === 0) {
      await c.query("ROLLBACK");
      console.log("skip (no mail_accounts)");
      return;
    }
    const mailAccountId = acc.rows[0].id;
    const accountEmail = acc.rows[0].email;

    const folder = await c.query(
      `SELECT id, type, external_id, name FROM mail_folders
       WHERE organization_id = $1 AND mail_account_id = $2 AND type = 'INBOX' LIMIT 1`,
      [organizationId, mailAccountId]
    );
    if (folder.rows.length === 0) {
      await c.query("ROLLBACK");
      console.log("skip (no INBOX folder)");
      return;
    }
    const folderRow = folder.rows[0];

    const msg = await c.query(
      `INSERT INTO mail_messages (
        organization_id, mail_thread_id, mail_account_id, folder_id,
        message_id, subject, body_text, body_html,
        direction, status, sent_at, received_at, is_read, has_attachments
      ) VALUES (
        $1, $2, $3, $4,
        '<dup-test@x>', 'sub', 'body', null,
        'INBOUND', 'RECEIVED', now(), now(), false, false
      )
      RETURNING id`,
      [organizationId, threadId, mailAccountId, folderRow.id]
    );
    const mid = msg.rows[0].id;

    await c.query(
      `INSERT INTO mail_participants (organization_id, mail_message_id, type, email, name)
       VALUES ($1, $2, 'FROM', 'x@y.com', 'X')`,
      [organizationId, mid]
    );

    await refreshMailThreadAggregates(c, threadId);

    const dup = await findExistingMessageId(c, {
      organizationId,
      mailAccountId,
      folderId: folderRow.id,
      externalUid: 999999001,
      messageId: "<dup-test@x>",
    });
    assert.strictEqual(dup, mid);

    await c.query("ROLLBACK");
    console.log("DB helpers OK (rolled back)");
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

async function testLiveImap() {
  section("C — IMAP live (variables IMAP_TEST_*)");

  const host = process.env.IMAP_TEST_HOST;
  if (!host) {
    console.log("skip (no IMAP_TEST_HOST)");
    return;
  }

  const port = Number(process.env.IMAP_TEST_PORT || "993");
  const secure = process.env.IMAP_TEST_SECURE !== "0" && process.env.IMAP_TEST_SECURE !== "false";
  const user = process.env.IMAP_TEST_USER;
  const password = process.env.IMAP_TEST_PASSWORD;
  if (!user || !password) {
    console.log("skip (IMAP_TEST_USER / PASSWORD manquants)");
    return;
  }

  const cfg = {
    host,
    port,
    secure,
    auth: { user, password },
  };

  const client = await createImapClient(cfg);
  try {
    await client.mailboxOpen("INBOX");
    const uids = await client.search({}, { uid: true });
    assert.ok(Array.isArray(uids));

    const list = await getMailboxes(cfg);
    assert.ok(Array.isArray(list));

    if (!process.env.DATABASE_URL || process.env.IMAP_TEST_FULL_IMPORT !== "1") {
      console.log("live IMAP connect + search OK (set IMAP_TEST_FULL_IMPORT=1 + DATABASE_URL pour import DB)");
      return;
    }

    const acc = await pool.query(
      `SELECT id, organization_id, email FROM mail_accounts WHERE is_active = true LIMIT 1`
    );
    if (acc.rows.length === 0) {
      console.log("skip import (need mail_accounts)");
      return;
    }

    const organizationId = acc.rows[0].organization_id;
    const mailAccount = { id: acc.rows[0].id, email: acc.rows[0].email };
    const folder = await pool.query(
      `SELECT id, type, external_id, name FROM mail_folders
       WHERE mail_account_id = $1 AND type = 'INBOX' LIMIT 1`,
      [mailAccount.id]
    );
    if (folder.rows.length === 0 || !uids.length) {
      console.log("skip import (folder / messages)");
      return;
    }

    const uid = uids[uids.length - 1];
    const folderRow = folder.rows[0];
    const path = folderRow.external_id || folderRow.name;
    await client.mailboxOpen(path);

    const db = await pool.connect();
    try {
      await db.query("BEGIN");
      const r1 = await importImapMessage(db, client, {
        organizationId,
        mailAccount,
        folder: folderRow,
        uid,
      });
      const r2 = await importImapMessage(db, client, {
        organizationId,
        mailAccount,
        folder: folderRow,
        uid,
      });
      assert.ok(!r1.skipped, JSON.stringify(r1));
      assert.strictEqual(r2.skipped, true);
      assert.strictEqual(r2.reason, "duplicate");
      await db.query("ROLLBACK");
      console.log("live import + dedup OK (rolled back)");
    } finally {
      db.release();
    }
  } finally {
    try {
      await client.logout();
    } catch {
      // ignore
    }
  }
}

async function main() {
  await testOffline();
  await testDbHelpers();
  await testLiveImap();
  console.log("\nMAIL SYNC OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
