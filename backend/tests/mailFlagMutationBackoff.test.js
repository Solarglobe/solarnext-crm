import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { delayMsAfterFlagMutationFailure } from "../services/mail/mailFlagMutationBackoff.service.js";

describe("mail flag mutation backoff", () => {
  it("retente vite les flags puis plafonne", () => {
    assert.equal(delayMsAfterFlagMutationFailure(0), 0);
    assert.equal(delayMsAfterFlagMutationFailure(1), 15_000);
    assert.equal(delayMsAfterFlagMutationFailure(2), 30_000);
    assert.equal(delayMsAfterFlagMutationFailure(3), 60_000);
    assert.equal(delayMsAfterFlagMutationFailure(4), 5 * 60_000);
    assert.equal(delayMsAfterFlagMutationFailure(8), 15 * 60_000);
  });
});
