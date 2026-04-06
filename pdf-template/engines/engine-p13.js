// ======================================================================
// ENGINE-P13 — Solarglobe (Version Officielle)
// ----------------------------------------------------------------------
// Remplit automatiquement : client / ref / date
// Écoute p13:update depuis ENGINE-MAIN
// Aucun calcul → hydratation pure
// ======================================================================

(function(){

  // Helper simple
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  // ============================================================
  // RENDER
  // ============================================================
  function renderP13(payload){
    if(!payload) return;

    const meta = payload.meta || {};

    set("p13_client", meta.client || "—");
    set("p13_ref",    meta.ref    || "—");
    set("p13_date",   meta.date   || "—");

    // 🔽 Si plus tard la page contient du contenu spécifique,
    // tu ajoutes ici les affectations nécessaires.
  }

  // ============================================================
  // BIND ENGINE
  // ============================================================
  const API = (window.SmartPitch = window.SmartPitch || {});
  API.renderP13 = renderP13;

  API.bindEngineP13 = function(engine){
    if(!engine) return;

    // écoute p13:update
    engine.on("p13:update", data => {
      renderP13(data);
    });

    // 1er rendu si déjà chargé
    if(typeof engine.getP13 === "function"){
      const first = engine.getP13();
      if(first) renderP13(first);
    }
  };

  // auto-bind si Engine déjà chargé
  if(window.Engine){
    API.bindEngineP13(window.Engine);
  }

})();
