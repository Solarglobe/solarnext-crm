import test from "node:test";
import assert from "node:assert/strict";
import { requestMailAccountLocalPurge, purgeMailAccountLocalDataNow } from "../services/mail/mailAccountDeletion.service.js";

function fakePool(handler) {
  const calls = [];
  const client = {
    calls,
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      return handler(String(sql), params, calls.length);
    },
    release() {},
  };
  return { calls, async connect() { return client; } };
}

test("mail account purge exige confirmation email exacte et compte REMOVED", async () => {
  for (const [email, state, expected] of [
    ["other@example.com", "REMOVED", "MAIL_PURGE_CONFIRMATION_MISMATCH"],
    ["user@example.com", "CONNECTED", "MAIL_PURGE_REQUIRES_REMOVED"],
  ]) {
    const pool = fakePool((sql) => {
      if (sql === "BEGIN" || sql === "ROLLBACK") return { rows: [] };
      if (sql.includes("FROM mail_accounts")) {
        return { rows: [{ id: "acc", email: "user@example.com", lifecycle_state: state }] };
      }
      throw new Error(`Unexpected SQL ${sql}`);
    });
    await assert.rejects(
      requestMailAccountLocalPurge({
        organizationId: "org",
        mailAccountId: "acc",
        userId: "user",
        confirmationEmail: email,
        pool,
      }),
      (e) => e.code === expected
    );
  }
});

test("mail account purge request cree un seul job et passe DELETION_PENDING", async () => {
  const pool = fakePool((sql) => {
    if (sql === "BEGIN" || sql === "COMMIT") return { rows: [] };
    if (sql.includes("FROM mail_accounts")) {
      return { rows: [{ id: "acc", email: "user@example.com", lifecycle_state: "REMOVED" }] };
    }
    if (sql.includes("INSERT INTO mail_account_deletion_jobs")) {
      assert.match(sql, /ON CONFLICT/);
      return { rows: [{ id: "job-1", status: "PENDING" }] };
    }
    if (sql.includes("UPDATE mail_accounts SET")) {
      assert.match(sql, /DELETION_PENDING/);
      return { rows: [] };
    }
    throw new Error(`Unexpected SQL ${sql}`);
  });
  const out = await requestMailAccountLocalPurge({
    organizationId: "org",
    mailAccountId: "acc",
    userId: "user",
    confirmationEmail: "user@example.com",
    pool,
  });
  assert.equal(out.jobId, "job-1");
});

test("purge locale supprime uniquement par organization/account et finit DELETED", async () => {
  const calls = [];
  const db = {
    async query(sql, params) {
      calls.push({ sql: String(sql), params });
      if (String(sql).includes("WHERE id = $1 AND organization_id = $2")) {
        assert.deepEqual(params, ["acc", "org"]);
      } else if (!String(sql).includes("mail_threads")) {
        assert.equal(params[0], "org");
      }
      if (String(sql).includes("mail_account_id = $2")) {
        assert.ok(params.includes("acc"));
      }
      return { rowCount: 1, rows: [] };
    },
  };
  const stats = await purgeMailAccountLocalDataNow(db, { organization_id: "org", mail_account_id: "acc" });
  assert.equal(stats.flagMutations, 1);
  assert.equal(stats.moveMutations, 1);
  assert.equal(stats.outbox, 1);
  assert.equal(stats.permissions, 1);
  assert.equal(stats.messages, 1);
  assert.equal(stats.folders, 1);
  const sqlAll = calls.map((c) => c.sql).join("\n");
  assert.match(sqlAll, /encrypted_credentials = NULL/);
  assert.match(sqlAll, /lifecycle_state = 'DELETED'/);
  assert.doesNotMatch(sqlAll, /imap|smtp|graph|outlook\.office/i);
});
