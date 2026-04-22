/**
 * Mode RBAC centralisé (évite dépendances circulaires avec audit/logger).
 *
 * - off : pas de contrôle permission (défaut dev si RBAC_ENFORCE absent)
 * - enforce : 403 si permission manquante
 * - warn : log + laisse passer (activation progressive)
 *
 * En production, server.js force RBAC_ENFORCE=1 si la variable est absente.
 */

export function getRbacMode() {
  const v = (process.env.RBAC_ENFORCE || "").toLowerCase().trim();
  if (v === "1" || v === "true") return "enforce";
  if (v === "warn") return "warn";
  return "off";
}

/** Si false, le rôle SUPER_ADMIN est soumis aux mêmes vérifications de permission que les autres. */
export function isSuperAdminBypassEnabled() {
  const v = process.env.ENABLE_SUPER_ADMIN;
  if (v === undefined || v === "") return true;
  if (v === "0" || v === "false" || v === "FALSE") return false;
  return v === "1" || v === "true";
}
