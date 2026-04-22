/**
 * Horodatage officiel signatures devis (metadata_json).
 * cd backend && node --test tests/quoteSignatureMetadataTimestamp.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { parseQuoteSignatureMetadataAcceptance } from "../services/documents.service.js";

test("parseQuoteSignatureMetadataAcceptance : signedAtServer prioritaire sur generated_at", () => {
  const row = {
    accepted: true,
    acceptedLabel: "Lu",
    signedAtServer: "2026-04-20T12:00:00.000Z",
    generated_at: "2020-01-01T00:00:00.000Z",
  };
  const p = parseQuoteSignatureMetadataAcceptance(JSON.stringify(row));
  assert.equal(p.recordedAt, "2026-04-20T12:00:00.000Z");
  assert.equal(p.signedAtServer, "2026-04-20T12:00:00.000Z");
});

test("parseQuoteSignatureMetadataAcceptance : fallback generated_at si pas signedAtServer (historique)", () => {
  const row = {
    accepted: true,
    acceptedLabel: "Lu",
    generated_at: "2025-06-01T08:30:00.000Z",
  };
  const p = parseQuoteSignatureMetadataAcceptance(JSON.stringify(row));
  assert.equal(p.signedAtServer, null);
  assert.equal(p.recordedAt, "2025-06-01T08:30:00.000Z");
});
