/**
 * Garde-fous finalisation devis signé (attestation « Bon pour accord »).
 * Usage : cd backend && node --test tests/finalizeSignedApproval.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";
import { assertFinalizeSignedClientReadApproval } from "../routes/quotes/service.js";

test("assertFinalizeSignedClientReadApproval : absent → 400", () => {
  assert.throws(
    () => assertFinalizeSignedClientReadApproval({}),
    (e) => e.statusCode === 400 && /Bon pour accord/.test(e.message)
  );
});

test("assertFinalizeSignedClientReadApproval : false → 400", () => {
  assert.throws(
    () => assertFinalizeSignedClientReadApproval({ client_read_approved: false }),
    (e) => e.statusCode === 400
  );
});

test("assertFinalizeSignedClientReadApproval : true OK", () => {
  assert.doesNotThrow(() => assertFinalizeSignedClientReadApproval({ client_read_approved: true }));
});

test("assertFinalizeSignedClientReadApproval : chaîne 'true' OK (tolérance JSON)", () => {
  assert.doesNotThrow(() => assertFinalizeSignedClientReadApproval({ client_read_approved: "true" }));
});
