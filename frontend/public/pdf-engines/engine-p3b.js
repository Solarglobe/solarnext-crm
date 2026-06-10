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

  /** Degrés lisibles client : 1 décimale max, virgule française. Ex: 37.76 → "37,8°" ; 30 → "30°" */
  function formatDegrees(val) {
    if (val === null || val === undefined || val === "") return "—";
    var s = String(val).replace(/°/g, "").trim();
    var n = parseFloat(s);
    if (!Number.isFinite(n)) return s ? String(val) : "—";
    var one = Math.round(n * 10) / 10;
    return (one % 1 === 0 ? String(Math.round(one)) : one.toFixed(1).replace(".", ",")) + "°";
  }

  /** Azimut (0 = Nord, 180 = Sud — convention moteur) → rose des vents française 16 directions. */
  var CARDINALS_FR = [
    "Nord", "Nord-Nord-Est", "Nord-Est", "Est-Nord-Est",
    "Est", "Est-Sud-Est", "Sud-Est", "Sud-Sud-Est",
    "Sud", "Sud-Sud-Ouest", "Sud-Ouest", "Ouest-Sud-Ouest",
    "Ouest", "Ouest-Nord-Ouest", "Nord-Ouest", "Nord-Nord-Ouest",
  ];
  function formatOrientation(val) {
    if (val === null || val === undefined || val === "") return "—";
    var s = String(val).replace(/°/g, "").trim();
    var n = parseFloat(s);
    if (!Number.isFinite(n) || /[a-zA-Z]/.test(s)) {
      /* Déjà textuel (backend mappe S/SE/SO… vers le nom complet) */
      return s ? String(val) : "—";
    }
    var a = ((n % 360) + 360) % 360;
    var cardinal = CARDINALS_FR[Math.round(a / 22.5) % 16];
    return cardinal + " (" + Math.round(a) + "°)";
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
    set("p3b_orientation", formatOrientation(a.orientation));
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
