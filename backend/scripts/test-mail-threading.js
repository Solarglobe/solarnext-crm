#!/usr/bin/env node
/**
 * CP-073 — Tests moteur threading.
 * Usage : node --env-file=./.env scripts/test-mail-threading.js
 */

import assert from "assert";
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import {
  normalizeSubjectForThreading,
  isWeakThreadingSubject,
  resolveThreadForMessage,
  rebuildThreadMetadata,
  MESSAGE_PIVOT_SQL,
} from "../services/mail/mailThreading.service.js";
import { pool } from "../config/db.js";

function section(name) {
  console.log(`\n— ${name}`);
}

async function testPure() {
  section("A — helpers");
  assert.strictEqual(normalizeSubjectForThreading("Re: Devis solaire "), "devis solaire");
  assert.strictEqual(normalizeSubjectForThreading("FWD: RE: Devis solaire "), "devis solaire");
  assert.strictEqual(isWeakThreadingSubject("ok"), true);
  assert.strictEqual(isWeakThreadingSubject("devis photovoltaïque long"), false);
}

/**
 * @returns {import('pg').PoolClient}
 */
function mockClient(queries) {
  let i = 0;
  return {
    async query(sql, params) {
      const fn = queries[i];
      i += 1;
      if (typeof fn === "function") return fn(sql, params);
      return fn;
    },
  };
}

async function testResolve() {
  section("B — résolution (mocks)");

  const org = "00000000-0000-0000-0000-000000000001";
  const acc = "00000000-0000-0000-0000-000000000002";

  const c1 = mockClient([
    () => ({ rows: [{ mail_thread_id: "t-ir" }] }),
  ]);
  const r1 = await resolveThreadForMessage(c1, {
    organizationId: org,
    mailAccountId: acc,
    accountEmail: "a@x.com",
    messageId: "<m@x>",
    inReplyTo: "<parent@x>",
    referencesIds: [],
    subject: "Sujet",
    messageDate: new Date(),
    participantEmails: ["b@y.com"],
  });
  assert.deepStrictEqual(r1, { threadId: "t-ir", resolution: "IN_REPLY_TO" });

  const c2 = mockClient([
    () => ({ rows: [] }),
    () => ({ rows: [{ mail_thread_id: "t-ref" }] }),
  ]);
  const r2 = await resolveThreadForMessage(c2, {
    organizationId: org,
    mailAccountId: acc,
    accountEmail: "a@x.com",
    messageId: null,
    inReplyTo: null,
    referencesIds: ["<old@x>", "<mid@x>"],
    subject: "Re: Hello",
    messageDate: new Date(),
    participantEmails: ["b@y.com"],
  });
  assert.deepStrictEqual(r2, { threadId: "t-ref", resolution: "REFERENCES" });

  const c3 = mockClient([() => ({ rows: [{ mail_thread_id: "t-mid" }] })]);
  const r3 = await resolveThreadForMessage(c3, {
    organizationId: org,
    mailAccountId: acc,
    accountEmail: "a@x.com",
    messageId: "<dup@x>",
    inReplyTo: null,
    referencesIds: [],
    subject: "Test",
    messageDate: new Date(),
    participantEmails: [],
  });
  assert.deepStrictEqual(r3, { threadId: "t-mid", resolution: "MESSAGE_ID" });

  const c4 = mockClient([
    () => ({
      rows: [
        {
          id: "th-sub",
          last_message_at: new Date(),
        },
      ],
    }),
    () => ({ rows: [{ e: "b@y.com" }] }),
  ]);
  const r4 = await resolveThreadForMessage(c4, {
    organizationId: org,
    mailAccountId: acc,
    accountEmail: "a@x.com",
    messageId: null,
    inReplyTo: null,
    referencesIds: [],
    subject: "Projet panneaux 2026",
    messageDate: new Date(),
    participantEmails: ["b@y.com"],
  });
  assert.deepStrictEqual(r4, { threadId: "th-sub", resolution: "SUBJECT_FALLBACK" });

  const c5 = mockClient([() => ({ rows: [] })]);
  const r5 = await resolveThreadForMessage(c5, {
    organizationId: org,
    mailAccountId: acc,
    accountEmail: "a@x.com",
    messageId: null,
    inReplyTo: null,
    referencesIds: [],
    subject: "merci",
    messageDate: new Date(),
    participantEmails: ["b@y.com"],
  });
  assert.deepStrictEqual(r5, { threadId: null, resolution: "NEW_THREAD" });

  const c6 = mockClient([() => ({ rows: [] })]);
  const r6 = await resolveThreadForMessage(c6, {
    organizationId: org,
    mailAccountId: acc,
    accountEmail: "a@x.com",
    messageId: null,
    inReplyTo: null,
    referencesIds: [],
    subject: "Projet long titre unique",
    messageDate: new Date(Date.now() - 40 * 24 * 3600 * 1000),
    participantEmails: ["b@y.com"],
  });
  assert.deepStrictEqual(r6, { threadId: null, resolution: "NEW_THREAD" });

  const c7 = mockClient([() => ({ rows: [] })]);
  const r7 = await resolveThreadForMessage(c7, {
    organizationId: org,
    mailAccountId: acc,
    accountEmail: "a@x.com",
    messageId: null,
    inReplyTo: null,
    referencesIds: [],
    subject: "Tout neuf",
    messageDate: new Date(),
    participantEmails: ["z@z.com"],
  });
  assert.deepStrictEqual(r7, { threadId: null, resolution: "NEW_THREAD" });
}

async function testRebuildDb() {
  section("C — rebuildThreadMetadata (DB)");
  if (!process.env.DATABASE_URL) {
    console.log("skip");
    return;
  }
  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    const org = await c.query(`SELECT id FROM organizations LIMIT 1`);
    if (!org.rows.length) {
      await c.query("ROLLBACK");
      console.log("skip (no org)");
      return;
    }
    const oid = org.rows[0].id;
    const th = await c.query(
      `INSERT INTO mail_threads (organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count, normalized_subject)
       VALUES ($1, 's', 'sn', now(), false, true, 0, 's')
       RETURNING id`,
      [oid]
    );
    const tid = th.rows[0].id;
    const acc = await c.query(`SELECT id, email FROM mail_accounts WHERE organization_id = $1 LIMIT 1`, [oid]);
    if (!acc.rows.length) {
      await c.query("ROLLBACK");
      console.log("skip (no mail account)");
      return;
    }
    const mailAccountId = acc.rows[0].id;
    const folder = await c.query(
      `SELECT id FROM mail_folders WHERE organization_id = $1 AND mail_account_id = $2 LIMIT 1`,
      [oid, mailAccountId]
    );
    if (!folder.rows.length) {
      await c.query("ROLLBACK");
      console.log("skip (no folder)");
      return;
    }
    const fid = folder.rows[0].id;
    await c.query(
      `INSERT INTO mail_messages (
        organization_id, mail_thread_id, mail_account_id, folder_id,
        message_id, subject, body_text, direction, status,
        sent_at, received_at, is_read, has_attachments
      ) VALUES ($1, $2, $3, $4, '<m1@t>', 'sub', 'hello', 'INBOUND', 'RECEIVED', now(), now(), false, false)`,
      [oid, tid, mailAccountId, fid]
    );
    await rebuildThreadMetadata({ client: c, threadId: tid });
    const chk = await c.query(`SELECT message_count, last_message_id, has_unread FROM mail_threads WHERE id = $1`, [tid]);
    assert.strictEqual(chk.rows[0].message_count, 1);
    assert.ok(chk.rows[0].last_message_id);
    assert.strictEqual(chk.rows[0].has_unread, true);
    await c.query("ROLLBACK");
    console.log("rebuild OK (rolled back)");
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
  await testPure();
  await testResolve();
  await testRebuildDb();
  assert.ok(MESSAGE_PIVOT_SQL.includes("received_at"));
  console.log("\nMAIL THREADING OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
