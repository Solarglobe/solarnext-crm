import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyReadStateWithClient,
  hasSeenFlag,
  MailFlagProviderErrorCodes,
} from "../services/mail/mailImapFlagsProvider.service.js";

function makeClient({ flags = [], uidValidity = 42n, highestModseq = 10n, fetchMissing = false } = {}) {
  const calls = [];
  let currentFlags = new Set(flags);
  return {
    calls,
    async mailboxOpen(path) {
      calls.push(["mailboxOpen", path]);
      return { uidValidity, highestModseq };
    },
    async messageFlagsAdd(range, nextFlags, options) {
      calls.push(["messageFlagsAdd", range, nextFlags, options]);
      for (const flag of nextFlags) currentFlags.add(flag);
    },
    async messageFlagsRemove(range, nextFlags, options) {
      calls.push(["messageFlagsRemove", range, nextFlags, options]);
      for (const flag of nextFlags) currentFlags.delete(flag);
    },
    async *fetch(range, _query, options) {
      calls.push(["fetch", range, options]);
      if (fetchMissing) return;
      yield { uid: Number(range), flags: new Set(currentFlags), modseq: 11n };
    },
  };
}

describe("mail IMAP flag provider", () => {
  it("CRM lu -> ajoute \\Seen et confirme l'etat distant", async () => {
    const client = makeClient({ flags: [] });
    const result = await applyReadStateWithClient({
      imapClient: client,
      folderPath: "INBOX",
      uid: 123,
      desiredIsRead: true,
      expectedUidValidity: "42",
    });
    assert.equal(result.confirmed.isRead, true);
    assert.equal(client.calls.some((c) => c[0] === "messageFlagsAdd"), true);
  });

  it("CRM non lu -> retire \\Seen et confirme l'etat distant", async () => {
    const client = makeClient({ flags: ["\\Seen"] });
    const result = await applyReadStateWithClient({
      imapClient: client,
      folderPath: "INBOX",
      uid: 123,
      desiredIsRead: false,
      expectedUidValidity: "42",
    });
    assert.equal(result.confirmed.isRead, false);
    assert.equal(client.calls.some((c) => c[0] === "messageFlagsRemove"), true);
  });

  it("detecte un UIDVALIDITY modifie sans appliquer de flag", async () => {
    const client = makeClient({ uidValidity: 99n });
    await assert.rejects(
      () =>
        applyReadStateWithClient({
          imapClient: client,
          folderPath: "INBOX",
          uid: 123,
          desiredIsRead: true,
          expectedUidValidity: "42",
        }),
      { code: MailFlagProviderErrorCodes.UIDVALIDITY_CHANGED }
    );
    assert.equal(client.calls.some((c) => c[0] === "messageFlagsAdd"), false);
  });

  it("classe un message distant introuvable comme erreur permanente", async () => {
    const client = makeClient({ fetchMissing: true });
    await assert.rejects(
      () =>
        applyReadStateWithClient({
          imapClient: client,
          folderPath: "INBOX",
          uid: 123,
          desiredIsRead: true,
          expectedUidValidity: "42",
        }),
      { code: MailFlagProviderErrorCodes.REMOTE_MESSAGE_NOT_FOUND, permanent: true }
    );
  });

  it("normalise le flag \\Seen quelle que soit la casse", () => {
    assert.equal(hasSeenFlag(new Set(["\\Seen"])), true);
    assert.equal(hasSeenFlag(["\\SEEN"]), true);
    assert.equal(hasSeenFlag([]), false);
  });
});
