/**
 * CP-071 — Validation connecteur SMTP + persistance.
 * node --env-file=./.env scripts/test-smtp-send.js
 *
 * Live (optionnel) : SMTP_TEST_HOST, SMTP_TEST_PORT, SMTP_TEST_SECURE, SMTP_TEST_USER,
 * SMTP_TEST_PASSWORD, SMTP_TEST_TO — crée un compte test puis envoie puis supprime.
 */

import crypto from "crypto";
import "../config/load-env.js";
import { encrypt, decrypt, encryptJson } from "../services/security/encryption.service.js";
import {
  createSmtpTransport,
  testSmtpConnection,
  sendMailViaSmtp,
  inferSmtpFailureCode,
  SmtpErrorCodes,
} from "../services/mail/smtp.service.js";
import { persistOutboundInTransaction } from "../services/mail/mailSendPersistence.service.js";
import { pool } from "../config/db.js";

function ensureEncryptionKeyForDev() {
  if (!String(process.env.MAIL_ENCRYPTION_KEY || "").trim()) {
    process.env.MAIL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    console.log("[test-smtp] MAIL_ENCRYPTION_KEY absent — clé temporaire (dev)");
  }
}

async function testPersistFailedRollup() {
  const ur = await pool.query(
    `SELECT u.id AS user_id, u.organization_id
     FROM users u
     LIMIT 1`
  );
  if (ur.rows.length === 0) {
    console.log("SKIP persistance FAILED (aucun user)");
    return;
  }
  const { user_id: userId, organization_id: organizationId } = ur.rows[0];
  const email = `smtp-persist-${Date.now()}@local.test`;
  const enc = encryptJson({ v: 1, password: "secret" });
  const acc = await pool.query(
    `INSERT INTO mail_accounts (
      organization_id, user_id, email,
      imap_host, imap_port, imap_secure,
      smtp_host, smtp_port, smtp_secure,
      encrypted_credentials, is_shared, is_active
    ) VALUES (
      $1, $2, $3,
      '127.0.0.1', 1143, false,
      '127.0.0.1', 1143, false,
      $4::jsonb, false, true
    ) RETURNING id`,
    [organizationId, userId, email, enc]
  );
  const mailAccountId = acc.rows[0].id;

  const c = await pool.connect();
  try {
    await c.query("BEGIN");
    await persistOutboundInTransaction(c, {
      organizationId,
      mailAccountId,
      accountEmail: email,
      accountDisplayName: "Test",
      fromName: null,
      subject: "Échec simulé",
      bodyText: "corps",
      bodyHtml: null,
      to: ["dest@test.local"],
      cc: [],
      bcc: [],
      replyTo: null,
      inReplyTo: null,
      referencesIds: null,
      smtpMessageId: null,
      status: "FAILED",
      sentAt: null,
      folderId: null,
      failureCode: SmtpErrorCodes.SEND_FAILED,
      failureReason: "simulation",
      providerResponse: "test",
      hasAttachments: false,
      attachmentRows: [],
    });
    await c.query("ROLLBACK");
  } finally {
    c.release();
  }

  await pool.query(`DELETE FROM mail_accounts WHERE id = $1`, [mailAccountId]);
  console.log("OK persistance FAILED (transaction rollback)");
}

async function main() {
  ensureEncryptionKeyForDev();

  const s = "smtp-secret";
  const e = encrypt(s);
  if (decrypt(e) !== s) throw new Error("chiffrement");
  console.log("OK chiffrement");

  let sawBad = false;
  try {
    const t = createSmtpTransport({
      smtp_host: "127.0.0.1",
      smtp_port: 1,
      smtp_secure: false,
      email: "a@b.c",
      password: "x",
    });
    await t.verify();
    t.close();
  } catch (err) {
    sawBad = true;
    const code = inferSmtpFailureCode(err);
    if (![SmtpErrorCodes.SMTP_UNAVAILABLE, SmtpErrorCodes.AUTH_FAILED, SmtpErrorCodes.SEND_FAILED].includes(code)) {
      throw new Error(`code inattendu: ${code}`);
    }
  }
  if (!sawBad) throw new Error("transport invalide attendu");
  console.log("OK erreur SMTP normalisée (connexion refusée / indispo)");

  await testPersistFailedRollup();

  const H = process.env.SMTP_TEST_HOST;
  const U = process.env.SMTP_TEST_USER;
  const P = process.env.SMTP_TEST_PASSWORD;
  const TO = process.env.SMTP_TEST_TO;
  const port = process.env.SMTP_TEST_PORT ? Number(process.env.SMTP_TEST_PORT) : 587;
  const sec = process.env.SMTP_TEST_SECURE === "1" || process.env.SMTP_TEST_SECURE === "true";

  if (H && U && P && TO) {
    await testSmtpConnection({
      smtp_host: H,
      smtp_port: port,
      smtp_secure: sec,
      email: U,
      password: P,
    });
    console.log("OK test SMTP verify live");

    const ur = await pool.query(
      `SELECT u.id AS user_id, u.organization_id
       FROM users u
       LIMIT 1`
    );
    if (ur.rows.length === 0) throw new Error("user requis pour envoi live");
    const { user_id: userId, organization_id: organizationId } = ur.rows[0];
    const email = `smtp-live-${Date.now()}@local.test`;
    const enc = encryptJson({ v: 1, password: P });
  const acc = await pool.query(
    `INSERT INTO mail_accounts (
      organization_id, user_id, email,
      imap_host, imap_port, imap_secure,
      smtp_host, smtp_port, smtp_secure,
      encrypted_credentials, is_shared, is_active
    ) VALUES (
      $1, $2, $3,
      $4, $5, $6,
      $4, $5, $6,
      $7::jsonb, false, true
    ) RETURNING id`,
    [organizationId, userId, email, H, port, sec, enc]
  );
    const mailAccountId = acc.rows[0].id;

    const out = await sendMailViaSmtp({
      mailAccountId,
      organizationId,
      actorUserId: userId,
      to: TO,
      subject: "CP-071 test SMTP",
      bodyText: "Hello SMTP",
      bodyHtml: "<p>Hello <b>SMTP</b></p>",
    });

    if (!out.success || !out.persisted?.messageId) {
      throw new Error("envoi live incomplet");
    }

    const tid = out.persisted.threadId;
    await pool.query(`DELETE FROM mail_messages WHERE mail_account_id = $1`, [mailAccountId]);
    await pool.query(`DELETE FROM mail_threads WHERE id = $1`, [tid]);
    await pool.query(`DELETE FROM mail_accounts WHERE id = $1`, [mailAccountId]);

    console.log("OK envoi live + persistance SENT (nettoyé)");
  } else {
    console.log("SKIP SMTP live (SMTP_TEST_* incomplet)");
  }

  console.log("SMTP CONNECTOR OK");
  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  try {
    await pool.end();
  } catch {
    // ignore
  }
  process.exit(1);
});
