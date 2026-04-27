#!/usr/bin/env node
/**
 * CP-074 — Tests rattachement CRM mail.
 * Usage : node --env-file=./.env scripts/test-mail-crm-link.js
 */

import assert from "assert";
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { pool } from "../config/db.js";
import {
  extractRelevantEmailsFromParticipants,
  resolveCrmLinkForMessage,
  applyCrmLinkToThread,
  manualOverrideThreadCrmLink,
  findClientByDomain,
  syncCrmLinkForNewMessage,
  PUBLIC_EMAIL_DOMAINS,
} from "../services/mail/mailCrmLink.service.js";

function section(name) {
  console.log(`\n— ${name}`);
}

async function testPure() {
  section("Helpers");
  const ext = extractRelevantEmailsFromParticipants(
    [{ email: " A@x.com " }, { email: "me@company.fr" }],
    "me@company.fr"
  );
  assert.deepStrictEqual(ext, ["a@x.com"]);
  assert.strictEqual(PUBLIC_EMAIL_DOMAINS.has("gmail.com"), true);
}

async function testWithDb() {
  section("DB (transaction rollback)");
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

    const clientRow = await c.query(
      `INSERT INTO clients (organization_id, client_number, email, company_domain)
       VALUES ($1, 'T-CRM-LINK', 'client.match@test-crm.local', 'entreprise-test.local')
       RETURNING id`,
      [oid]
    );
    const clientId = clientRow.rows[0].id;

    const leadOnly = await c.query(
      `INSERT INTO leads (organization_id, first_name, last_name, email, stage_id, status)
       SELECT $1, 'L', 'ead', 'lead.only@test-crm.local', ps.id, 'LEAD'
       FROM pipeline_stages ps
       WHERE ps.organization_id = $1
       ORDER BY ps.position ASC
       LIMIT 1
       RETURNING id`,
      [oid]
    );
    if (!leadOnly.rows.length) {
      await c.query("ROLLBACK");
      console.log("skip (no pipeline stage)");
      return;
    }
    const leadId = leadOnly.rows[0].id;

    const leadConverted = await c.query(
      `INSERT INTO leads (organization_id, first_name, last_name, email, stage_id, status, client_id)
       SELECT $1, 'C', 'onv', 'converted@test-crm.local', ps.id, 'CLIENT', $2
       FROM pipeline_stages ps
       WHERE ps.organization_id = $1
       ORDER BY ps.position ASC
       LIMIT 1
       RETURNING id, client_id`,
      [oid, clientId]
    );
    const leadConvId = leadConverted.rows[0].id;

    const r1 = await resolveCrmLinkForMessage(c, {
      organizationId: oid,
      participants: [{ email: "client.match@test-crm.local" }],
      accountEmail: "boite@mail.com",
    });
    assert.strictEqual(r1.resolution, "CLIENT_EMAIL");
    assert.strictEqual(r1.clientId, clientId);

    const r2 = await resolveCrmLinkForMessage(c, {
      organizationId: oid,
      participants: [{ email: "lead.only@test-crm.local" }],
      accountEmail: "boite@mail.com",
    });
    assert.strictEqual(r2.resolution, "LEAD_EMAIL");
    assert.strictEqual(r2.leadId, leadId);

    const r3 = await resolveCrmLinkForMessage(c, {
      organizationId: oid,
      participants: [{ email: "user@entreprise-test.local" }],
      accountEmail: "boite@mail.com",
    });
    assert.strictEqual(r3.resolution, "DOMAIN");
    assert.strictEqual(r3.clientId, clientId);

    const r4 = await resolveCrmLinkForMessage(c, {
      organizationId: oid,
      participants: [{ email: "x@gmail.com" }],
      accountEmail: "boite@mail.com",
    });
    assert.strictEqual(
      (await findClientByDomain(c, { organizationId: oid, email: "x@gmail.com" })),
      null
    );
    assert.strictEqual(r4.resolution, "NONE");

    const r5 = await resolveCrmLinkForMessage(c, {
      organizationId: oid,
      participants: [{ email: "a@other.com" }, { email: "b@else.com" }],
      accountEmail: "boite@mail.com",
    });
    assert.strictEqual(r5.resolution, "NONE");

    const th = await c.query(
      `INSERT INTO mail_threads (organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count, normalized_subject, client_id)
       VALUES ($1, 't', 's', now(), true, false, 0, 't', $2)
       RETURNING id`,
      [oid, clientId]
    );
    const threadId = th.rows[0].id;

    const otherClient = await c.query(
      `INSERT INTO clients (organization_id, client_number, email)
       VALUES ($1, 'T-OTHER', 'other@test-crm.local')
       RETURNING id`,
      [oid]
    );
    const otherClientId = otherClient.rows[0].id;

    const autoTry = await applyCrmLinkToThread(c, {
      threadId,
      clientId: otherClientId,
      leadId: null,
      force: false,
    });
    assert.strictEqual(autoTry.applied, false);
    assert.strictEqual(autoTry.reason, "client_locked");

    const thLead = await c.query(
      `INSERT INTO mail_threads (organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count, normalized_subject, lead_id)
       VALUES ($1, 't2', 's', now(), true, false, 0, 't2', $2)
       RETURNING id`,
      [oid, leadId]
    );
    const threadLeadId = thLead.rows[0].id;

    await applyCrmLinkToThread(c, {
      threadId: threadLeadId,
      clientId,
      leadId: null,
      force: false,
    });
    const up = await c.query(`SELECT client_id, lead_id FROM mail_threads WHERE id = $1`, [threadLeadId]);
    assert.strictEqual(up.rows[0].client_id, clientId);
    assert.strictEqual(up.rows[0].lead_id, null);

    const r6 = await resolveCrmLinkForMessage(c, {
      organizationId: oid,
      participants: [{ email: "converted@test-crm.local" }],
      accountEmail: "boite@mail.com",
    });
    assert.strictEqual(r6.resolution, "CLIENT_EMAIL");
    assert.strictEqual(r6.clientId, clientId);

    const th3 = await c.query(
      `INSERT INTO mail_threads (organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count, normalized_subject)
       VALUES ($1, 't3', 's', now(), true, false, 0, 't3')
       RETURNING id`,
      [oid]
    );
    const tid3 = th3.rows[0].id;
    await manualOverrideThreadCrmLink(c, { threadId: tid3, clientId, leadId: null });
    const chk = await c.query(`SELECT client_id FROM mail_threads WHERE id = $1`, [tid3]);
    assert.strictEqual(chk.rows[0].client_id, clientId);

    await c.query("ROLLBACK");
    console.log("DB scenarios OK (rolled back)");
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

async function testPropagation() {
  section("D — syncCrmLinkForNewMessage (fil + messages)");
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

    const ma = await c.query(
      `SELECT id, email FROM mail_accounts WHERE organization_id = $1 LIMIT 1`,
      [oid]
    );
    if (!ma.rows.length) {
      await c.query("ROLLBACK");
      console.log("skip (no mail account)");
      return;
    }
    const mailAccountId = ma.rows[0].id;

    const folder = await c.query(
      `SELECT id FROM mail_folders WHERE organization_id = $1 AND mail_account_id = $2 LIMIT 1`,
      [oid, mailAccountId]
    );
    if (!folder.rows.length) {
      await c.query("ROLLBACK");
      console.log("skip (no folder)");
      return;
    }
    const folderId = folder.rows[0].id;

    const suf = `P${Date.now()}`;
    const cli = await c.query(
      `INSERT INTO clients (organization_id, client_number, email)
       VALUES ($1, $2, 'prop.client@test-crm.local')
       RETURNING id`,
      [oid, `T-CRM-PROP-${suf}`]
    );
    const propClientId = cli.rows[0].id;

    const th = await c.query(
      `INSERT INTO mail_threads (organization_id, subject, snippet, last_message_at, is_read, has_unread, message_count, normalized_subject)
       VALUES ($1, 'p', 's', now(), true, false, 0, 'p')
       RETURNING id`,
      [oid]
    );
    const threadId = th.rows[0].id;

    const msg = await c.query(
      `INSERT INTO mail_messages (
        organization_id, mail_thread_id, mail_account_id, folder_id,
        message_id, subject, body_text, direction, status,
        sent_at, received_at, is_read, has_attachments
      ) VALUES (
        $1, $2, $3, $4,
        '<prop-msg@test>', 'sub', 'x', 'INBOUND', 'RECEIVED', now(), now(), false, false
      )
      RETURNING id`,
      [oid, threadId, mailAccountId, folderId]
    );
    const messageId = msg.rows[0].id;

    await c.query(
      `INSERT INTO mail_participants (organization_id, mail_message_id, type, email, name)
       VALUES ($1, $2, 'FROM', 'prop.client@test-crm.local', 'X')`,
      [oid, messageId]
    );

    const syncR = await syncCrmLinkForNewMessage({ messageId, dbClient: c });
    assert.strictEqual(syncR.ok, true);
    assert.strictEqual(syncR.resolution, "CLIENT_EMAIL");
    assert.strictEqual(syncR.clientId, propClientId);

    const tchk = await c.query(`SELECT client_id, lead_id FROM mail_threads WHERE id = $1`, [threadId]);
    assert.strictEqual(tchk.rows[0].client_id, propClientId);
    const mchk = await c.query(`SELECT client_id FROM mail_messages WHERE id = $1`, [messageId]);
    assert.strictEqual(mchk.rows[0].client_id, propClientId);

    await c.query("ROLLBACK");
    console.log("propagation OK (rolled back)");
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
  await testWithDb();
  await testPropagation();
  console.log("\nMAIL CRM LINK OK");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
