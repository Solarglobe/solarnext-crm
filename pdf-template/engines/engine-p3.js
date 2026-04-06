// ======================================================================
// ENGINE-P3 — Hydratation automatique de la page 3 (Offre chiffrée)
// Pattern Solarglobe Premium - identique P1/P2 (sans export ES module)
// ======================================================================

(function(){

  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });

  const fmt = (v, u = "") => {
    if (v === null || v === undefined || v === "") return "—";
    const n = Number(v);
    if (!Number.isFinite(n)) return v;
    return nf0.format(n) + (u ? " " + u : "");
  };

  const setIfEmpty = (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return;
    if (!el.textContent.trim() || el.textContent.trim() === "—") {
      el.textContent = val ?? "—";
    }
  };

  // ===============================================================
  // HYDRATATION PRINCIPALE
  // ===============================================================
  function hydrateP3(auto) {
    if (!auto) return;

    const meta    = auto.meta    || {};
    const offer   = auto.offer   || {};
    const finance = auto.finance || {};
    const tech    = auto.tech    || {};

    console.log("→ HYDRATATION P3 (engine-p3.js)", auto);

    // -------------------------
    // META
    // -------------------------
    setIfEmpty("#p3_client", meta.client);
    setIfEmpty("#p3_ref", meta.ref);
    setIfEmpty("#p3_date", meta.date);

    // -------------------------
    // OFFRE (HT)
    // -------------------------
    setIfEmpty("#p3_v_materiel", fmt(offer.materiel_ht, "€"));
    setIfEmpty("#p3_v_batterie", fmt(offer.batterie_ht, "€"));
    setIfEmpty("#p3_v_shelly", fmt(offer.shelly_ht, "€"));
    setIfEmpty("#p3_v_pose", fmt(offer.pose_ht, "€"));
    setIfEmpty("#p3_v_gestion", fmt(offer.gestion_ht, "€"));
    setIfEmpty("#p3_v_subht", fmt(offer.sous_total_ht, "€"));

    // TVA (taux)
    if (offer.tva_mat != null)  setIfEmpty("#p3_ro_tva_mat", offer.tva_mat + " %");
    if (offer.tva_pose != null) setIfEmpty("#p3_ro_tva_pose", offer.tva_pose + " %");

    // TVA (montants)
    setIfEmpty("#p3_v_tva_materiel", fmt(offer.tva_materiel_eur, "€"));
    setIfEmpty("#p3_v_tva_pose", fmt(offer.tva_pose_eur, "€"));

    // TOTAUX
    setIfEmpty("#p3_v_ttc", fmt(offer.total_ttc, "€"));
    setIfEmpty("#p3_v_prime", fmt(offer.prime, "€"));
    setIfEmpty("#p3_v_reste", fmt(offer.reste, "€"));

    // -------------------------
    // FINANCEMENT
    // -------------------------
    if (finance.mensualite != null)
      setIfEmpty("#p3_v_mensu", fmt(finance.mensualite, "€/mois"));

    if (finance.note)
      setIfEmpty("#p3_finance_note", finance.note);

    // -------------------------
    // RÉSUMÉ TECHNIQUE
    // -------------------------
    setIfEmpty("#p3_r_puissance", offer.puissance ? fmt(offer.puissance, "kWc") : null);
    setIfEmpty("#p3_r_batterie", offer.batterie_label);
    setIfEmpty("#p3_r_onduleurs", offer.onduleurs);
    setIfEmpty("#p3_r_garantie", offer.garantie);

    // -------------------------
    // CONDITIONS
    // -------------------------
    setIfEmpty("#p3_r_echelon", offer.echelon);
    setIfEmpty("#p3_r_validite", offer.validite);
    setIfEmpty("#p3_r_delai", offer.delai);

    // -------------------------
    // OVERRIDES DU LOCALSTORAGE
    // -------------------------
    const overrides = JSON.parse(localStorage.getItem("p3_overrides") || "{}");

    for (const [id, val] of Object.entries(overrides)) {
      const el = document.getElementById(id);
      if (el) el.textContent = val;
    }

    if (overrides._inclus_html) {
      const ul = document.getElementById("p3_list_inclus");
      if (ul) ul.innerHTML = overrides._inclus_html;
    }
    if (overrides._noninclus_html) {
      const ul = document.getElementById("p3_list_noninclus");
      if (ul) ul.innerHTML = overrides._noninclus_html;
    }

    console.log("✓ P3 hydratée avec succès");
  }

  // ===============================================================
  // AUTO-BIND (pattern P1/P2)
  // ===============================================================
  window.API = window.API || {};

  window.API.bindEngineP3 = function(Engine){
    if (!Engine) return;

    // Quand engine-main émet "p3:update"
    Engine.on("p3:update", hydrateP3);

    console.log("🔗 Bind Engine → P3 OK");
  };

})();
