// ======================================================================
// ENGINE-P3 — Hydratation automatique de la page 3 (Offre chiffrée)
// Pattern Solarglobe Premium - identique P1/P2 (sans export ES module)
// ======================================================================

(function(){

  const set = (sel, val) => {
    const el = document.querySelector(sel);
    if (!el) return;
    el.textContent = (val === null || val === undefined || val === "") ? "—" : String(val);
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
    set("#p3_client", meta.client);
    set("#p3_ref", meta.ref);
    set("#p3_date", meta.date);

    // -------------------------
    // OFFRE (HT) — valeurs brutes du JSON
    // -------------------------
    set("#p3_v_materiel", offer.materiel_ht);
    set("#p3_v_batterie", offer.batterie_ht);
    set("#p3_v_shelly", offer.shelly_ht);
    set("#p3_v_pose", offer.pose_ht);
    set("#p3_v_gestion", offer.gestion_ht);
    set("#p3_v_subht", offer.sous_total_ht);

    // TVA (taux)
    set("#p3_ro_tva_mat", offer.tva_mat != null ? offer.tva_mat + " %" : null);
    set("#p3_ro_tva_pose", offer.tva_pose != null ? offer.tva_pose + " %" : null);

    // TVA (montants)
    set("#p3_v_tva_materiel", offer.tva_materiel_eur);
    set("#p3_v_tva_pose", offer.tva_pose_eur);

    // TOTAUX
    set("#p3_v_ttc", offer.total_ttc);
    set("#p3_v_prime", offer.prime);
    set("#p3_v_reste", offer.reste);

    // -------------------------
    // FINANCEMENT
    // -------------------------
    set("#p3_v_mensu", finance.mensualite);
    set("#p3_finance_note", finance.note);

    // -------------------------
    // RÉSUMÉ TECHNIQUE
    // -------------------------
    set("#p3_r_puissance", offer.puissance);
    set("#p3_r_batterie", offer.batterie_label);
    set("#p3_r_onduleurs", offer.onduleurs);
    set("#p3_r_garantie", offer.garantie);

    // -------------------------
    // CONDITIONS
    // -------------------------
    set("#p3_r_echelon", offer.echelon);
    set("#p3_r_validite", offer.validite);
    set("#p3_r_delai", offer.delai);
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
