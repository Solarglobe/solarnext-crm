// ======================================================================
// ENGINE-P12 — Meta uniquement (page 12 = clôture premium React, sans donut)
// Client / ref / date pour les spans #p12_client, #p12_ref, #p12_date
// ======================================================================

(function () {
  "use strict";

  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v;
  };

  function renderP12Meta(payload) {
    if (!payload) return;
    const meta = payload.meta || {};
    set("p12_client", meta.client || "—");
    set("p12_ref", meta.ref || "—");
    set("p12_date", meta.date_display || meta.date || "—");
  }

  const API = (window.SmartPitch = window.SmartPitch || {});
  API.renderP12 = renderP12Meta;

  API.bindEngineP12 = function (engine) {
    if (!engine) return;
    engine.on("p12:update", function (data) {
      renderP12Meta(data);
    });
    if (typeof engine.getP12 === "function") {
      const first = engine.getP12();
      if (first) renderP12Meta(first);
    }
  };

  if (window.Engine) {
    API.bindEngineP12(window.Engine);
  }
})();
