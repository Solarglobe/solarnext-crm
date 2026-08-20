import test from "node:test";
import assert from "node:assert/strict";

import { classifyAttachmentRisk, scanMailAttachmentBuffer } from "../services/mail/mailAttachmentScan.service.js";

test("7 attachment policy blocks active and double-extension files", () => {
  assert.equal(classifyAttachmentRisk({ filename: "invoice.pdf.exe", mimeType: "application/pdf", sizeBytes: 10 }).action, "blocked");
  assert.equal(classifyAttachmentRisk({ filename: "logo.svg", mimeType: "image/svg+xml", sizeBytes: 10 }).action, "blocked");
  assert.equal(classifyAttachmentRisk({ filename: "quote.pdf", mimeType: "application/pdf", sizeBytes: 10 }).action, "scan_required");
});

test("7 deterministic scanner never marks eicar-like files clean", async () => {
  const prev = process.env.MAIL_ATTACHMENT_SCANNER;
  process.env.MAIL_ATTACHMENT_SCANNER = "deterministic";
  const scan = await scanMailAttachmentBuffer({
    buffer: Buffer.from("fixture"),
    filename: "eicar.txt",
    mimeType: "text/plain",
  });
  if (prev == null) delete process.env.MAIL_ATTACHMENT_SCANNER;
  else process.env.MAIL_ATTACHMENT_SCANNER = prev;
  assert.equal(scan.status, "INFECTED");
});

test("7 mail route uses CRM recipient suggestions service and rate limiting", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../routes/mail.routes.js", import.meta.url), "utf8");
  assert.match(src, /listMailRecipientSuggestions/);
  assert.match(src, /heavyUserRateLimiter/);
  assert.match(src, /\/recipient-suggestions/);
});

test("7 recipient suggestions service queries CRM and mail participants with organization scope", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../services/mail/mailRecipientSuggestions.service.js", import.meta.url), "utf8");
  assert.match(src, /FROM clients/);
  assert.match(src, /FROM client_contacts/);
  assert.match(src, /FROM leads/);
  assert.match(src, /mail_participants/);
  assert.match(src, /organizationId/);
  assert.match(src, /assigned_user_id/);
});

test("7 frontend mail message renders HTML in sandbox iframe and blocks remote images", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../../frontend/src/pages/mail/MailThreadMessage.tsx", import.meta.url), "utf8");
  assert.match(src, /<iframe/);
  assert.match(src, /sandbox="allow-popups"/);
  assert.match(src, /Les images distantes ont été bloquées/);
});

test("7 outbox streams SMTP attachments by path and bounds frozen MIME reads", async () => {
  const fs = await import("node:fs");
  const src = fs.readFileSync(new URL("../services/mail/mailOutbox.processor.js", import.meta.url), "utf8");
  assert.match(src, /path: abs/);
  assert.match(src, /MIME_FREEZE_MAX_BYTES/);
  assert.match(src, /scan_status = 'CLEAN'/);
});

test("7 health endpoint exposes queue and scan diagnostics without secrets", async () => {
  const fs = await import("node:fs");
  const route = fs.readFileSync(new URL("../routes/mailSync.routes.js", import.meta.url), "utf8");
  const service = fs.readFileSync(new URL("../services/mail/mailHealth.service.js", import.meta.url), "utf8");
  assert.match(route, /\/sync\/health/);
  assert.match(route, /requireMailAccountsManageStrict/);
  assert.match(service, /scanInfected/);
  assert.doesNotMatch(service, /encrypted_credentials|password|access_token|refresh_token/i);
});
