import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = (rel) => fs.readFileSync(path.join(root, rel), "utf8");

test("mail phase 5 backend keeps indexed FTS search and server sort", () => {
  const service = read("services/mail/mailApi.service.js");
  const routes = read("routes/mail.routes.js");
  const ftsMigration = read("migrations/1775930000000_mail_messages_fulltext_search.js");
  assert.match(service, /search_vector @@ plainto_tsquery\('simple'/);
  assert.match(service, /ts_rank\(msrk\.search_vector/);
  assert.match(service, /sort === "oldest"/);
  assert.match(service, /psender\.type = 'FROM'::mail_participant_type/);
  assert.match(service, /precipient\.type IN \('TO'::mail_participant_type, 'CC'::mail_participant_type, 'BCC'::mail_participant_type\)/);
  assert.match(routes, /parseMailSort/);
  assert.match(routes, /sort,/);
  assert.match(routes, /sender:/);
  assert.match(routes, /recipient:/);
  assert.match(ftsMigration, /USING GIN \(search_vector\)/);
});

test("mail phase 5B unread badge is scoped to canonical inbox, active accounts and permissions", () => {
  const service = read("services/mail/mailApi.service.js");
  const store = read("../frontend/src/pages/mail/mailUnreadStore.tsx");
  const layout = read("../frontend/src/layout/AppLayout.tsx");
  assert.match(store, /getInboxUnreadSummary\(\{ mailbox: "inbox" \}\)/);
  assert.match(layout, /formatMailUnreadBadge/);
  assert.match(service, /mf\.type = 'INBOX'::mail_folder_type/);
  assert.match(service, /t\.has_unread = true/);
  assert.match(service, /COALESCE\(lifecycle_state::text, 'CONNECTED'\) IN \('CONNECTED', 'DEGRADED'\)/);
  assert.match(service, /COALESCE\(sync_enabled, true\) = true/);
  assert.match(service, /id = ANY\(\$2::uuid\[\]\)/);
  assert.doesNotMatch(store, /setInterval[\s\S]*setInterval[\s\S]*getInboxUnreadSummary/);
});

test("mail phase 5 migration adds reversible indexes for inbox badge and lists", () => {
  const migration = read("migrations/1783100000000_mail_outlook_ui_indexes.js");
  assert.match(migration, /idx_mail_threads_org_live_unread_last/);
  assert.match(migration, /idx_mail_messages_thread_account_folder_live/);
  assert.match(migration, /idx_mail_messages_account_folder_read_live/);
  assert.match(migration, /DROP INDEX IF EXISTS idx_mail_messages_account_folder_read_live/);
  assert.match(migration, /DROP INDEX IF EXISTS idx_mail_threads_org_live_unread_last/);
});
