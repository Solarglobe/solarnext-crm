import test from "node:test";
import assert from "node:assert/strict";

import {
  normalizeImapFlagsForJson,
  serializeJsonbValue,
} from "../services/mail/mailSync.service.js";

test("IMAP flags are serialized as JSON array, not PostgreSQL array syntax", () => {
  const flags = normalizeImapFlagsForJson(new Set(["\\Seen", "\\Answered"]));
  const json = serializeJsonbValue("external_flags", flags);

  assert.deepEqual(flags, ["\\Seen", "\\Answered"]);
  assert.equal(json, '["\\\\Seen","\\\\Answered"]');
  assert.deepEqual(JSON.parse(json), ["\\Seen", "\\Answered"]);
  assert.notEqual(json, '{"\\\\Seen","\\\\Answered"}');
});

test("mail_messages jsonb serialization preserves objects for raw_headers", () => {
  const headers = { subject: "Hello", references: ["<a@x>", "<b@x>"] };
  const json = serializeJsonbValue("raw_headers", headers);

  assert.equal(typeof json, "string");
  assert.deepEqual(JSON.parse(json), headers);
});
