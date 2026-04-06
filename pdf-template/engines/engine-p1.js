// ======================================================================
// ENGINE-P1 — Solarglobe (overlay + arrondis propres)
// - Affiche P1
// - Extrait la consommation annuelle
// - L’envoie à ERPNext (API receive_smartpitch_conso)
// ======================================================================

(function () {

  // --------------------------------------------------------------
  // ARRONDI — entier supérieur + format FR
  // --------------------------------------------------------------
  function round(v) {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(String(v).replace(",", "."));
    if (!Number.isFinite(n)) return v;
    return Math.ceil(n).toLocaleString("fr-FR");
  }

  // --------------------------------------------------------------
  // SETTER DOM
  // --------------------------------------------------------------
  function set(id, val) {
    const el = document.getElementById(id);
    if (!el) return;

    if (typeof val === "number" || /^[0-9\.,\s]+$/.test(String(val))) {
      el.textContent = round(val);
    } else {
      el.textContent = (val !== null && val !== undefined && val !== "") ? val : "—";
    }
  }

  // --------------------------------------------------------------
  // RENDER P1
  // --------------------------------------------------------------
  function renderP1(payload) {
    if (!payload || !payload.p1_auto) {
      console.warn("⚠ renderP1 ignorée : payload invalide");
      return;
    }

    const a = payload.p1_auto;

    console.group("📄 HYDRATATION P1");
    console.log("p1_auto :", a);

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

    // PARAMÈTRES
    set("p1_param_kva", a.p1_param_kva);
    set("p1_param_reseau", a.p1_param_reseau);
    set("p1_param_conso", a.p1_param_conso);

    console.log("✔ P1 affichée");
    console.groupEnd();
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

    fetch("https://solarnext-crm.fr/api/method/receive_smartpitch_conso", {
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
  // BIND ENGINE
  // --------------------------------------------------------------
  window.API.bindEngineP1 = function (engine) {
    if (!engine) {
      console.error("❌ Engine introuvable");
      return;
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
