/**
 * Défense en profondeur : vérifie que l’entité chargée appartient au tenant du JWT.
 * À appeler après lecture d’une ligne contenant organization_id.
 *
 * @param {string | null | undefined} entityOrgId — organization_id de la ligne métier
 * @param {string | null | undefined} userOrgId — organizationId du contexte utilisateur
 * @throws {Error & { statusCode?: number, code?: string }}
 */
export function assertOrgOwnership(entityOrgId, userOrgId) {
  const u = userOrgId != null ? String(userOrgId) : "";
  if (!u) {
    const err = new Error("Organisation manquante");
    err.statusCode = 403;
    err.code = "MISSING_ORG_CONTEXT";
    throw err;
  }
  const e = entityOrgId != null ? String(entityOrgId) : "";
  if (!e || e !== u) {
    const err = new Error("Accès refusé");
    err.statusCode = 403;
    err.code = "ORG_OWNERSHIP_MISMATCH";
    throw err;
  }
}
