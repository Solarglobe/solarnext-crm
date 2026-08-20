import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("OAuth routes use HttpOnly state cookie, no bearer callback assumption, and internal redirect helper", () => {
  const routes = read("routes/mailAccounts.routes.js");
  assert.match(routes, /res\.cookie\(OAUTH_COOKIE/);
  assert.match(routes, /httpOnly: true/);
  assert.match(routes, /sameSite: "lax"/);
  assert.match(routes, /consumeMicrosoftOAuthCallback/);
  assert.match(routes, /res\.clearCookie\(OAUTH_COOKIE/);
  assert.doesNotMatch(routes, /router\.get\("\/accounts\/oauth\/microsoft\/callback", verifyJWT/);

  const service = read("services/mail/mailMicrosoftOAuth.service.js");
  assert.match(service, /new URL\("\/settings\/mail", cfg\.frontendUrl\)/);
  assert.doesNotMatch(service, /console\.log|logger\./);
});

test("mail lifecycle migration defines states, live uniqueness and deletion job idempotency", () => {
  const migration = read("migrations/1783000000000_mail_account_lifecycle.js");
  for (const state of ["CONNECTED", "DEGRADED", "AUTH_REQUIRED", "DISABLED", "DISCONNECTED", "REMOVED", "DELETION_PENDING", "DELETED"]) {
    assert.match(migration, new RegExp(`"${state}"`));
  }
  assert.match(migration, /uq_mail_accounts_org_email_provider_live/);
  assert.match(migration, /lower\(email\), provider/);
  assert.match(migration, /uq_mail_account_deletion_jobs_pending/);
  assert.match(migration, /status IN \('PENDING', 'PROCESSING'\)/);
});

test("mail purge service scopes destructive SQL by organization and account", () => {
  const service = read("services/mail/mailAccountDeletion.service.js");
  assert.match(service, /MAIL_PURGE_REQUIRES_REMOVED/);
  assert.match(service, /JOIN mail_messages m ON m\.id = a\.mail_message_id/);
  assert.match(service, /a\.document_id IS NULL/);
  assert.match(service, /deleteOrphanedMailAttachmentFiles/);
  assert.match(service, /FROM mail_attachments\s+WHERE organization_id = \$1 AND storage_path = \$2/);
  assert.match(service, /await deleteFile\(storagePath\)/);
  assert.match(service, /DELETE FROM mail_flag_mutations WHERE organization_id = \$1 AND mail_account_id = \$2/);
  assert.match(service, /DELETE FROM mail_move_mutations WHERE organization_id = \$1 AND mail_account_id = \$2/);
  assert.match(service, /DELETE FROM mail_outbox WHERE organization_id = \$1 AND mail_account_id = \$2/);
  assert.match(service, /DELETE FROM mail_messages WHERE organization_id = \$1 AND mail_account_id = \$2/);
  assert.match(service, /DELETE FROM mail_folders WHERE organization_id = \$1 AND mail_account_id = \$2/);
});

test("lifecycle route keeps row lock and update in one transaction", () => {
  const routes = read("routes/mailAccounts.routes.js");
  assert.match(routes, /const client = await pool\.connect\(\)/);
  assert.match(routes, /await client\.query\("BEGIN"\)/);
  assert.match(routes, /FOR UPDATE/);
  assert.match(routes, /const r = await client\.query/);
  assert.match(routes, /await client\.query\("COMMIT"\)/);
  assert.match(routes, /await client\.query\("ROLLBACK"\)\.catch/);
});
