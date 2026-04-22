/**
 * CP-076 — Store Redis (partagé entre instances). Nécessite `ioredis` + REDIS_URL.
 */

/**
 * @implements {import("./rateLimitStore.interface.js").IRateLimitStore}
 */
export class RedisRateLimitStore {
  /**
   * @param {import("ioredis").default} redis
   * @param {string} [keyPrefix]
   */
  constructor(redis, keyPrefix = "rl:v1:") {
    this.redis = redis;
    this.prefix = keyPrefix;
  }

  /** @param {string} key */
  _k(key) {
    return `${this.prefix}${key}`;
  }

  /**
   * consumeQuota — INCR + PEXPIRE au premier hit, refuse si > max
   */
  async consumeQuota(key, windowMs, max) {
    const k = this._k(`q:${key}`);
    const script = `
      local c = redis.call('INCR', KEYS[1])
      if c == 1 then
        redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
      end
      local maxv = tonumber(ARGV[2])
      local ttl = redis.call('PTTL', KEYS[1])
      if ttl < 0 then ttl = 0 end
      if c > maxv then
        return {0, ttl}
      end
      return {1, maxv - c, ttl}
    `;
    const r = await this.redis.eval(script, 1, k, String(windowMs), String(max));
    const arr = Array.isArray(r) ? r : [r];
    const allowed = arr[0] === 1;
    if (!allowed) {
      const ttlMs = Number(arr[1]) || 0;
      return { allowed: false, retryAfterMs: Math.max(0, ttlMs) };
    }
    return { allowed: true, remaining: arr[1] };
  }

  /**
   * increment — +1 (échecs login), fenêtre au premier hit
   */
  async increment(key, windowMs) {
    const k = this._k(`i:${key}`);
    const script = `
      local c = redis.call('INCR', KEYS[1])
      if c == 1 then
        redis.call('PEXPIRE', KEYS[1], tonumber(ARGV[1]))
      end
      local ttl = redis.call('PTTL', KEYS[1])
      if ttl < 0 then ttl = 0 end
      return {c, ttl}
    `;
    const r = await this.redis.eval(script, 1, k, String(windowMs));
    const arr = Array.isArray(r) ? r : [r];
    const count = arr[0];
    const ttl = arr[1] ?? 0;
    const resetAt = Date.now() + ttl;
    return { count, resetAt };
  }

  async get(key) {
    const k = this._k(`i:${key}`);
    const raw = await this.redis.get(k);
    if (raw == null) return null;
    const pttl = await this.redis.pttl(k);
    if (pttl == null || pttl < 0) return null;
    const count = parseInt(String(raw), 10);
    if (!Number.isFinite(count)) return null;
    return { count, resetAt: Date.now() + pttl };
  }

  async reset(key) {
    const k = this._k(`i:${key}`);
    const kq = this._k(`q:${key}`);
    await this.redis.del(k, kq);
  }

  async ttl(key) {
    const k = this._k(`i:${key}`);
    const t = await this.redis.pttl(k);
    if (t == null || t < 0) return 0;
    return t;
  }
}
