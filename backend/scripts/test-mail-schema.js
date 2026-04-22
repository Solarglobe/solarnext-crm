/**
 * CP-068 — Vérifie le schéma mail (inserts + JOIN + améliorations 1775900001000).
 * Usage: node --env-file=./.env scripts/test-mail-schema.js
 * Prérequis: migrations 1775900000000 + 1775900001000 appliquées.
 */

import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import dotenv from "dotenv";
import pg from "pg";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.resolve(__dirname, "../.env") });
dotenv.config({ path: path.resolve(__dirname, "../../.env.dev"), override: false });

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  const client = await pool.connect();
  const suffix = `${Date.now()}`;
  let accountId;
  let threadId;
  let folderId;
  let messageId;
  let orgId;
  let userId;
  let clientRowId;

  try {
    const u = await client.query(
      `SELECT u.id AS user_id, u.organization_id AS org_id
       FROM users u
       LIMIT 1`
    );
    if (u.rows.length === 0) {
      console.error("SKIP: aucun utilisateur en base");
      process.exit(1);
    }
    orgId = u.rows[0].org_id;
    userId = u.rows[0].user_id;

    const cli = await client.query(
      `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [orgId, `CP068-MAIL-${suffix}`, "Test", "MailSchema", `client-${suffix}@test.local`]
    );
    clientRowId = cli.rows[0].id;

    await client.query("BEGIN");

    const acc = await client.query(
      `INSERT INTO mail_accounts (
        organization_id, user_id, email, display_name,
        imap_host, imap_port, imap_secure, smtp_host, smtp_port, smtp_secure,
        encrypted_credentials, is_shared, is_active
      ) VALUES (
        $1, $2, $3, $4,
        'imap.example.com', 993, true, 'smtp.example.com', 465, true,
        $5::jsonb, false, true
      ) RETURNING id`,
      [orgId, userId, `cp068-mail-${suffix}@test.local`, "Compte test", JSON.stringify({ k: "v" })]
    );
    accountId = acc.rows[0].id;

    const th = await client.query(
      `INSERT INTO mail_threads (
        organization_id, subject, snippet, last_message_at, is_read, client_id,
        message_count, has_unread
      )
       VALUES ($1, $2, $3, now(), false, $4, 0, true) RETURNING id`,
      [orgId, "Sujet thread CP-068", "Extrait…", clientRowId]
    );
    threadId = th.rows[0].id;

    const fo = await client.query(
      `INSERT INTO mail_folders (organization_id, mail_account_id, name, type, external_id)
       VALUES ($1, $2, $3, 'INBOX', 'INBOX') RETURNING id`,
      [orgId, accountId, "Boîte de réception"]
    );
    folderId = fo.rows[0].id;

    const midImap = `<cp068-${suffix}@test.local>`;
    const trackingUuid = randomUUID();
    const refChain = [`<ref-a-${suffix}@x>`, `<ref-b-${suffix}@y>`];

    const msg = await client.query(
      `INSERT INTO mail_messages (
        organization_id, mail_thread_id, mail_account_id, folder_id,
        message_id, subject, body_text, direction, status,
        sent_at, received_at, is_read, has_attachments,
        references_ids, tracking_id
      ) VALUES (
        $1, $2, $3, $4,
        $5, $6, $7, 'INBOUND', 'RECEIVED',
        NULL, now(), false, true,
        $8::text[], $9::uuid
      ) RETURNING id, tracking_id`,
      [orgId, threadId, accountId, folderId, midImap, "Hello", "Corps texte", refChain, trackingUuid]
    );
    messageId = msg.rows[0].id;
    if (msg.rows[0].tracking_id !== trackingUuid) {
      throw new Error("tracking_id: valeur persistée incorrecte");
    }

    await client.query(
      `UPDATE mail_threads
       SET last_message_id = $1, message_count = 1, has_unread = true
       WHERE id = $2`,
      [messageId, threadId]
    );

    const thCheck = await client.query(
      `SELECT client_id, last_message_id, message_count, has_unread FROM mail_threads WHERE id = $1`,
      [threadId]
    );
    if (thCheck.rows[0].client_id !== clientRowId) {
      throw new Error("thread.client_id: lien CRM attendu");
    }
    if (thCheck.rows[0].last_message_id !== messageId || thCheck.rows[0].message_count !== 1) {
      throw new Error("thread: last_message_id / message_count incohérents");
    }

    await client.query(
      `INSERT INTO mail_participants (organization_id, mail_message_id, type, email, name)
       VALUES ($1, $2, 'FROM', $3, $4)`,
      [orgId, messageId, "  CamelCase@EXAMPLE.com  ", "Expéditeur"]
    );

    const norm = await client.query(
      `SELECT email_normalized FROM mail_participants
       WHERE mail_message_id = $1 AND type = 'FROM'`,
      [messageId]
    );
    if (norm.rows[0].email_normalized !== "camelcase@example.com") {
      throw new Error(`email_normalized attendu, obtenu: ${norm.rows[0].email_normalized}`);
    }

    const normSearch = await client.query(
      `SELECT id FROM mail_participants
       WHERE email_normalized = $1 AND organization_id = $2`,
      ["camelcase@example.com", orgId]
    );
    if (normSearch.rows.length < 1) {
      throw new Error("recherche par email_normalized: aucune ligne");
    }

    await client.query(
      `INSERT INTO mail_participants (organization_id, mail_message_id, type, email, name)
       VALUES ($1, $2, 'TO', $3, $4)`,
      [orgId, messageId, "dest@test.local", "Destinataire"]
    );

    const refGin = await client.query(
      `SELECT id FROM mail_messages
       WHERE id = $1 AND references_ids @> $2::text[]`,
      [messageId, [`<ref-a-${suffix}@x>`]]
    );
    if (refGin.rows.length !== 1) {
      throw new Error("references_ids (GIN): filtre @> attendu 1 ligne");
    }

    await client.query(
      `INSERT INTO mail_attachments (
        organization_id, mail_message_id, file_name, mime_type, size_bytes, storage_path,
        is_inline, content_id
      ) VALUES ($1, $2, $3, $4, $5, $6, true, $7)`,
      [
        orgId,
        messageId,
        "inline.png",
        "image/png",
        99,
        `org/${orgId}/mail/${messageId}/inline.png`,
        "cid:logo123",
      ]
    );

    await client.query(
      `INSERT INTO mail_account_permissions (
        organization_id, mail_account_id, user_id, can_read, can_send, can_manage
      ) VALUES ($1, $2, $3, true, true, false)`,
      [orgId, accountId, userId]
    );

    const joinRes = await client.query(
      `SELECT
        ma.email AS account_email,
        mt.subject AS thread_subject,
        mt.client_id AS thread_client_id,
        mm.message_id,
        mm.subject AS msg_subject,
        mm.tracking_id,
        mf.name AS folder_name,
        mp_from.email AS from_email,
        m_att.file_name AS attachment_name,
        map.can_read AS perm_read
       FROM mail_messages mm
       INNER JOIN mail_threads mt ON mt.id = mm.mail_thread_id AND mt.organization_id = mm.organization_id
       INNER JOIN mail_accounts ma ON ma.id = mm.mail_account_id AND ma.organization_id = mm.organization_id
       LEFT JOIN mail_folders mf ON mf.id = mm.folder_id
       INNER JOIN mail_participants mp_from ON mp_from.mail_message_id = mm.id AND mp_from.type = 'FROM'
       INNER JOIN mail_attachments m_att ON m_att.mail_message_id = mm.id
       INNER JOIN mail_account_permissions map ON map.mail_account_id = ma.id AND map.user_id = $2
       WHERE mm.id = $1 AND mm.organization_id = $3`,
      [messageId, userId, orgId]
    );

    if (joinRes.rows.length !== 1) {
      throw new Error(`JOIN attendu 1 ligne, obtenu ${joinRes.rows.length}`);
    }
    if (joinRes.rows[0].thread_client_id !== clientRowId) {
      throw new Error("JOIN: client_id thread manquant");
    }
    if (String(joinRes.rows[0].tracking_id) !== trackingUuid) {
      throw new Error("JOIN: tracking_id manquant");
    }

    await client.query("ROLLBACK");

    await client.query("DELETE FROM clients WHERE id = $1", [clientRowId]);
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // ignore
    }
    try {
      if (clientRowId) {
        await client.query("DELETE FROM clients WHERE id = $1", [clientRowId]);
      }
    } catch {
      // ignore
    }
    console.error(e);
    process.exit(1);
  } finally {
    client.release();
    await pool.end();
  }

  console.log("MAIL SCHEMA OK");
  process.exit(0);
}

run();
