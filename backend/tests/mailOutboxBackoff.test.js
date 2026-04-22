import assert from "node:assert/strict";
import { delayMsAfterFailedAttempt } from "../services/mail/mailOutboxBackoff.service.js";

assert.equal(delayMsAfterFailedAttempt(1), 60_000);
assert.equal(delayMsAfterFailedAttempt(2), 5 * 60_000);
assert.equal(delayMsAfterFailedAttempt(3), 15 * 60_000);

console.log("mailOutboxBackoff OK");
