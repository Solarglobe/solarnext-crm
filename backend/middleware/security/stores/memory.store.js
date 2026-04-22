/**
 * CP-076 — Implémentation mémoire (process unique).
 */

/**
 * @implements {import("./rateLimitStore.interface.js").IRateLimitStore}
 */
export class MemoryRateLimitStore {
  constructor() {
    /** @type {Map<string, { count: number, resetAt: number }>} */
    this.map = new Map();
    this._pruneInterval = setInterval(() => this._prune(), 5 * 60 * 1000);
    if (typeof this._pruneInterval.unref === "function") {
      this._pruneInterval.unref();
    }
  }

  _prune() {
    const now = Date.now();
    for (const [k, v] of this.map.entries()) {
      if (now >= v.resetAt) this.map.delete(k);
    }
  }

  /** @param {string} key */
  _getRaw(key) {
    const now = Date.now();
    const bucket = this.map.get(key);
    if (!bucket || now >= bucket.resetAt) {
      if (bucket) this.map.delete(key);
      return null;
    }
    return bucket;
  }

  /**
   * Middleware : une requête = +1, max par fenêtre.
   * @param {string} key
   * @param {number} windowMs
   * @param {number} max
   */
  async consumeQuota(key, windowMs, max) {
    const now = Date.now();
    let bucket = this.map.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.map.set(key, bucket);
    }
    bucket.count += 1;
    if (bucket.count > max) {
      return { allowed: false, retryAfterMs: Math.max(0, bucket.resetAt - now) };
    }
    return { allowed: true, remaining: max - bucket.count };
  }

  /**
   * Login : +1 échec dans la fenêtre (ne pas appeler sur succès).
   * @param {string} key
   * @param {number} windowMs
   */
  async increment(key, windowMs) {
    const now = Date.now();
    let bucket = this.map.get(key);
    if (!bucket || now >= bucket.resetAt) {
      bucket = { count: 0, resetAt: now + windowMs };
      this.map.set(key, bucket);
    }
    bucket.count += 1;
    return { count: bucket.count, resetAt: bucket.resetAt };
  }

  /** @param {string} key */
  async get(key) {
    const b = this._getRaw(key);
    if (!b) return null;
    return { count: b.count, resetAt: b.resetAt };
  }

  /** @param {string} key */
  async reset(key) {
    this.map.delete(key);
  }

  /** @param {string} key */
  async ttl(key) {
    const b = this._getRaw(key);
    if (!b) return 0;
    return Math.max(0, b.resetAt - Date.now());
  }
}
