// ======================================================================
// ENGINE-P1 — Solarglobe (overlay + arrondis propres)
// - Affiche P1
// - Extrait la consommation annuelle
// - L’envoie à ERPNext (API receive_smartpitch_conso)
// ======================================================================

(function () {

  // --------------------------------------------------------------
  // SETTER DOM — affiche exactement la valeur du JSON, sans transformation
  // --------------------------------------------------------------
  function set(id, val) {
    const el = document.getElementById(id);
    if (!el) return;

    if (val === null || val === undefined || val === "") {
      el.textContent = "—";
      return;
    }

    el.textContent = String(val);
  }

  // Format conso annuelle : nombre → "21 541 kWh/an"
  function formatConsoAnnuelle(val) {
    if (val == null || val === "" || Number.isNaN(Number(val))) return null;
    const n = Math.round(Number(val));
    return n.toLocaleString("fr-FR") + " kWh/an";
  }

  // --------------------------------------------------------------
  // RENDER P1
  // --------------------------------------------------------------
  function renderP1(payload) {
    if (!payload || !payload.p1_auto) {
      if (typeof window !== "undefined" && window.location?.hostname === "localhost") {
        console.warn("ENGINE_P1_UPDATE_RECEIVED: payload invalide", payload);
      }
      return;
    }

    const a = payload.p1_auto;

    if (typeof window !== "undefined" && window.location?.hostname === "localhost") {
      console.log("ENGINE_P1_UPDATE_RECEIVED", {
        p1_client: a.p1_client,
        p1_k_puissance: a.p1_k_puissance,
        p1_k_autonomie: a.p1_k_autonomie,
        p1_k_tri: a.p1_k_tri,
        p1_k_gains: a.p1_k_gains,
        p1_param_kva: a.p1_param_kva,
        p1_param_reseau: a.p1_param_reseau,
        p1_param_conso: a.p1_param_conso,
      });
    }

    // MÉTADONNÉES
    set("p1_client", a.p1_client);
    set("p1_ref", a.p1_ref);
    set("p1_date", a.p1_date);
    set("p1_why", a.p1_why);

    // MÉTHODE
    set("p1_m_kwc", a.p1_m_kwc);
    set("p1_m_auto", a.p1_m_auto);
    set("p1_m_gain", a.p1_m_gain);

    // KPI
    set("p1_k_puissance", a.p1_k_puissance);
    set("p1_k_autonomie", a.p1_k_autonomie);
    set("p1_k_tri", a.p1_k_tri);
    set("p1_k_gains", a.p1_k_gains);

    // PARAMÈTRES (p1_param_conso : nombre → format "21 541 kWh/an" côté front)
    set("p1_param_kva", a.p1_param_kva);
    set("p1_param_reseau", a.p1_param_reseau);
    set("p1_param_conso", formatConsoAnnuelle(a.p1_param_conso) ?? (typeof a.p1_param_conso === "string" ? a.p1_param_conso : null));

    if (typeof window !== "undefined" && window.location?.hostname === "localhost") {
      console.log("ENGINE_P1_VALUES_APPLIED");
    }
  }

  // --------------------------------------------------------------
  // ENVOI CONSO ANNUELLE → ERPNext
  // --------------------------------------------------------------
  function sendConsoToERP(payload) {
    const raw = payload?.p1_auto?.p1_param_conso; // ex: "13 000 kWh/an"
    const lead = payload?.p1_auto?.p1_ref;        // DOIT être CRM-LEAD-XXXX

    const conso = Number(String(raw).replace(/[^\d]/g, "")) || null;

    if (!lead || !conso) {
      console.warn("⚠ Envoi ERPNext ignoré", { lead, conso, raw });
      return;
    }

    console.log("📤 Envoi conso annuelle ERPNext", { lead, conso });

    var apiOrigin =
      typeof window !== "undefined" && window.__VITE_API_URL__
        ? String(window.__VITE_API_URL__).trim().replace(/\/$/, "")
        : "";
    if (!apiOrigin) {
      console.warn("⚠ Envoi ERPNext ignoré : window.__VITE_API_URL__ absent (définir VITE_API_URL au build)");
      return;
    }

    fetch(apiOrigin + "/api/method/receive_smartpitch_conso", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        lead: lead,
        conso_annuelle_kwh: conso
      })
    })
    .then(r => r.json())
    .then(res => {
      console.log("✅ ERPNext OK :", res);
    })
    .catch(err => {
      console.error("❌ ERPNext erreur :", err);
    });
  }

  // --------------------------------------------------------------
  // BIND ENGINE — window.API créé par engine-bridge.js avant ce script
  // --------------------------------------------------------------
  window.API.bindEngineP1 = function (engine) {
    if (!engine) {
      console.error("❌ Engine introuvable");
      return;
    }

    if (typeof window !== "undefined" && window.location?.hostname === "localhost") {
      console.log("ENGINE_P1_BOUND");
    }

    engine.on("p1:update", payload => {
      if (!payload || !payload.p1_auto) return;

      renderP1(payload);
      sendConsoToERP(payload);
    });

    // Cas P1 déjà chargée
    const first = engine.getP1();
    if (first && first.p1_auto) {
      renderP1(first);
      sendConsoToERP(first);
    }
  };

})();
