/**
 * Garde-fous route tampon mandat (même règle que PDF).
 * cd backend && node --test tests/mandatSignatureStamp.validation.test.js
 */

import { test } from "node:test";
import assert from "node:assert/strict";

function isValidMandatSignaturePayload(ms) {
  return !!(
    ms &&
    ms.signed === true &&
    typeof ms.signatureDataUrl === "string" &&
    ms.signatureDataUrl.indexOf("data:image") === 0
  );
}

test("signature mandat valide", () => {
  assert.equal(
    isValidMandatSignaturePayload({ signed: true, signatureDataUrl: "data:image/png;base64,xx" }),
    true
  );
});

test("signature mandat refusée si signed false", () => {
  assert.equal(isValidMandatSignaturePayload({ signed: false, signatureDataUrl: "data:image/png;base64,xx" }), false);
});

test("signature mandat refusée si data URL incorrecte", () => {
  assert.equal(isValidMandatSignaturePayload({ signed: true, signatureDataUrl: "https://x" }), false);
});
