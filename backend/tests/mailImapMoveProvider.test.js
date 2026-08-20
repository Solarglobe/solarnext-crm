import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  applyMoveWithClient,
  MailMoveProviderErrorCodes,
} from "../services/mail/mailImapMoveProvider.service.js";

function makeClient({ uidValidity = 42n, capabilities = ["MOVE", "UIDPLUS"], fetchMissing = false } = {}) {
  const calls = [];
  return {
    calls,
    capabilities: new Set(capabilities),
    async mailboxOpen(path) {
      calls.push(["mailboxOpen", path]);
      return { uidValidity, highestModseq: 7n };
    },
    async *fetch(range, _query, options) {
      calls.push(["fetch", range, options]);
      if (fetchMissing) return;
      yield { uid: Number(range), flags: new Set(["\\Seen"]), modseq: 8n };
    },
    async messageMove(range, destination, options) {
      calls.push(["messageMove", range, destination, options]);
      return { destination, uidValidity: 99n, uidMap: new Map([[Number(range), 456]]) };
    },
    async messageCopy(range, destination, options) {
      calls.push(["messageCopy", range, destination, options]);
      return { destination, uidValidity: 99n, uidMap: new Map([[Number(range), 789]]) };
    },
    async messageDelete(range, options) {
      calls.push(["messageDelete", range, options]);
      return true;
    },
  };
}

describe("mail IMAP move provider", () => {
  it("deplace par UID et retourne le nouvel UID quand UIDPLUS le fournit", async () => {
    const client = makeClient();
    const result = await applyMoveWithClient(client, {
      sourcePath: "INBOX",
      sourceUid: 123,
      expectedUidValidity: "42",
      targetPath: "Archive",
    });
    assert.equal(result.resultUid, 456);
    assert.equal(result.resultUidValidity, "99");
    assert.equal(client.calls.some((c) => c[0] === "messageMove" && c[3]?.uid === true), true);
  });

  it("utilise COPY puis UID EXPUNGE cible si MOVE n'est pas supporte mais UIDPLUS est disponible", async () => {
    const client = makeClient({ capabilities: ["UIDPLUS"] });
    const result = await applyMoveWithClient(client, {
      sourcePath: "INBOX",
      sourceUid: 123,
      expectedUidValidity: "42",
      targetPath: "Archive",
    });
    assert.equal(result.operation, "COPY_DELETE");
    assert.equal(result.resultUid, 789);
    assert.deepEqual(client.calls.map((c) => c[0]).filter((x) => x === "messageCopy" || x === "messageDelete"), [
      "messageCopy",
      "messageDelete",
    ]);
  });

  it("refuse le fallback COPY+EXPUNGE si UIDPLUS est indisponible", async () => {
    const client = makeClient({ capabilities: [] });
    await assert.rejects(
      () =>
        applyMoveWithClient(client, {
          sourcePath: "INBOX",
          sourceUid: 123,
          expectedUidValidity: "42",
          targetPath: "Archive",
        }),
      { code: MailMoveProviderErrorCodes.UNSAFE_UID_EXPUNGE_UNSUPPORTED }
    );
    assert.equal(client.calls.some((c) => c[0] === "messageDelete"), false);
  });

  it("refuse la suppression definitive hors corbeille", async () => {
    const client = makeClient();
    await assert.rejects(
      () =>
        applyMoveWithClient(client, {
          sourcePath: "INBOX",
          sourceUid: 123,
          hardDelete: true,
          sourceIsTrash: false,
        }),
      { code: MailMoveProviderErrorCodes.UNSAFE_HARD_DELETE_FOLDER }
    );
  });

  it("refuse la suppression definitive en corbeille si UIDPLUS est indisponible", async () => {
    const client = makeClient({ capabilities: ["MOVE"] });
    await assert.rejects(
      () =>
        applyMoveWithClient(client, {
          sourcePath: "Trash",
          sourceUid: 123,
          hardDelete: true,
          sourceIsTrash: true,
        }),
      { code: MailMoveProviderErrorCodes.UNSAFE_UID_EXPUNGE_UNSUPPORTED }
    );
    assert.equal(client.calls.some((c) => c[0] === "messageDelete"), false);
  });

  it("suppression definitive idempotente si le message cible a deja disparu", async () => {
    const client = makeClient({ fetchMissing: true });
    const result = await applyMoveWithClient(client, {
      sourcePath: "Trash",
      sourceUid: 123,
      hardDelete: true,
      sourceIsTrash: true,
    });
    assert.equal(result.alreadyGone, true);
    assert.equal(client.calls.some((c) => c[0] === "messageDelete"), false);
  });

  it("detecte un UIDVALIDITY modifie avant de muter le message", async () => {
    const client = makeClient({ uidValidity: 77n });
    await assert.rejects(
      () =>
        applyMoveWithClient(client, {
          sourcePath: "INBOX",
          sourceUid: 123,
          expectedUidValidity: "42",
          targetPath: "Archive",
        }),
      { code: MailMoveProviderErrorCodes.UIDVALIDITY_CHANGED }
    );
    assert.equal(client.calls.some((c) => c[0] === "messageMove"), false);
  });
});
