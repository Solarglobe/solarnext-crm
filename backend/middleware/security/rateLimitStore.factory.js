/**
 * CP-076 — Instance unique de store (memory | redis selon env).
 */

import { MemoryRateLimitStore } from "./stores/memory.store.js";

/** @type {Promise<import("./stores/rateLimitStore.interface.js").IRateLimitStore>} */
let storePromise = null;

/**
 * @returns {Promise<import("./stores/rateLimitStore.interface.js").IRateLimitStore>}
 */
export function getRateLimitStore() {
  if (!storePromise) {
    storePromise = createStore();
  }
  return storePromise;
}

async function createStore() {
  const mode = (process.env.RATE_LIMIT_STORE || "memory").toLowerCase().trim();
  if (mode === "redis") {
    const url = process.env.REDIS_URL;
    if (!url || String(url).trim() === "") {
      throw new Error("CP-076: RATE_LIMIT_STORE=redis nécessite REDIS_URL");
    }
    let IORedis;
    try {
      ({ default: IORedis } = await import("ioredis"));
    } catch (e) {
      throw new Error(
        "CP-076: installez ioredis pour RATE_LIMIT_STORE=redis (npm i ioredis)"
      );
    }
    const redis = new IORedis(url, {
      maxRetriesPerRequest: 2,
      enableReadyCheck: true,
    });
    const { RedisRateLimitStore } = await import("./stores/redis.store.js");
    return new RedisRateLimitStore(redis);
  }
  return new MemoryRateLimitStore();
}

/** Tests uniquement : réinitialise le singleton. */
export function __resetRateLimitStoreForTests() {
  storePromise = null;
}
