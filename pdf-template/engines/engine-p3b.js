// ============================================================================
// ENGINE-P3B — Calepinage toiture (SmartPitch V3 — Solarglobe)
// Remplissage depuis le backend + calcul local panneaux/surface depuis settings
// ============================================================================

(function () {

  const $ = (s, r = document) => r.querySelector(s);
  const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });

  // --------------------------------------------------------------------------
  // Helpers
  // --------------------------------------------------------------------------
  function set(id, val) {
    const el = document.getElementById(id);
    if (!el) return;

    if (val === null || val === undefined || String(val).trim() === "")
      el.textContent = "—";
    else
      el.textContent = String(val);
  }

  function mapOrientation(c) {
    if (!c) return "—";
    switch ((c + "").toUpperCase()) {
      case "S": return "Sud";
      case "SE": return "Sud-Est";
      case "SO":
      case "SW": return "Sud-Ouest";
      case "E": return "Est";
      case "O":
      case "W": return "Ouest";
      default: return c;
    }
  }

  function ls(key) {
    try { return JSON.parse(localStorage.getItem(key) || "{}"); }
    catch { return {}; }
  }

  // --------------------------------------------------------------------------
  // 🔥 CALCUL LOCAL : nb panneaux + surface (depuis settings.html)
  // --------------------------------------------------------------------------
  function computeLocalPanelData(a) {
    const settings = ls("smartpitch_settings") || {};
    const pvtech   = settings.pvtech   || {};
    const pricing  = settings.pricing  || {};

    // Puissance par panneau en kWc
    const panel_w = Number(pricing.kit_panel_power_w) || null; // ex : 485
    const panel_kwc = panel_w ? panel_w / 1000 : null;

    // Surface par panneau
    const panel_surface = Number(pvtech.panel_surface_m2) || null; // ex : 2.04

    // kWc installé → pris dans la page P1 déjà chargée
    let kwc = null;

    try {
      const p1 = window.Engine?.getP1();
      if (p1 && p1.p1_auto && p1.p1_auto.p1_m_kwc) {
        kwc = Number(
          String(p1.p1_auto.p1_m_kwc).replace(",", ".")
        );
      }
    } catch (e) {
      console.warn("⚠ Impossible de lire kwc depuis P1");
    }

    // ---- Calcul du nombre de panneaux ----
    if (!a.nb_panneaux && kwc && panel_kwc) {
      a.nb_panneaux = Math.round(kwc / panel_kwc);
    }

    // ---- Calcul de la surface ----
    if (!a.surface_m2 && a.nb_panneaux && panel_surface) {
      a.surface_m2 = a.nb_panneaux * panel_surface;
    }

    return a;
  }

  // --------------------------------------------------------------------------
  // Rendu principal depuis payload backend
  // --------------------------------------------------------------------------
  function renderFromPayload(payload) {
    if (!payload) return;

    let a = payload.p3b_auto || payload;

    // Injecter les valeurs calculées localement
    a = computeLocalPanelData(a);

    // META
    set("p3b_client", a.client);
    set("p3b_ref", a.ref);
    set("p3b_date", a.date);

    // Toiture
    set("p3b_inclinaison", a.inclinaison != null ? a.inclinaison : "—");
    set("p3b_orientation", mapOrientation(a.orientation));

    const surf = (a.surface_m2 != null ? nf1.format(a.surface_m2) : null);
    set("p3b_surface", surf);
    set("p3b_panneaux", a.nb_panneaux != null ? a.nb_panneaux : "—");

    // Photo (localStorage)
    const overrides = ls("smartpitch_overrides");
    const zone = $("#p3b_photo");
    if (zone) {
      const imgLS = overrides["p3b_photo"];
      if (imgLS) {
        zone.innerHTML = "";
        const im = document.createElement("img");
        im.src = imgLS;
        im.style.maxWidth = "100%";
        im.style.maxHeight = "100%";
        im.style.objectFit = "contain";
        zone.appendChild(im);
      }
    }
  }

  // --------------------------------------------------------------------------
  // Listener ENGINE → on récupère les données backend ici
  // --------------------------------------------------------------------------
  if (window.Engine) {
    Engine.on("p3b:update", payload => {
      console.log("HYDRATATION P3B (engine-p3b.js FINAL) :", payload);
      renderFromPayload(payload);
    });
  }

  // --------------------------------------------------------------------------
  // Fallback DOMContentLoaded (si ouverture hors SmartPitch)
  // --------------------------------------------------------------------------
  document.addEventListener("DOMContentLoaded", () => {
    const overrides = ls("smartpitch_overrides");
    const fallback = {
      client: overrides.p3b_client,
      ref: overrides.p3b_ref,
      date: overrides.p3b_date,
      inclinaison: overrides.p3b_inclinaison,
      orientation: overrides.p3b_orientation,
      nb_panneaux: overrides.p3b_panneaux,
      surface_m2: overrides.p3b_surface_m2
    };
    renderFromPayload({ p3b_auto: fallback });
  });

})();
