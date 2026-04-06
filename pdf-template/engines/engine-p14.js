// ======================================================================
// ENGINE-P14 — Solarglobe (Version Officielle)
// ----------------------------------------------------------------------
// Hydrate automatiquement : client / ref / date
// Écoute p14:update depuis ENGINE-MAIN
// Aucun calcul : hydratation simple et propre
// ======================================================================

(function(){

  // ------------------------------------------------------------
  // Helper simple pour remplir un texte
  // ------------------------------------------------------------
  function set(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (val !== null && val !== undefined && val !== "") ? String(val) : "—";
  }

  // ------------------------------------------------------------
  // RENDER PRINCIPAL
  // ------------------------------------------------------------
  function renderP14(payload){
    if (!payload) return;

    const meta = payload.meta || {};

    set("p14_client", meta.client || "—");
    set("p14_ref",    meta.ref    || "—");
    set("p14_date",   meta.date   || "—");

    // Si un jour tu ajoutes du contenu technique ou particulier...
    // tu le remplis ici.
  }

  // ------------------------------------------------------------
  // BINDING AVEC ENGINE-MAIN
  // ------------------------------------------------------------
  const API = (window.SmartPitch = window.SmartPitch || {});
  API.renderP14 = renderP14;

  API.bindEngineP14 = function(engine){
    if (!engine) return;

    // écoute de p14:update
    engine.on("p14:update", data => {
      renderP14(data);
    });

    // 1er rendu si déjà présent
    if (typeof engine.getP14 === "function") {
      const first = engine.getP14();
      if (first) renderP14(first);
    }
  };

  // auto-bind si Engine existe déjà au moment du chargement
  if (window.Engine) {
    API.bindEngineP14(window.Engine);
  }

})();
