// ======================================================================
// ENGINE-P2 — Version Solarglobe (2025) — FINAL
// Compatible avec le nouveau HTML + VIEW-P2 FINAL
// Hydrate : KPI, Jalons, Bénéfices, Graphique Chart.js
// ======================================================================

(function () {

  // ----------------------------------------------------
  // Helper simple
  // ----------------------------------------------------
  function set(id, val) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent =
      val !== null && val !== undefined && val !== "" ? String(val) : "—";
  }

  // ----------------------------------------------------
  // Chart.js renderer
  // ----------------------------------------------------
  function renderChartP2(a) {
    const canvas = document.getElementById("p2_chart");
    if (!canvas) return;

    const ctx = canvas.getContext("2d");

    // Supprimer l'ancien graphique si présent
    if (window.__p2_chart) window.__p2_chart.destroy();

    const labels = Array.isArray(a.p2_chart_labels) ? a.p2_chart_labels : [];
    const sans = Array.isArray(a.p2_chart_sans) ? a.p2_chart_sans : [];
    const avec = Array.isArray(a.p2_chart_avec) ? a.p2_chart_avec : [];

    // Sécurisation pour éviter graphique vide
    if (labels.length === 0) {
      labels.push("Année 1", "Année 5", "Année 10", "Année 15", "Année 20", "Année 25");
      sans.push(0, 0, 0, 0, 0, 0);
      avec.push(0, 0, 0, 0, 0, 0);
    }

    window.__p2_chart = new Chart(ctx, {
      type: "line",
      data: {
        labels,
        datasets: [
  {
    label: "Avec solaire",
    data: avec,
    borderWidth: 2,
    borderColor: "#C39847",   // doré
    pointRadius: 0,
    tension: 0.25
  },
  {
    label: "Sans solaire",
    data: sans,
    borderWidth: 2,
    borderColor: "#000",      // noir
    borderDash: [5, 4],       // pointillé
    pointRadius: 0,
    tension: 0.25
  }
]

      },
      options: {
        responsive: false,
        maintainAspectRatio: false,
        animation: false,
        plugins: {
          legend: {
            display: true,
            labels: { font: { size: 11 } }
          },
          tooltip: {
            enabled: true,
            callbacks: {
              label: ctx => `${ctx.parsed.y.toLocaleString("fr-FR")} €`
            }
          }
        },
        scales: {
          y: {
            ticks: {
              callback: v => v.toLocaleString("fr-FR") + " €"
            }
          }
        }
      }
    });
  }

  // ----------------------------------------------------
  // RENDER PRINCIPAL
  // ----------------------------------------------------
  function renderP2(payload) {
    if (!payload || !payload.p2_auto) {
      console.warn("❌ ENGINE-P2 : payload.p2_auto absent");
      return;
    }

    const a = payload.p2_auto;

    console.group("📄 HYDRATATION P2");
    console.log(a);

    // META
    set("p2_client", a.p2_client);
    set("p2_ref", a.p2_ref);
    set("p2_date", a.p2_date);

    // TEXTES
    set("p2_s1", a.p2_s1);
    set("p2_s2", a.p2_s2);
    set("p2_s3", a.p2_s3);
    set("p2_hint", a.p2_hint);

    // KPI
    set("p2_k_tri", a.p2_k_tri);
    set("p2_k_roi", a.p2_k_roi);
    set("p2_k_lcoe", a.p2_k_lcoe);

    set("p2_k_economie25", a.p2_k_economie25);
    set("p2_k_revente25", a.p2_k_revente25);
    set("p2_k_gains", a.p2_k_gains);

    set("p2_k_tarif", a.p2_k_tarif);
    set("p2_k_prime", a.p2_k_prime);
    set("p2_k_reste", a.p2_k_reste);

    // BENEFICES
    set("p2_b1", a.p2_b1);
    set("p2_b2", a.p2_b2);
    set("p2_b3", a.p2_b3);

    // JALONS TABLEAU
    const body = document.getElementById("p2_jalons_body");
    if (body && Array.isArray(a.p2_jalons)) {
      body.innerHTML = a.p2_jalons
        .map(j => `
          <tr>
            <td>${j.year} ans</td>
            <td align="right">${j.sans.toLocaleString("fr-FR")} €</td>
            <td align="right">${j.avec.toLocaleString("fr-FR")} €</td>
            <td align="right">${j.eco.toLocaleString("fr-FR")} €</td>
          </tr>
        `)
        .join("");
    }

    // GRAPHIQUE
    renderChartP2(a);

    console.log("✔ P2 hydratée avec succès");
    console.groupEnd();
  }

  // ----------------------------------------------------
  // BIND ENGINE
  // ----------------------------------------------------
  window.API = window.API || {};

  window.API.bindEngineP2 = function (engine) {
    if (!engine) {
      console.error("❌ ENGINE introuvable pour P2");
      return;
    }

    engine.on("p2:update", renderP2);

    const first = engine.getP2 ? engine.getP2() : null;
    if (first && first.p2_auto) renderP2(first);
  };

})();
// ============================================================================