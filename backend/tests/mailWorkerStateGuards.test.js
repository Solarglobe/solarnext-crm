import test from "node:test";
import assert from "node:assert/strict";
import { encryptJson } from "../services/security/encryption.service.js";
import { loadActiveMailAccountWithSmtpCredentials } from "../services/mail/smtp.service.js";
import { loadActiveMailAccountWithImapCredentials } from "../services/mail/mailImapFlagsProvider.service.js";
import { applyMove } from "../services/mail/mailImapMoveProvider.service.js";

process.env.MAIL_ENCRYPTION_KEY ||= "0000000000000000000000000000000000000000000000000000000000000000";

const encrypted = () => encryptJson({
  imap_user: "user@example.com",
  imap_password: "secret",
  smtp_user: "user@example.com",
  smtp_password: "secret",
});

function dbWithAccount(row) {
  return {
    remoteCalls: 0,
    async query(sql) {
      if (String(sql).includes("FROM mail_accounts")) {
        return { rows: [{ email: "user@example.com", encrypted_credentials: encrypted(), ...row }] };
      }
      this.remoteCalls += 1;
      return { rows: [] };
    },
  };
}

test("outbox worker boundary refuse SMTP si compte desactive apres claim", async () => {
  const db = dbWithAccount({
    id: "acc",
    organization_id: "org",
    is_active: false,
    lifecycle_state: "DISABLED",
    sync_enabled: false,
    smtp_host: "smtp.example.com",
    smtp_port: 587,
    smtp_secure: false,
  });
  await assert.rejects(
    loadActiveMailAccountWithSmtpCredentials(db, { organizationId: "org", mailAccountId: "acc" }),
    (e) => e.code === "MAIL_ACCOUNT_STATE_BLOCKED"
  );
  assert.equal(db.remoteCalls, 0);
});

test("flag worker boundary refuse IMAP si compte deconnecte apres claim", async () => {
  const db = dbWithAccount({
    id: "acc",
    organization_id: "org",
    is_active: false,
    lifecycle_state: "DISCONNECTED",
    sync_enabled: false,
    imap_host: "imap.example.com",
    imap_port: 993,
    imap_secure: true,
  });
  await assert.rejects(
    loadActiveMailAccountWithImapCredentials(db, { organizationId: "org", mailAccountId: "acc" }),
    (e) => e.code === "MAIL_ACCOUNT_STATE_BLOCKED"
  );
  assert.equal(db.remoteCalls, 0);
});

test("move worker boundary refuse IMAP si compte en purge apres claim", async () => {
  const db = dbWithAccount({
    id: "acc",
    organization_id: "org",
    is_active: false,
    lifecycle_state: "DELETION_PENDING",
    sync_enabled: false,
    imap_host: "imap.example.com",
    imap_port: 993,
    imap_secure: true,
  });
  await assert.rejects(
    applyMove(db, {
      organizationId: "org",
      mailAccountId: "acc",
      sourcePath: "INBOX",
      sourceUid: 1,
      targetPath: "Archive",
    }),
    (e) => e.code === "MAIL_ACCOUNT_STATE_BLOCKED"
  );
  assert.equal(db.remoteCalls, 0);
});
