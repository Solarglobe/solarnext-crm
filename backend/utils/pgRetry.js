/**
 * Erreurs PostgreSQL typiques de concurrence / verrous — au plus une nouvelle tentative.
 */

export function isPgRetryableConcurrencyError(err) {
  if (!err || !err.code) return false;
  return err.code === "40P01" || err.code === "40001" || err.code === "55P03";
}

/**
 * @template T
 * @param {() => Promise<T>} fn
 * @param {{ maxAttempts?: number, delayMs?: number }} [opts]
 * @returns {Promise<T>}
 */
export async function withPgRetryOnce(fn, opts = {}) {
  const maxAttempts = opts.maxAttempts ?? 2;
  const delayMs = opts.delayMs ?? 25;
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastErr = e;
      if (attempt < maxAttempts && isPgRetryableConcurrencyError(e)) {
        await new Promise((r) => setTimeout(r, delayMs + Math.floor(Math.random() * delayMs)));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}
