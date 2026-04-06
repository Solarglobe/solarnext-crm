// ============================================================================
// ENGINE-P3B — Calepinage toiture (SmartPitch V3 — Solarglobe)
// Données uniquement depuis le JSON backend — aucune transformation
// ============================================================================

(function () {

  function set(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = (val === null || val === undefined || val === "") ? "—" : String(val);
  }

  /** Formate valeur numérique en degrés : max 2 décimales. Ex: 178.34567 → "178.35°" */
  function formatDegrees(val) {
    if (val === null || val === undefined || val === "") return "—";
    var s = String(val).replace(/°/g, "").trim();
    var n = parseFloat(s);
    if (Number.isFinite(n)) return Number(n).toFixed(2) + "°";
    return s ? String(val) : "—";
  }

  // --------------------------------------------------------------------------
  // Rendu principal — payload JSON → DOM
  // --------------------------------------------------------------------------
  function renderFromPayload(payload) {
    if (!payload) return;

    const a = payload.p3b_auto || payload;

    // META
    set("p3b_client", a.client);
    set("p3b_ref", a.ref);
    set("p3b_date", a.date);

    // Toiture — orientation et inclinaison avec 2 décimales max
    set("p3b_inclinaison", formatDegrees(a.inclinaison));
    set("p3b_orientation", formatDegrees(a.orientation));
    set("p3b_surface", a.surface_m2);
    set("p3b_panneaux", a.nb_panneaux);

    // Plan calpinage — image gérée uniquement par PdfPage3.tsx (React) pour éviter doublon
  }

  // --------------------------------------------------------------------------
  // Listener ENGINE
  // --------------------------------------------------------------------------
  if (window.Engine) {
    Engine.on("p3b:update", payload => {
      renderFromPayload(payload);
    });
  }

})();
