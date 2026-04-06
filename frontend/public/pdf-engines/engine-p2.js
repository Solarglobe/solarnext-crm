// ======================================================================
// ENGINE-P2 — Version Solarglobe (2025)
// Page projection financière : tableau 5/10/15/20/25 ans, 3 KPI.
// Pas de graphique.
// ======================================================================

(function () {

  function set(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent =
      val !== null && val !== undefined && val !== "" ? String(val) : "—";
  }

  /** Parse "18 500 €" ou "18500" → number ou null */
  function parseEur(str) {
    if (str == null || str === "" || str === "—") return null;
    const s = String(str).replace(/\s/g, "").replace("€", "").replace(",", ".");
    const n = parseFloat(s);
    return Number.isFinite(n) ? n : null;
  }

  /** Formate nombre en "18 500 €" */
  function formatEur(n) {
    if (n == null || !Number.isFinite(n)) return "—";
    return Math.round(n).toLocaleString("fr-FR") + " €";
  }

  /** Progression 5/10/15/20/25 ans : ratios 20%, 40%, 60%, 80%, 100% */
  const RATIOS = { 5: 0.2, 10: 0.4, 15: 0.6, 20: 0.8, 25: 1 };

  function renderP2(payload) {
    if (!payload || !payload.p2_auto) {
      if (typeof console !== "undefined" && console.warn) {
        console.warn("❌ ENGINE-P2 : payload.p2_auto absent");
      }
      return;
    }

    const a = payload.p2_auto;

    // META
    set("p2_client", a.p2_client);
    set("p2_ref", a.p2_ref);
    set("p2_date", a.p2_date);

    // Parser les totaux 25 ans pour dériver la progression
    const sans25 = parseEur(a.p2_sans_solaire);
    const avec25 = parseEur(a.p2_avec_solaire);
    const eco25 = parseEur(a.p2_economie_totale) ?? parseEur(a.p2_economie_nette);

    [5, 10, 15, 20, 25].forEach(function (y) {
      const r = RATIOS[y];
      set("p2_sans_" + y, formatEur(sans25 != null ? Math.round(sans25 * r) : null));
      set("p2_avec_" + y, formatEur(avec25 != null ? Math.round(avec25 * r) : null));
      set("p2_eco_" + y, formatEur(eco25 != null ? Math.round(eco25 * r) : null));
    });
    // Hero (même valeur que p2_eco_25)
    set("p2_eco_25_hero", formatEur(eco25));
    // Sous-ligne hero : gain net après investissement
    const eco25_net = parseEur(a.p2_economie_nette);
    set("p2_eco_nette_hero", eco25_net != null ? formatEur(eco25_net) : formatEur(eco25));

    // Bar chart (Sans solaire / Avec solaire 25 ans)
    set("p2_bar_sans", formatEur(sans25));
    set("p2_bar_avec", formatEur(avec25));
    set("p2_bar_eco", formatEur(eco25));
    const reducedBar = document.getElementById("p2_bar_reduced");
    if (reducedBar && sans25 != null && avec25 != null && sans25 > 0) {
      const pct = Math.max(5, Math.min(100, Math.round((avec25 / sans25) * 100)));
      reducedBar.style.height = pct + "%";
      const savingPct = Math.round(((sans25 - avec25) / sans25) * 100);
      set("p2_bar_pct", savingPct);
    } else {
      set("p2_bar_pct", "—");
    }

    // KPI
    set("p2_tri", a.p2_tri);
    set("p2_roi", a.p2_roi);
    set("p2_lcoe", a.p2_lcoe);

    // Résumé client
    set("p2_summary_roi", a.p2_roi);
    set("p2_summary_eco", formatEur(eco25));

    // BAS DE PAGE
    set("p2_prime", a.p2_prime);
    set("p2_reste_charge", a.p2_reste_charge);
    set("p2_production", a.p2_production);

    if (typeof console !== "undefined" && console.log) {
      console.log("ENGINE_P2_BOUND — P2 hydratée");
    }
  }

  window.API = window.API || {};
  window.API.bindEngineP2 = function (engine) {
    if (!engine) return;
    engine.on("p2:update", renderP2);
    const first = engine.getP2 ? engine.getP2() : null;
    if (first && first.p2_auto) renderP2(first);
  };

})();
