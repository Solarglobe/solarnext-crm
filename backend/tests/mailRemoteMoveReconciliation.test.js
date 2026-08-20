import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { __test } from "../services/mail/mailSync.service.js";

function makeClient(rows) {
  return {
    async query(sql, params) {
      assert.match(String(sql), /message_id = \$4/);
      assert.equal(params[3], "<same@example.test>");
      return { rows };
    },
  };
}

describe("mail remote move reconciliation", () => {
  const base = {
    organizationId: "org-1",
    mailAccountId: "acc-1",
    targetFolderId: "archive",
    messageId: "<same@example.test>",
    subject: "Projet solaire",
    sentAt: new Date("2026-01-01T10:00:00Z"),
    internalDate: new Date("2026-01-01T10:00:03Z"),
    sourceSizeBytes: 2048,
  };

  it("corrèle une disparition source et une apparition destination avec metadonnees coherentes", async () => {
    const r = await __test.findMissingMovedMessageCandidate(
      makeClient([
        {
          id: "msg-old",
          mail_thread_id: "thread-1",
          subject: "Projet solaire",
          sent_at: new Date("2026-01-01T10:00:02Z"),
          external_internal_date: new Date("2026-01-01T10:00:01Z"),
          external_size_bytes: 2048,
        },
      ]),
      base
    );
    assert.equal(r.status, "match");
    assert.equal(r.message.id, "msg-old");
  });

  it("ne fusionne pas deux messages qui partagent seulement le meme Message-ID", async () => {
    const r = await __test.findMissingMovedMessageCandidate(
      makeClient([
        {
          id: "msg-other",
          mail_thread_id: "thread-1",
          subject: "Autre sujet",
          sent_at: new Date("2026-01-03T10:00:00Z"),
          external_internal_date: new Date("2026-01-03T10:00:00Z"),
          external_size_bytes: 2048,
        },
      ]),
      base
    );
    assert.equal(r.status, "none");
  });

  it("signale une ambiguite au lieu de choisir arbitrairement", async () => {
    const row = {
      mail_thread_id: "thread-1",
      subject: "Projet solaire",
      sent_at: new Date("2026-01-01T10:00:01Z"),
      external_internal_date: new Date("2026-01-01T10:00:01Z"),
      external_size_bytes: 2048,
    };
    const r = await __test.findMissingMovedMessageCandidate(
      makeClient([
        { ...row, id: "msg-1" },
        { ...row, id: "msg-2" },
      ]),
      base
    );
    assert.equal(r.status, "ambiguous");
  });
});
