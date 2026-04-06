// ======================================================================
// ENGINE-P11 — Financement (fullReport.p11) — graphique SVG premium 25 ans
// ======================================================================
console.log("P11 ENGINE LOADED");

(function () {
  const wait = (ms) => new Promise((res) => setTimeout(res, ms));
  const $ = (s) => document.querySelector(s);
  const set = (id, v) => {
    const el = document.getElementById(id);
    if (el) el.textContent = v != null && v !== "" ? String(v) : "—";
  };

  function fmtEur(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    return `${Math.round(Number(n)).toLocaleString("fr-FR")} €`;
  }

  function fmtEco25(arr) {
    if (!Array.isArray(arr) || arr.length === 0) return "—";
    const first = Number(arr[0]);
    const allSame = arr.every((x) => Math.round(Number(x)) === Math.round(first));
    if (allSame) return `${fmtEur(first)} / an`;
    return arr
      .slice(0, 4)
      .map((x) => fmtEur(x))
      .join(", ")
      .concat("…");
  }

  /** Dernière année (1–25) avec versement prêt > 0 — pour marqueur « fin du prêt » */
  function lastLoanYearIndex(pay) {
    let last = -1;
    for (let i = 0; i < 25; i++) {
      if (Number(pay[i]) > 0.5) last = i;
    }
    return last;
  }

  function drawChart(svgEl, series) {
    if (!svgEl || !series || !Array.isArray(series.economies_annuelles)) return;
    const eco = series.economies_annuelles;
    const pay = series.paiement_annuel || [];
    while (svgEl.firstChild) svgEl.removeChild(svgEl.firstChild);

    const W = 2400;
    const H = 700;
    /* Marges : innerH max + padL large pour graduations € très lisibles (axe Y premium). */
    const padL = 78;
    const padR = 12;
    const padT = 2;
    /* Bas : marge pour axe X nettement sous les barres + années + sous-titre */
    const padB = 54;
    const innerW = W - padL - padR;
    const innerH = H - padT - padB;
    /* Bande large sous le tracé : lecture « premium », sans tasser le chart */
    const axisGap = 56;
    const plotH = innerH - axisGap;
    const n = 25;
    const groupW = innerW / n;
    const bw = groupW * 0.44;

    let maxV = 0;
    for (let i = 0; i < n; i++) {
      maxV = Math.max(maxV, Number(eco[i]) || 0, Number(pay[i]) || 0);
    }
    if (maxV <= 0) maxV = 1;
    const niceMax = maxV * 1.06;

    function yBottom() {
      return padT + plotH;
    }
    function yScale(v) {
      return padT + plotH - (v / niceMax) * plotH;
    }

    const svgNS = "http://www.w3.org/2000/svg";
    const el = (name, attrs) => {
      const node = document.createElementNS(svgNS, name);
      if (attrs) {
        Object.keys(attrs).forEach((k) => node.setAttribute(k, attrs[k]));
      }
      return node;
    };

    const defs = el("defs", {});
    const lgEco = el("linearGradient", { id: "p11gradEco", x1: "0%", y1: "100%", x2: "0%", y2: "0%" });
    lgEco.appendChild(el("stop", { offset: "0%", "stop-color": "#a67c28" }));
    lgEco.appendChild(el("stop", { offset: "100%", "stop-color": "#e4c56d" }));
    const lgPay = el("linearGradient", { id: "p11gradPay", x1: "0%", y1: "100%", x2: "0%", y2: "0%" });
    lgPay.appendChild(el("stop", { offset: "0%", "stop-color": "#1a1a1e" }));
    lgPay.appendChild(el("stop", { offset: "100%", "stop-color": "#3d3d44" }));
    defs.appendChild(lgEco);
    defs.appendChild(lgPay);
    svgEl.appendChild(defs);

    svgEl.appendChild(
      el("rect", {
        x: "0",
        y: "0",
        width: String(W),
        height: String(H),
        fill: "#f7f5f1",
        rx: "4",
      })
    );

    const plotBg = el("rect", {
      x: String(padL),
      y: String(padT),
      width: String(innerW),
      height: String(plotH),
      fill: "#fdfcfa",
      stroke: "#d4cdc3",
      "stroke-width": "1.25",
      rx: "3",
    });
    svgEl.appendChild(plotBg);

    /* Axe Y — trait vertical (hauteur = zone barres uniquement) */
    svgEl.appendChild(
      el("line", {
        x1: String(padL),
        y1: String(padT),
        x2: String(padL),
        y2: String(padT + plotH),
        stroke: "#b8a994",
        "stroke-width": "2.25",
        opacity: "0.95",
      })
    );

    /* Axe X — clairement sous la base des barres (séparation nette) */
    const xAxisY = padT + plotH + 10;
    svgEl.appendChild(
      el("line", {
        x1: String(padL),
        y1: String(xAxisY),
        x2: String(padL + innerW),
        y2: String(xAxisY),
        stroke: "#b0a896",
        "stroke-width": "2",
        opacity: "0.98",
      })
    );

    for (let g = 0; g <= 4; g++) {
      const val = (niceMax * g) / 4;
      const y = yScale(val);
      const line = el("line", {
        x1: String(padL),
        y1: String(y),
        x2: String(padL + innerW),
        y2: String(y),
        stroke: "#e8e2d8",
        "stroke-width": "1.15",
      });
      if (g > 0) line.setAttribute("stroke-dasharray", "5 7");
      svgEl.appendChild(line);
      svgEl.appendChild(
        el("text", {
          x: String(padL - 12),
          y: String(y + 8),
          fill: "#2e2c28",
          "font-size": "36",
          "font-weight": "700",
          "font-family": "system-ui, Segoe UI, sans-serif",
          "text-anchor": "end",
        })
      ).textContent = `${Math.round(val).toLocaleString("fr-FR")} €`;
    }

    for (let i = 0; i < n; i++) {
      const x0 = padL + i * groupW;
      const e = Number(eco[i]) || 0;
      const p = Number(pay[i]) || 0;
      const he = plotH * (e / niceMax);
      const hp = plotH * (p / niceMax);
      const yEco = yScale(e);
      const yPay = yScale(p);
      const xEco = x0 + groupW * 0.038;
      const xPay = x0 + groupW * 0.482;

      const barEco = el("rect", {
        x: String(xEco),
        y: String(yEco),
        width: String(bw),
        height: String(Math.max(0, he)),
        fill: "url(#p11gradEco)",
        stroke: "#8a6a28",
        "stroke-width": "1.1",
        rx: "4",
      });
      const barPay = el("rect", {
        x: String(xPay),
        y: String(yPay),
        width: String(bw),
        height: String(Math.max(0, hp)),
        fill: "url(#p11gradPay)",
        stroke: "#25252a",
        "stroke-width": "1",
        rx: "4",
        opacity: "0.96",
      });
      svgEl.appendChild(barEco);
      svgEl.appendChild(barPay);
    }

    const loanEndIdx = lastLoanYearIndex(pay);
    if (loanEndIdx >= 0) {
      const xLine = padL + (loanEndIdx + 0.5) * groupW;
      svgEl.appendChild(
        el("line", {
          x1: String(xLine),
          y1: String(padT + 4),
          x2: String(xLine),
          y2: String(yBottom() - 4),
          stroke: "#b8923f",
          "stroke-width": "2.5",
          "stroke-dasharray": "10 7",
          opacity: "0.92",
        })
      );
      const cap = el("g", {});
      cap.appendChild(
        el("rect", {
          x: String(xLine - 78),
          y: String(padT + 4),
          width: "156",
          height: "48",
          rx: "6",
          fill: "rgba(255,252,247,0.98)",
          stroke: "#b8923f",
          "stroke-width": "1.75",
        })
      );
      const t = el("text", {
        x: String(xLine),
        y: String(padT + 38),
        fill: "#3d351f",
        "font-size": "30",
        "font-weight": "700",
        "font-family": "system-ui, Segoe UI, sans-serif",
        "text-anchor": "middle",
      });
      t.textContent = "Fin du prêt";
      cap.appendChild(t);
      svgEl.appendChild(cap);
    }

    /* Années : sous l’axe X, bien séparées du tracé */
    const yearLabelY = xAxisY + 28;
    const labelYears = [1, 5, 10, 15, 20, 25];
    labelYears.forEach((yr) => {
      const i = yr - 1;
      const cx = padL + i * groupW + groupW / 2;
      svgEl.appendChild(
        el("text", {
          x: String(cx),
          y: String(yearLabelY),
          fill: "#1f1d1a",
          "font-size": "27",
          "font-family": "system-ui, Segoe UI, sans-serif",
          "text-anchor": "middle",
          "font-weight": "700",
        })
      ).textContent = String(yr);
    });

    svgEl.appendChild(
      el("text", {
        x: String(padL + innerW / 2),
        y: String(H - 8),
        fill: "#7a756d",
        "font-size": "17",
        "font-weight": "500",
        "font-family": "system-ui, Segoe UI, sans-serif",
        "text-anchor": "middle",
      })
    ).textContent = "Années — projection sur 25 ans";
  }

  /** Années affichées dans le mini tableau de synthèse (indices série = année − 1). */
  const P11_SYNTH_YEARS = [1, 5, 10, 15, 20, 25];

  function fillSummaryGrid(series) {
    if (!series || !Array.isArray(series.economies_annuelles)) return;
    const eco = series.economies_annuelles;
    const pay = series.paiement_annuel || [];
    const reste = series.reste_a_charge_annuel || [];
    for (const y of P11_SYNTH_YEARS) {
      const i = y - 1;
      set(`p11_syn_gain_${y}`, fmtEur(eco[i]));
      const r = Number(reste[i]);
      const resteTxt = Number.isFinite(r)
        ? fmtEur(r)
        : fmtEur((Number(pay[i]) || 0) - (Number(eco[i]) || 0));
      set(`p11_syn_reste_${y}`, resteTxt);
    }
  }

  function renderP11(payload) {
    if (!payload) return;

    const meta = payload.meta || {};
    const data = payload.data || {};
    const fin = data.financing || {};
    const series = data.series || {};
    const kpi = data.kpi || {};
    const post = data.post_loan || {};

    set("p11_client", meta.client || "—");
    set("p11_ref", meta.ref || "—");
    set("p11_date", meta.date || "—");

    set("p11_mode", fin.mode_label != null ? fin.mode_label : "—");
    set("p11_amount", fin.montant_finance_display != null ? fin.montant_finance_display : fmtEur(data.capex_ttc));

    const kwc = data.kwc;
    const batt = data.battery_kwh;
    if (kwc != null || batt != null) {
      const base =
        batt > 0 ? `${kwc ?? ""} kWc + batterie ${batt} kWh` : `${kwc ?? ""} kWc`;
      set("p11_base", base.trim() || "—");
    } else {
      set("p11_base", "—");
    }

    const ecoArr = data.economies_annuelles_25;
    set("p11_eco", fmtEco25(ecoArr));

    set("p11_duree", fin.duree_display != null ? fin.duree_display : "—");
    set("p11_taeg", fin.taeg_display != null ? fin.taeg_display : "—");
    set("p11_assurance", fin.assurance_display != null ? fin.assurance_display : "—");
    set("p11_apport", fin.apport_display != null ? fin.apport_display : "—");

    set("p11_mensu", kpi.mensualite_eur != null ? fmtEur(kpi.mensualite_eur) : fin.monthly_payment_eur != null ? fmtEur(fin.monthly_payment_eur) : "—");

    set("p11_kpi1_val", kpi.mensualite_eur != null ? fmtEur(kpi.mensualite_eur) : "—");
    set("p11_kpi2_val", kpi.total_paid_eur != null ? fmtEur(kpi.total_paid_eur) : "—");
    set("p11_kpi3_val", kpi.roi_years != null && kpi.roi_years > 0 ? `${kpi.roi_years} ans` : "—");
    set("p11_kpi4_val", kpi.reste_moyen_mois_eur != null ? fmtEur(kpi.reste_moyen_mois_eur) : "—");

    set("p11_net_25", post.economies_net_25_eur != null ? fmtEur(post.economies_net_25_eur) : "—");
    set("p11_mensu_free", post.mensualite_liberee_eur != null ? fmtEur(post.mensualite_liberee_eur) : "—");
    set("p11_reste_card", post.reste_charge_moyen_mois_eur != null ? fmtEur(post.reste_charge_moyen_mois_eur) : "—");

    const durBlock = document.getElementById("p11_durations_block");
    if (durBlock && data.durations_summary) {
      durBlock.textContent = data.durations_summary;
    }

    const chart = document.getElementById("p11_chart");
    if (chart) drawChart(chart, series);

    fillSummaryGrid(series);
  }

  async function hydrateOverlay(data) {
    console.log("HYDRATE P11:", data);
    if (!data) return;
    await wait(60);
    if ($("#g11_in_client")) $("#g11_in_client").value = data.meta?.client || "";
    if ($("#g11_in_ref")) $("#g11_in_ref").value = data.meta?.ref || "";
    if ($("#g11_in_date")) $("#g11_in_date").value = data.meta?.date || "";
    if (data.data) {
      if ($("#g11_amount_in")) $("#g11_amount_in").value = data.data.capex_ttc || 0;
      if ($("#g11_base_in")) {
        const kwc = data.data.kwc || 0;
        const batt = data.data.battery_kwh || 0;
        $("#g11_base_in").value = batt > 0 ? `${kwc} kWc + batterie ${batt} kWh` : `${kwc} kWc`;
      }
      if ($("#g11_eco_in")) {
        const eco = data.data.economies_annuelles_25 || [];
        $("#g11_eco_in").value = eco.join(",");
      }
    }
  }

  const API = (window.API = window.API || {});
  API.renderP11 = renderP11;

  API.bindEngineP11 = function (engine) {
    if (!engine) return;
    engine.on("p11:auto", async (data) => {
      await hydrateOverlay(data);
      renderP11(data);
    });
    engine.on("p11:update", (data) => {
      renderP11(data);
    });
    if (typeof engine.getP11 === "function") {
      const first = engine.getP11();
      if (first) {
        hydrateOverlay(first);
        renderP11(first);
      }
    }
  };

  if (window.Engine) {
    API.bindEngineP11(window.Engine);
  }
})();
