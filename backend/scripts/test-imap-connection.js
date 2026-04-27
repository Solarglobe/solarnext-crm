/**
 * CP-070 — Script de validation connecteur IMAP + chiffrement.
 * Usage : node --env-file=./.env scripts/test-imap-connection.js
 *
 * Variables optionnelles (test live) :
 *   IMAP_TEST_HOST, IMAP_TEST_PORT, IMAP_TEST_SECURE, IMAP_TEST_USER, IMAP_TEST_PASSWORD
 *   IMAP_SAVE_TEST=1 — enregistre puis supprime un compte (même creds + DB requis).
 */

import crypto from "crypto";
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { encrypt, decrypt } from "../services/security/encryption.service.js";
import {
  testImapConnection,
  getMailboxes,
  saveMailAccount,
  ImapErrorCodes,
} from "../services/mail/imap.service.js";
import { pool } from "../config/db.js";

function ensureEncryptionKeyForDev() {
  if (!String(process.env.MAIL_ENCRYPTION_KEY || "").trim()) {
    process.env.MAIL_ENCRYPTION_KEY = crypto.randomBytes(32).toString("base64");
    console.log("[test-imap] MAIL_ENCRYPTION_KEY absent — clé temporaire générée (dev uniquement)");
  }
}

async function main() {
  ensureEncryptionKeyForDev();

  const secret = "roundtrip-secret-ütf8";
  const enc = encrypt(secret);
  const dec = decrypt(enc);
  if (dec !== secret) {
    throw new Error("encrypt/decrypt roundtrip échoué");
  }
  console.log("OK chiffrement AES-256-GCM");

  let sawExpectedFailure = false;
  try {
    await testImapConnection({
      host: "127.0.0.1",
      port: 1,
      secure: false,
      auth: { user: "nobody", password: "bad" },
      connectionTimeoutMs: 2000,
    });
  } catch (e) {
    if (
      e.code === ImapErrorCodes.CONNECTION_TIMEOUT ||
      e.code === ImapErrorCodes.UNKNOWN ||
      e.code === ImapErrorCodes.AUTH_FAILED
    ) {
      sawExpectedFailure = true;
    }
  }
  if (!sawExpectedFailure) {
    throw new Error("connexion invalide attendue (127.0.0.1:1) — comportement inattendu");
  }
  console.log("OK rejet connexion invalide (code:", ImapErrorCodes.CONNECTION_TIMEOUT, "ou équivalent)");

  const h = process.env.IMAP_TEST_HOST;
  const u = process.env.IMAP_TEST_USER;
  const p = process.env.IMAP_TEST_PASSWORD;
  const port = process.env.IMAP_TEST_PORT ? Number(process.env.IMAP_TEST_PORT) : 993;
  const sec = process.env.IMAP_TEST_SECURE !== "0" && process.env.IMAP_TEST_SECURE !== "false";

  if (h && u && p) {
    const cfg = { host: h, port, secure: sec, auth: { user: u, password: p } };
    await testImapConnection(cfg);
    console.log("OK test IMAP live (INBOX)");

    const boxes = await getMailboxes(cfg);
    if (!Array.isArray(boxes) || boxes.length === 0) {
      throw new Error("getMailboxes: liste vide");
    }
    console.log(`OK dossiers IMAP (${boxes.length}) — ex.`, boxes.slice(0, 3));

    if (process.env.IMAP_SAVE_TEST === "1") {
      const ur = await pool.query(
        `SELECT u.id AS user_id, u.organization_id
         FROM users u
         LIMIT 1`
      );
      if (ur.rows.length === 0) {
        throw new Error("IMAP_SAVE_TEST=1 mais aucun user en base");
      }
      const { user_id: userId, organization_id: organizationId } = ur.rows[0];
      const email = `imap-conn-test-${Date.now()}@local.invalid`;
      const saved = await saveMailAccount({
        organizationId,
        userId,
        email,
        displayName: "CP-070 script",
        isShared: false,
        imap: { host: h, port, secure: sec },
        smtp: null,
        password: p,
      });
      await pool.query(`DELETE FROM mail_accounts WHERE id = $1`, [saved.id]);
      console.log("OK création compte + rollback (ligne supprimée)");
    }
  } else {
    console.log("SKIP test IMAP live (définir IMAP_TEST_HOST, IMAP_TEST_USER, IMAP_TEST_PASSWORD)");
  }

  console.log("IMAP CONNECTOR OK");
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
