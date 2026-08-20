import test from "node:test";
import assert from "node:assert/strict";
import { createImapClient } from "../services/mail/imap.service.js";

const required = [
  "MAIL_E2E_IMAP_HOST",
  "MAIL_E2E_IMAP_PORT",
  "MAIL_E2E_IMAP_USER",
  "MAIL_E2E_IMAP_PASSWORD",
];

const enabled = required.every((k) => process.env[k]);

test("optional live IMAP smoke for Drafts/Sent is explicitly gated", { skip: enabled ? false : "MAIL_E2E_IMAP_* absent" }, async () => {
  const client = await createImapClient({
    host: process.env.MAIL_E2E_IMAP_HOST,
    port: Number(process.env.MAIL_E2E_IMAP_PORT),
    secure: process.env.MAIL_E2E_IMAP_SECURE !== "0",
    auth: {
      user: process.env.MAIL_E2E_IMAP_USER,
      password: process.env.MAIL_E2E_IMAP_PASSWORD,
    },
  });
  try {
    const box = await client.mailboxOpen("INBOX");
    assert.ok(box);
  } finally {
    await client.logout().catch(() => {});
  }
});

