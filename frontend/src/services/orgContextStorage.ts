/**
 * CP-078 — Persistance sélection d’organisation (SUPER_ADMIN) pour l’en-tête API.
 * Hors React : utilisé par apiFetch.
 */

const LS_ORG = "solarnext_current_organization_id";
const LS_SUPER = "solarnext_super_admin";
/** CP-078B : "0" lecture seule, "1" édition autorisée (en-tête x-super-admin-edit). */
const LS_SUPER_EDIT = "solarnext_super_admin_edit_mode";

export function applyOrganizationHeaders(headers: Record<string, string>): void {
  if (typeof window === "undefined") return;
  if (localStorage.getItem(LS_SUPER) !== "1") return;
  const oid = localStorage.getItem(LS_ORG);
  if (oid) {
    headers["x-organization-id"] = oid;
  }
  if (localStorage.getItem(LS_SUPER_EDIT) === "1") {
    headers["x-super-admin-edit"] = "1";
  }
}
