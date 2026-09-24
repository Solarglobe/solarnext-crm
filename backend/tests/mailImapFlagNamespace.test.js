import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

// Keep the real provider body; no imports of db.js, credentials or IMAP transport.
const source = readFileSync(new URL("../services/mail/mailImapFlagsProvider.service.js", import.meta.url), "utf8")
  .replace(/^import[\s\S]*?from\s+["'][^"']+["'];\s*/gm, "").replace(/^export\s+/gm, "");
const provider = vm.runInNewContext(`${source}\n;({applyReadStateWithClient})`, { Error, Set, String, Object, Symbol });

function client(uidValidity, highestModseq = null) {
  const calls = [];
  let flags = [];
  return {
    calls,
    async mailboxOpen() { calls.push("open"); return { uidValidity, highestModseq }; },
    async *fetch() { calls.push("fetch"); yield { uid: 42, flags, modseq: highestModseq }; },
    async messageFlagsAdd() { calls.push("store"); flags = ["\\Seen"]; },
    async messageFlagsRemove() { calls.push("store"); flags = []; },
  };
}

for (const [label, expectedUidValidity, remoteUidValidity] of [
  ["legacy null reference", null, "20"],
  ["absent reference", undefined, "20"],
  ["empty reference", "", "20"],
  ["absent remote namespace", "20", null],
  ["different namespace", "10", "20"],
]) test(`M1 flag STORE refuses ${label} before reading or mutating a reused UID`, async () => {
  const imapClient = client(remoteUidValidity);
  await assert.rejects(provider.applyReadStateWithClient({ imapClient, folderPath:"INBOX", uid:42,
    expectedUidValidity, desiredIsRead:true }), {code:"UIDVALIDITY_CHANGED",permanent:true});
  assert.deepEqual(imapClient.calls, ["open"]);
});

for (const desiredIsRead of [true, false]) test(`M1 ordinary IMAP without MODSEQ still applies a known-namespace ${desiredIsRead ? "read" : "unread"} intention`, async () => {
  const imapClient = client(20n);
  const result = await provider.applyReadStateWithClient({ imapClient, folderPath:"INBOX", uid:42,
    expectedUidValidity:"20", desiredIsRead });
  assert.equal(result.confirmed.isRead, desiredIsRead);
  assert.equal(result.mailbox.uidValidity, "20");
  assert.deepEqual(imapClient.calls, ["open","fetch","store","fetch"]);
});
