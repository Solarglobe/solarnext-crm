import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { discoverImapFoldersWithStatus } from "../services/mail/mailFolderDiscovery.service.js";

function makeClient() {
  const statusCalls = [];
  return {
    statusCalls,
    async list() {
      return [
        { path: "INBOX", delimiter: "/", specialUse: "\\Inbox" },
        { path: "Archive", delimiter: "/", specialUse: "\\Archive" },
        { path: "Root", delimiter: "/", flags: ["\\Noselect"] },
        { path: "Root/Child", delimiter: "/" },
      ];
    },
    async status(path, query) {
      statusCalls.push({ path, query });
      if (path === "Archive") {
        return { messages: 20, unseen: 3, uidValidity: 77n, highestModseq: 900n };
      }
      return { messages: 5, unseen: 1, uidValidity: 42n, highestModseq: 100n };
    },
  };
}

describe("mail folder discovery", () => {
  it("decouvre les dossiers sans ouvrir les messages et saute les dossiers non selectionnables", async () => {
    const client = makeClient();
    const result = await discoverImapFoldersWithStatus(client);
    assert.equal(result.total, 4);
    assert.equal(result.statusChecked, 3);
    assert.equal(client.statusCalls.some((c) => c.path === "Root"), false);
    const archive = result.folders.find((f) => f.path === "Archive");
    assert.equal(archive.type, "ARCHIVE");
    assert.equal(archive.remoteUnreadCount, 3);
    assert.equal(archive.uidValidity, "77");
    const parent = result.folders.find((f) => f.path === "Root");
    assert.equal(parent.selectable, false);
  });

  it("respecte un budget STATUS pour les comptes avec beaucoup de dossiers", async () => {
    const client = makeClient();
    const result = await discoverImapFoldersWithStatus(client, { statusLimit: 1 });
    assert.equal(result.statusChecked, 1);
    assert.equal(result.statusBudgetExhausted, true);
    assert.equal(client.statusCalls.length, 1);
  });
});
