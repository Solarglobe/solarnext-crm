import test from "node:test";
import assert from "node:assert/strict";

import {
  computeBackfillProgress,
  normalizeUidList,
  resolveUidValidityTransition,
  selectOlderUidsForBackfill,
} from "../services/mail/mailHistoryBackfill.service.js";
import {
  detectDraftConflict,
  planDraftRemoteDelete,
  planDraftRemoteSave,
  stableDraftMessageId,
} from "../services/mail/mailDraftSync.service.js";
import {
  buildSentArchivePlan,
  classifyAfterSmtpFailure,
  normalizeStableMessageId,
} from "../services/mail/mailSentArchive.service.js";
import {
  boundedReferences,
  buildForwardEnvelope,
  buildQuotedBodies,
  buildReplyEnvelope,
  dedupeAddresses,
  prefixSubject,
} from "../services/mail/mailReplyForward.service.js";
import {
  assertNoPathTraversal,
  sanitizeAttachmentFileName,
  validateOutboundAttachmentBatch,
} from "../services/mail/mailAttachmentPolicy.service.js";

test("history backfill selects older UID ranges without assuming continuity", () => {
  const r = selectOlderUidsForBackfill({ remoteUids: [1, 2, 10, 50, 90], oldestImportedUid: 90, limit: 2 });
  assert.deepEqual(r.batch, [50, 10]);
  assert.equal(r.hasMoreOlder, true);
});

test("history backfill detects beginning of remote folder", () => {
  const r = selectOlderUidsForBackfill({ remoteUids: [3, 7, 20], oldestImportedUid: 7, limit: 10 });
  assert.deepEqual(r.batch, [3]);
  assert.equal(r.hasMoreOlder, false);
  assert.equal(r.oldestRemoteUid, 3);
});

test("history backfill normalizes replayed and malformed UIDs", () => {
  assert.deepEqual(normalizeUidList([5, "5", 2, 0, -1, "x", 9]), [2, 5, 9]);
});

test("history progress is defensive", () => {
  assert.deepEqual(computeBackfillProgress({ remoteTotalCount: 100, localImportedCount: 41, hasMoreOlder: true }), {
    percent: 41,
    complete: false,
  });
});

test("empty remote folder is complete", () => {
  assert.deepEqual(computeBackfillProgress({ remoteTotalCount: 0, localImportedCount: 0, hasMoreOlder: false }), {
    percent: 100,
    complete: true,
  });
});

test("UIDVALIDITY change resets history cursors", () => {
  const r = resolveUidValidityTransition("a", "b");
  assert.equal(r.changed, true);
  assert.equal(r.reset.history_backfill_status, "NOT_STARTED");
  assert.equal(r.reset.history_backfill_has_more, true);
});

test("same UIDVALIDITY keeps history cursors", () => {
  assert.equal(resolveUidValidityTransition("a", "a").changed, false);
});

test("draft Message-ID has stable mail shape", () => {
  assert.match(stableDraftMessageId({ draftId: "d1", organizationId: "o1" }), /^<draft-d1-o1@/);
});

test("draft save appends before targeted delete", () => {
  const p = planDraftRemoteSave({ draftId: "d1", previousUid: 42, draftFolderPath: "Drafts" });
  assert.deepEqual(p.steps.map((s) => s.type), [
    "append",
    "confirm-appended-uid",
    "swap-local-remote-identity",
    "delete-previous-draft",
  ]);
  assert.equal(p.steps.at(-1).targeted, true);
});

test("draft save without previous UID does not delete", () => {
  const p = planDraftRemoteSave({ draftId: "d1", previousUid: null, draftFolderPath: "Drafts" });
  assert.equal(p.steps.some((s) => s.type === "delete-previous-draft"), false);
});

test("draft delete is targeted when remote UID exists", () => {
  const p = planDraftRemoteDelete({ draftId: "d1", remoteUid: 9, draftFolderPath: "Drafts" });
  assert.equal(p.steps[0].uid, 9);
  assert.equal(p.steps[0].targeted, true);
});

test("dirty local draft conflict preserves both versions", () => {
  const r = detectDraftConflict({ localDirty: true, localRemoteUid: 1, incomingRemoteUid: 2 });
  assert.equal(r.conflict, true);
  assert.match(r.reason, /non synchronisees/);
});

test("clean local draft accepts remote changes", () => {
  const r = detectDraftConflict({ localDirty: false, localRemoteUid: 1, incomingRemoteUid: 2 });
  assert.equal(r.conflict, false);
});

test("Sent normalizes Message-ID brackets", () => {
  assert.equal(normalizeStableMessageId("abc@example.test"), "<abc@example.test>");
});

test("Sent provider-copy plan is reconcile-only", () => {
  const p = buildSentArchivePlan({ providerAlreadyInSent: true, stableMessageId: "<m@x>" });
  assert.equal(p.sentAction, "reconcile-provider-copy");
  assert.equal(p.smtpShouldRun, false);
});

test("Sent append plan never asks SMTP to run", () => {
  const p = buildSentArchivePlan({ providerAlreadyInSent: false, sentFolderPath: "Sent", stableMessageId: "<m@x>" });
  assert.equal(p.sentAction, "append-exact-mime");
  assert.equal(p.smtpShouldRun, false);
  assert.deepEqual(p.flags, ["\\Seen"]);
});

test("Sent archive failure retries Sent only", () => {
  const err = new Error("append failed");
  err.code = "SENT_ARCHIVE_FAILED";
  assert.deepEqual(classifyAfterSmtpFailure(err), {
    smtpAccepted: true,
    retrySmtp: false,
    retrySentArchive: true,
  });
});

test("SMTP failure remains SMTP retryable", () => {
  const err = new Error("smtp down");
  err.code = "SMTP_UNAVAILABLE";
  assert.equal(classifyAfterSmtpFailure(err).retrySmtp, true);
});

test("addresses dedupe and exclude own account", () => {
  assert.deepEqual(dedupeAddresses(["A@x.test", "a@x.test", "b@x.test"], ["b@x.test"]), ["A@x.test"]);
});

test("reply subject does not accumulate Re", () => {
  assert.equal(prefixSubject("Re: re: Projet", "Re"), "Re: Projet");
});

test("forward subject does not accumulate Fwd", () => {
  assert.equal(prefixSubject("Fwd: FW: Contrat", "Fwd"), "Fwd: Contrat");
});

test("references are bounded", () => {
  const refs = boundedReferences({ references: Array.from({ length: 25 }, (_, i) => `<${i}@x>`), messageId: "<last@x>", max: 20 });
  assert.equal(refs.length, 20);
  assert.equal(refs.at(-1), "<last@x>");
});

test("reply uses Reply-To before From", () => {
  const env = buildReplyEnvelope({
    message: { replyTo: "reply@x.test", from: "from@x.test", subject: "Hi", messageId: "<m@x>" },
    accountEmails: ["me@x.test"],
  });
  assert.deepEqual(env.to, ["reply@x.test"]);
  assert.equal(env.inReplyTo, "<m@x>");
});

test("reply-all excludes own address and BCC", () => {
  const env = buildReplyEnvelope({
    message: { from: "from@x.test", to: ["me@x.test", "other@x.test"], cc: ["other@x.test", "c@x.test"], bcc: ["secret@x.test"] },
    accountEmails: ["me@x.test"],
    replyAll: true,
  });
  assert.deepEqual(env.to, ["from@x.test", "other@x.test"]);
  assert.deepEqual(env.cc, ["c@x.test"]);
  assert.deepEqual(env.bcc, []);
});

test("forward has no fake threading", () => {
  const env = buildForwardEnvelope({ message: { subject: "Re: Sujet" }, includeAttachments: true });
  assert.equal(env.inReplyTo, null);
  assert.deepEqual(env.references, []);
  assert.equal(env.includeAttachments, true);
});

test("quoted bodies include metadata and strip script", () => {
  const q = buildQuotedBodies({
    message: { from: "a@x.test", date: "2026-08-20", subject: "S", bodyHtml: "<script>x</script><p>OK</p>", bodyText: "OK" },
  });
  assert.match(q.text, /Objet : S/);
  assert.doesNotMatch(q.html, /script/);
});

test("attachment filename sanitizes unicode and forbidden chars", () => {
  assert.equal(sanitizeAttachmentFileName("devis été <2026>.pdf"), "devis été _2026_.pdf");
});

test("attachment traversal is refused", () => {
  assert.throws(() => assertNoPathTraversal("../secret.pdf"), /refuse/);
});

test("attachment per-file limit is enforced", () => {
  assert.throws(() => validateOutboundAttachmentBatch([{ filename: "big.bin", size: 11 }], { perFileBytes: 10, totalBytes: 100 }), /volumineuse/);
});

test("attachment total limit is enforced", () => {
  assert.throws(
    () => validateOutboundAttachmentBatch([{ filename: "a.bin", size: 8 }, { filename: "b.bin", size: 8 }], { perFileBytes: 10, totalBytes: 12 }),
    /Total/
  );
});

test("attachment valid batch returns normalized rows", () => {
  const rows = validateOutboundAttachmentBatch([{ filename: "ok.pdf", size: 8 }], { perFileBytes: 10, totalBytes: 12 });
  assert.equal(rows[0].filename, "ok.pdf");
  assert.equal(rows[0].sizeBytes, 8);
});
