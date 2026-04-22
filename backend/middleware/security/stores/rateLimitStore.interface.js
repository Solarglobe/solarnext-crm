/**
 * CP-076 — Contrat store rate limit (mémoire ou Redis).
 *
 * @typedef {{ allowed: boolean, remaining?: number, retryAfterMs?: number }} ConsumeResult
 * @typedef {{ count: number, resetAt: number }} WindowState
 *
 * @typedef {Object} IRateLimitStore
 * @property {(key: string, windowMs: number, max: number) => Promise<ConsumeResult>} consumeQuota — chaque appel = 1 requête (middleware)
 * @property {(key: string, windowMs: number) => Promise<WindowState>} increment — +1 dans la fenêtre (échecs login)
 * @property {(key: string) => Promise<WindowState | null>} get — état courant (fenêtre non expirée)
 * @property {(key: string) => Promise<void>} reset
 * @property {(key: string) => Promise<number>} ttl — ms restantes avant resetAt, 0 si absent/expiré
 */

export {};
