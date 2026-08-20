import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { findExistingMessageId } from "../services/mail/mailSyncPersistence.service.js";

describe("mail remote identity", () => {
  it("cherche le Message-ID de secours seulement dans le meme dossier", async () => {
    const calls = [];
    const client = {
      async query(sql, params) {
        calls.push({ sql, params });
        return { rows: [] };
      },
    };
    const found = await findExistingMessageId(client, {
      organizationId: "org",
      mailAccountId: "account",
      folderId: "folder-b",
      externalUid: 123,
      externalUidValidity: "42",
      messageId: "<same@example.test>",
    });
    assert.equal(found, null);
    assert.equal(calls.length, 2);
    assert.match(calls[0].sql, /external_uid_validity/);
    assert.match(calls[1].sql, /folder_id = \$6/);
    assert.equal(calls[1].params[5], "folder-b");
  });
});
