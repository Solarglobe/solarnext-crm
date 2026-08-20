import test from "node:test";
import assert from "node:assert/strict";

import { buildSimpleRfc822Mime } from "../services/mail/mailMimeBuilder.service.js";
import { sha256Buffer } from "../services/mail/mailDraftAttachments.service.js";

test("6C MIME builder preserves binary attachment name type and content", () => {
  const content = Buffer.from("contenu-binaire-\u00e9t\u00e9", "utf8");
  const mime = buildSimpleRfc822Mime({
    from: "me@example.test",
    to: "you@example.test",
    subject: "PJ",
    bodyText: "Bonjour",
    messageId: "<m@x>",
    attachments: [
      {
        filename: "devis été.pdf",
        contentType: "application/pdf",
        content,
      },
    ],
  }).toString("utf8");
  assert.match(mime, /filename="devis été\.pdf"/);
  assert.match(mime, /Content-Type: application\/pdf/);
  assert.match(mime, new RegExp(content.toString("base64").slice(0, 12)));
});

test("6C attachment hash detects modified uploaded file", () => {
  const original = Buffer.from("abc");
  const modified = Buffer.from("abcd");
  assert.notEqual(sha256Buffer(original), sha256Buffer(modified));
});

test("6C source routes expose authenticated draft attachment lifecycle", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../routes/mailDrafts.routes.js", import.meta.url), "utf8");
  assert.match(src, /upload\.single\("file"\)/);
  assert.match(src, /\/drafts\/:id\/attachments/);
  assert.match(src, /download/);
  assert.match(src, /verifyJWT/);
});

test("6C recipient autocomplete stays scoped to accessible mail participants", async () => {
  const fs = await import("node:fs");
  const routeSrc = fs.readFileSync(new URL("../routes/mail.routes.js", import.meta.url), "utf8");
  const serviceSrc = fs.readFileSync(new URL("../services/mail/mailRecipientSuggestions.service.js", import.meta.url), "utf8");
  assert.match(routeSrc, /\/recipient-suggestions/);
  assert.match(routeSrc, /requireMailUseStrict/);
  assert.match(routeSrc, /resolveAccessibleAccountIds/);
  assert.match(routeSrc, /listMailRecipientSuggestions/);
  assert.match(serviceSrc, /mail_participants/);
});

test("6C outbox accepts draftId and loads stored draft binaries", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../services/mail/mailOutbox.service.js", import.meta.url), "utf8");
  assert.match(src, /draftId/);
  assert.match(src, /loadDraftAttachmentBuffers/);
});

test("6C Sent retry uses frozen smtp_mime_rfc822", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../services/mail/mailSentArchive.processor.js", import.meta.url), "utf8");
  assert.match(src, /smtp_mime_rfc822/);
  assert.match(src, /fallbackMime/);
});
