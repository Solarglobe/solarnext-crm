/**
 * Délais entre tentatives après un échec SMTP (tentative n = 1…3 avant la suivante).
 */

/**
 * @param {number} failedAttemptNumber — nombre d’échecs déjà enregistrés (1 = après la 1ʳᵉ tentative ratée).
 * @returns {number} délai en ms avant la prochaine tentative
 */
export function delayMsAfterFailedAttempt(failedAttemptNumber) {
  if (failedAttemptNumber <= 0) return 0;
  if (failedAttemptNumber === 1) return 60_000;
  if (failedAttemptNumber === 2) return 5 * 60_000;
  if (failedAttemptNumber === 3) return 15 * 60_000;
  return 15 * 60_000;
}
