// ======================================================================
// Feature flags frontend — lecture via API /api/feature-flags
// Défaut OFF si absent ou erreur.
// ======================================================================

(function () {
  var cache = null;

  /**
   * Charge les flags depuis le backend et met en cache.
   * @returns {Promise<{ calpinageEnabled: boolean }>}
   */
  function getFeatureFlags() {
    if (cache) return Promise.resolve(cache);
    var base =
      typeof window !== "undefined" && window.__VITE_API_URL__ != null
        ? String(window.__VITE_API_URL__).trim().replace(/\/$/, "")
        : "";
    var url = base + "/api/feature-flags";
    return fetch(url)
      .then(function (r) { return r.ok ? r.json() : { calpinageEnabled: false }; })
      .catch(function () { return { calpinageEnabled: false }; })
      .then(function (data) {
        cache = data;
        return data;
      });
  }

  /**
   * Retourne true si Calpinage est activé (après au moins un getFeatureFlags() réussi).
   * @returns {boolean}
   */
  function isCalpinageEnabled() {
    return cache ? cache.calpinageEnabled === true : false;
  }

  window.getFeatureFlags = getFeatureFlags;
  window.isCalpinageEnabled = isCalpinageEnabled;
})();
