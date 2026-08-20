import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

const read = (p) => fs.readFileSync(new URL(p, import.meta.url), "utf8");

test("phase 6 migration stores history, draft sync jobs and sent archive state", () => {
  const src = read("../migrations/1784200005000_mail_phase6_history_drafts_sent.js");
  for (const token of [
    "history_backfill_status",
    "history_backfill_cursor_uid",
    "oldest_imported_uid",
    "mail_draft_sync_jobs",
    "remote_uid_validity",
    "sent_archive_status",
    "smtp_completed_at",
  ]) {
    assert.match(src, new RegExp(token));
  }
});

test("phase 6 sync route exposes a scoped folder backfill endpoint", () => {
  const src = read("../routes/mailSync.routes.js");
  assert.match(src, /\/sync\/backfill/);
  assert.match(src, /getAccessibleMailAccountIds/);
  assert.match(src, /backfillMailFolderHistory/);
});

test("phase 6 folder read model exposes partial and complete history states", () => {
  const src = read("../services/mail/mailFolders.service.js");
  assert.match(src, /historyBackfillStatus/);
  assert.match(src, /historyBackfillHasMore/);
  assert.match(src, /isHistoryPartial: row.history_sync_status !== "COMPLETE"/);
});

test("phase 6 outbox separates SMTP completion from Sent retry", () => {
  const src = read("../services/mail/mailOutbox.processor.js");
  assert.match(src, /smtp_completed_at/);
  assert.match(src, /sent_archive_status/);
  assert.match(src, /classifyAfterSmtpFailure/);
  assert.match(src, /SENT_ARCHIVE_PENDING/);
});

test("phase 6 frontend exposes remote history and draft sync state", () => {
  const api = read("../../frontend/src/services/mailApi.ts");
  const inbox = read("../../frontend/src/pages/mail/MailInboxPage.tsx");
  const drafts = read("../../frontend/src/pages/mail/MailDraftsList.tsx");
  assert.match(api, /backfillMailFolder/);
  assert.match(api, /historyBackfillHasMore/);
  assert.match(api, /sync_status/);
  assert.match(inbox, /Charger les messages plus anciens/);
  assert.match(drafts, /Conflit/);
});

test("phase 6B starts real Draft and Sent workers from server startup", () => {
  const server = read("../server.js");
  assert.match(server, /startMailDraftSyncProcessor/);
  assert.match(server, /startMailSentArchiveProcessor/);
});

test("phase 6B Draft provider performs append fetch and targeted delete", () => {
  const src = read("../services/mail/mailImapDraftProvider.service.js");
  assert.match(src, /\.append\(/);
  assert.match(src, /X-Solarglobe-Draft-ID|x-solarglobe-draft-id/);
  assert.match(src, /messageDelete/);
});

test("phase 6B Sent processor refuses to call SMTP and requires smtp_completed_at", () => {
  const src = read("../services/mail/mailSentArchive.processor.js");
  assert.match(src, /smtp_completed_at IS NOT NULL/);
  assert.doesNotMatch(src, /sendMailNodemailerOnly|loadActiveMailAccountWithSmtpCredentials/);
});
