/**
 * Backoff for IMAP flag mutations. Shorter than SMTP delivery because read
 * state convergence is expected to happen within the mail sync polling window.
 */

/**
 * @param {number} failedAttemptNumber
 * @returns {number}
 */
export function delayMsAfterFlagMutationFailure(failedAttemptNumber) {
  if (failedAttemptNumber <= 0) return 0;
  if (failedAttemptNumber === 1) return 15_000;
  if (failedAttemptNumber === 2) return 30_000;
  if (failedAttemptNumber === 3) return 60_000;
  if (failedAttemptNumber === 4) return 5 * 60_000;
  return 15 * 60_000;
}
