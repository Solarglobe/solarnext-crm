import test from "node:test";
import assert from "node:assert/strict";

import { appendDraftWithClient, deleteDraftWithClient, findDraftByIdentityWithClient } from "../services/mail/mailImapDraftProvider.service.js";
import { ensureSentMessageWithClient } from "../services/mail/mailSentArchiveProvider.service.js";
import { buildSimpleRfc822Mime } from "../services/mail/mailMimeBuilder.service.js";

class FakeImapClient {
  constructor({ appendUid = 10 } = {}) {
    this.appendUid = appendUid;
    this.mailboxes = new Map();
    this.deleted = [];
    this.flags = [];
  }
  async mailboxOpen(path) {
    if (!this.mailboxes.has(path)) this.mailboxes.set(path, []);
    return { uidValidity: "uv1", highestModseq: "m1" };
  }
  async append(path, mime, flags) {
    const box = this.mailboxes.get(path) || [];
    const uid = box.length ? Math.max(...box.map((m) => m.uid)) + 1 : 1;
    box.push({ uid, source: Buffer.from(mime), flags, modseq: `m${uid}` });
    this.mailboxes.set(path, box);
    return this.appendUid ? { uid: this.appendUid, uidValidity: "uv1" } : {};
  }
  async search() {
    const box = [...this.mailboxes.values()].at(-1) || [];
    return box.map((m) => m.uid);
  }
  async *fetch(range) {
    const uid = Number(range);
    const box = [...this.mailboxes.values()].at(-1) || [];
    for (const msg of box.filter((m) => m.uid === uid)) yield msg;
  }
  async messageDelete(uid) {
    this.deleted.push(Number(uid));
  }
  async messageFlagsAdd(uid, flags) {
    this.flags.push({ uid: Number(uid), flags });
  }
}

test("6B Draft provider append uses Draft flag and APPENDUID when available", async () => {
  const client = new FakeImapClient({ appendUid: 44 });
  const mime = buildSimpleRfc822Mime({ from: "me@x.test", to: "you@x.test", subject: "D", draftIdentity: "abc" });
  const r = await appendDraftWithClient(client, { folderPath: "Drafts", mime, draftIdentity: "abc" });
  assert.equal(r.uid, 44);
  assert.deepEqual(client.mailboxes.get("Drafts")[0].flags, ["\\Draft"]);
});

test("6B Draft provider reconciles without APPENDUID by X-Solarglobe-Draft-ID", async () => {
  const client = new FakeImapClient({ appendUid: null });
  const mime = buildSimpleRfc822Mime({ from: "me@x.test", to: "you@x.test", subject: "D", draftIdentity: "stable123" });
  const r = await appendDraftWithClient(client, { folderPath: "Drafts", mime, draftIdentity: "stable123" });
  assert.equal(r.uid, 1);
  assert.equal(r.requiresReconciliation, false);
});

test("6B Draft provider finds and deletes targeted draft only", async () => {
  const client = new FakeImapClient({ appendUid: null });
  const mime = buildSimpleRfc822Mime({ from: "me@x.test", to: "you@x.test", subject: "D", draftIdentity: "target" });
  await appendDraftWithClient(client, { folderPath: "Drafts", mime, draftIdentity: "target" });
  const found = await findDraftByIdentityWithClient(client, { folderPath: "Drafts", draftIdentity: "target" });
  assert.equal(found.uid, 1);
  const del = await deleteDraftWithClient(client, { folderPath: "Drafts", uid: 1 });
  assert.equal(del.deleted, true);
  assert.deepEqual(client.deleted, [1]);
});

test("6B Sent provider reconciles provider-created Sent without append", async () => {
  const client = new FakeImapClient({ appendUid: null });
  const mime = buildSimpleRfc822Mime({ from: "me@x.test", to: "you@x.test", subject: "S", messageId: "<sent@x.test>" });
  client.mailboxes.set("Sent", [{ uid: 8, source: mime, flags: ["\\Seen"], modseq: "m8" }]);
  const r = await ensureSentMessageWithClient(client, { folderPath: "Sent", messageId: "<sent@x.test>", mime });
  assert.equal(r.action, "reconciled-existing");
  assert.equal(r.uid, 8);
});

test("6B Sent provider appends and marks Seen when provider did not create Sent", async () => {
  const client = new FakeImapClient({ appendUid: 9 });
  const mime = buildSimpleRfc822Mime({ from: "me@x.test", to: "you@x.test", subject: "S", messageId: "<sent2@x.test>" });
  const r = await ensureSentMessageWithClient(client, { folderPath: "Sent", messageId: "<sent2@x.test>", mime });
  assert.match(r.action, /appended/);
  assert.deepEqual(client.mailboxes.get("Sent")[0].flags, ["\\Seen"]);
});

