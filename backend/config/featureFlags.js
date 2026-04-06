// ======================================================================
// Feature flags — lecture process.env, défaut OFF si absent
// ======================================================================
// CALPINAGE_ENABLED : "1", "true", "TRUE", "on" = ON, sinon OFF
// ======================================================================

/**
 * @returns {boolean} true si CALPINAGE_ENABLED est considéré comme activé
 */
export function isCalpinageEnabled() {
  const raw = process.env.CALPINAGE_ENABLED;
  if (raw == null || typeof raw !== "string") return false;
  const v = raw.trim().toLowerCase();
  return v === "1" || v === "true" || v === "on";
}
