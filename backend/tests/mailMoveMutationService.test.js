import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { MailMoveOperations, __test } from "../services/mail/mailMoveMutation.service.js";

function makeQueryClient(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params) {
      calls.push({ sql, params });
      return handler(String(sql), params, calls.length);
    },
  };
}

describe("mail move mutation service", () => {
  it("resout une action thread dans le dossier courant seulement", async () => {
    const client = makeQueryClient((sql, params, n) => {
      if (n === 1) return { rows: [{ id: "acc-inbox" }] };
      assert.match(sql, /m\.mail_thread_id = \$3::uuid/);
      assert.match(sql, /m\.folder_id = \$4::uuid/);
      assert.deepEqual(params, ["org-1", ["acc-inbox"], "thread-1", "folder-inbox"]);
      return {
        rows: [
          {
            id: "msg-inbox",
            mail_thread_id: "thread-1",
            mail_account_id: "acc-inbox",
            folder_id: "folder-inbox",
            external_uid: 10,
          },
        ],
      };
    });
    const loaded = await __test.loadMessagesForAction(client, {
      organizationId: "org-1",
      accessibleAccountIds: new Set(["acc-inbox"]),
      threadId: "thread-1",
      folderId: "folder-inbox",
    });
    assert.equal(loaded.ok, true);
    assert.deepEqual(loaded.messages.map((m) => m.id), ["msg-inbox"]);
  });

  it("restaure vers le dossier precedent actif du meme compte", async () => {
    const client = makeQueryClient((sql, params) => {
      assert.match(sql, /mail_account_id = \$3/);
      assert.deepEqual(params, ["folder-custom", "org-1", "acc-1"]);
      return {
        rows: [
          {
            id: "folder-custom",
            external_id: "Clients/2026",
            name: "2026",
            type: "CUSTOM",
            special_use: null,
          },
        ],
      };
    });
    const target = await __test.resolveTargetFolder(client, {
      operation: MailMoveOperations.RESTORE,
      organizationId: "org-1",
      mailAccountId: "acc-1",
      message: { previous_folder_id: "folder-custom" },
    });
    assert.equal(target.ok, true);
    assert.equal(target.folder.id, "folder-custom");
    assert.equal(target.path, "Clients/2026");
  });

  it("restaure vers Inbox si le dossier precedent est absent ou inactif", async () => {
    let call = 0;
    const client = makeQueryClient((sql, params) => {
      call += 1;
      if (call === 1) {
        assert.deepEqual(params, ["folder-gone", "org-1", "acc-1"]);
        return { rows: [] };
      }
      assert.match(sql, /type = \$3::mail_folder_type/);
      assert.deepEqual(params, ["org-1", "acc-1", "INBOX", "\\Inbox"]);
      return {
        rows: [
          {
            id: "folder-inbox",
            external_id: "INBOX",
            name: "Inbox",
            type: "INBOX",
            special_use: "\\Inbox",
          },
        ],
      };
    });
    const target = await __test.resolveTargetFolder(client, {
      operation: MailMoveOperations.RESTORE,
      organizationId: "org-1",
      mailAccountId: "acc-1",
      message: { previous_folder_id: "folder-gone" },
    });
    assert.equal(target.ok, true);
    assert.equal(target.folder.id, "folder-inbox");
  });

  it("rejoue une cle d'idempotence sans creer une nouvelle intention", async () => {
    let call = 0;
    const client = makeQueryClient((sql) => {
      call += 1;
      if (call === 1) {
        return { rows: [{ id: "archive", external_id: "Archive", name: "Archive", type: "ARCHIVE" }] };
      }
      assert.match(sql, /WHERE idempotency_key = \$1/);
      return { rows: [{ id: "mutation-existing", status: "PENDING" }] };
    });
    const result = await __test.enqueueOne(client, {
      organizationId: "org-1",
      operation: MailMoveOperations.MOVE,
      targetFolderId: "archive",
      idempotencyKey: "client-key-1",
      batchId: "batch-1",
      message: {
        id: "msg-1",
        mail_thread_id: "thread-1",
        mail_account_id: "acc-1",
        folder_id: "inbox",
        folder_external_id: "INBOX",
        folder_name: "Inbox",
        external_uid: 10,
        account_is_active: true,
      },
    });
    assert.equal(result.ok, true);
    assert.equal(result.replayed, true);
    assert.equal(result.mutationId, "mutation-existing");
    assert.equal(client.calls.some((c) => String(c.sql).includes("UPDATE mail_messages SET")), false);
  });
});
