/**
 * En-têtes super-admin / organisation — aligné sur frontend/src/services/orgContextStorage.ts.
 * Chargé en premier parmi les scripts DP pour que dp-draft-store, mandat-signature et dp-app
 * partagent la même logique (localStorage CRM).
 */
(function (global) {
  "use strict";

  /**
   * @param {Record<string, string>} headers
   */
  function applySuperAdminContextHeaders(headers) {
    if (typeof global.localStorage === "undefined" || !headers || typeof headers !== "object") return;
    try {
      if (global.localStorage.getItem("solarnext_super_admin") !== "1") return;
      var oid = global.localStorage.getItem("solarnext_current_organization_id");
      if (oid) headers["x-organization-id"] = oid;
      if (global.localStorage.getItem("solarnext_super_admin_edit_mode") === "1") {
        headers["x-super-admin-edit"] = "1";
      }
    } catch (e) {
      /* ignore */
    }
  }

  function __snReadDpAuthToken() {
    try {
      if (typeof global.__solarnextGetAuthToken === "function") {
        var t = global.__solarnextGetAuthToken();
        if (t) return t;
      }
    } catch (e) {}
    try {
      if (typeof global.localStorage !== "undefined") return global.localStorage.getItem("solarnext_token");
    } catch (e2) {}
    return null;
  }
  global.__solarnextDpAuthToken = __snReadDpAuthToken;
  global.__solarnextDpApplySuperAdminContextHeaders = applySuperAdminContextHeaders;
})(typeof window !== "undefined" ? window : this);
