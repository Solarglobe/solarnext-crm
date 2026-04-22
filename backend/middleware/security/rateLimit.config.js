/**
 * CP-076 — Configuration rate limit via variables d'environnement.
 */

function intEnv(name, def) {
  const v = process.env[name];
  if (v == null || v === "") return def;
  const n = parseInt(v, 10);
  return Number.isFinite(n) && n > 0 ? n : def;
}

function msEnv(name, def) {
  return intEnv(name, def);
}

export const rateLimitEnv = {
  loginMax: intEnv("RATE_LIMIT_LOGIN_MAX", 5),
  loginWindowMs: msEnv("RATE_LIMIT_LOGIN_WINDOW_MS", 15 * 60 * 1000),

  /** Routes authentifiées sensibles (RGPD, mail send, uploads, réglages org, etc.) */
  sensitiveMax: intEnv("RATE_LIMIT_USER_SENSITIVE_MAX", 30),
  sensitiveWindowMs: msEnv("RATE_LIMIT_USER_SENSITIVE_WINDOW_MS", 60 * 1000),

  /** Opérations coûteuses authentifiées (PDF devis, finalisation signée, validations lourdes) */
  heavyMax: intEnv("RATE_LIMIT_HEAVY_MAX", 10),
  heavyWindowMs: msEnv("RATE_LIMIT_HEAVY_WINDOW_MS", 60 * 1000),

  /** Routes non authentifiées coûteuses (calc CSV, rendu PDF Playwright, calpinage fichier) */
  publicHeavyMax: intEnv("RATE_LIMIT_PUBLIC_HEAVY_MAX", 15),
  publicHeavyWindowMs: msEnv("RATE_LIMIT_PUBLIC_HEAVY_WINDOW_MS", 60 * 1000),
};
