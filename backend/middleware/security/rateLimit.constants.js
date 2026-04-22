/** Réponse JSON standard 429 (réutilisée middleware + login). */
export const RATE_LIMIT_BODY = {
  error: "RATE_LIMITED",
  message: "Too many requests. Please try again later.",
};
