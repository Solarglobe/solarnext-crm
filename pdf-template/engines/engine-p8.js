// ======================================================================
// ENGINE-P8 — Impact Batterie (SOLARGLOBE Premium)
// Version TESLA SOFT CURVE — Sans animation — Zéro oscillation
// ======================================================================

(function () {

  const $ = s => document.querySelector(s);
  const r0 = v => Math.round(Number(v) || 0);
  const clampPct = v => Math.max(0, Math.min(100, Number(v) || 0));

  // --------------------------------------------------------------
  // Helper texte
  // --------------------------------------------------------------
  function setText(sel, v) {
    const el = $(sel);
    if (!el) return;
    if (v === null || v === undefined) {
      el.textContent = "—";
    } else {
      el.textContent = String(v);
    }
  }

  // --------------------------------------------------------------
  // BARRES
  // --------------------------------------------------------------
  function setSeg(el, pctVal, label) {
    if (!el) return;
    const v = clampPct(pctVal);

    el.style.flex = `0 0 ${v}%`;
    el.style.display = v < 0.5 ? "none" : "flex";
    el.textContent = v < 2 ? "" : `${r0(v)} % ${label}`;
  }

  // --------------------------------------------------------------
  // 🔥 COURBE TESLA SOFT — Interpolation MONOTONE (type PCHIP)
  // --------------------------------------------------------------
  function drawLines(profile) {

    const root  = $("#p8_svg");
    const layer = $("#p8_svg_lines");
    if (!root || !layer) return;

    while (layer.firstChild) layer.removeChild(layer.firstChild);

    const vb = root.viewBox.baseVal || { width: 600, height: 200 };
    const W  = vb.width;
    const H  = vb.height;

    const yBase = 170;
    const maxH  = 120;

    const safe = arr => (Array.isArray(arr) ? arr : Array(24).fill(0));

    let pv        = safe(profile.pv);
    let load      = safe(profile.load);
    let charge    = safe(profile.charge);
    let discharge = safe(profile.discharge);

    // BOOST visuel batterie
    const battBoost = 3;
    charge    = charge.map(v => v * battBoost);
    discharge = discharge.map(v => v * battBoost);

    const series = [
      { arr: pv,        color: "#FFD54F", width: 3.5 }, 
      { arr: load,      color: "#CFCFCF", width: 2.4 },
      { arr: charge,    color: "#A6E3AE", width: 2.6 },
      { arr: discharge, color: "#2E8B57", width: 2.8 }
    ];

    function monotone(points) {
      const n = points.length;
      const m = new Array(n).fill(0);

      for (let i = 0; i < n - 1; i++) {
        const dx = points[i+1].x - points[i].x;
        const dy = points[i+1].y - points[i].y;
        m[i] = dy / dx;
      }
      m[n-1] = m[n-2];

      const t = new Array(n).fill(0);
      t[0] = m[0];
      for (let i = 1; i < n - 1; i++) {
        if (m[i] * m[i-1] <= 0) {
          t[i] = 0;
        } else {
          t[i] = (m[i-1] + m[i]) / 2;
        }
      }
      t[n-1] = m[n-2];

      return { m, t };
    }

    function addTeslaCurve(arr, color, width) {

      let maxVal = Math.max(...arr.map(v => Number(v) || 0));
      if (!isFinite(maxVal) || maxVal <= 0) maxVal = 1;

      const stepX = W / (arr.length - 1);

      const yAt = v => {
        const ratio = v / maxVal;
        const smooth = Math.pow(ratio, 0.85);
        return yBase - (smooth * maxH);
      };

      const pts = arr.map((v, i) => ({
        x: i * stepX,
        y: yAt(v || 0)
      }));

      const { t } = monotone(pts);

      let d = `M${pts[0].x},${pts[0].y}`;

      for (let i = 0; i < pts.length - 1; i++) {
        const p0 = pts[i];
        const p1 = pts[i+1];
        const dx = p1.x - p0.x;

        const c1x = p0.x + dx / 3;
        const c1y = p0.y + t[i] * dx / 3;

        const c2x = p1.x - dx / 3;
        const c2y = p1.y - t[i+1] * dx / 3;

        d += ` C${c1x},${c1y} ${c2x},${c2y} ${p1.x},${p1.y}`;
      }

      const gradId = "grad_" + color.replace("#", "");
      if (!document.getElementById(gradId)) {
        const defs = root.querySelector("defs") ||
          root.insertBefore(
            document.createElementNS("http://www.w3.org/2000/svg", "defs"),
            root.firstChild
          );

        const lg = document.createElementNS("http://www.w3.org/2000/svg", "linearGradient");
        lg.setAttribute("id", gradId);
        lg.setAttribute("x1", "0");
        lg.setAttribute("y1", "0");
        lg.setAttribute("x2", "0");
        lg.setAttribute("y2", "1");

        const s1 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        s1.setAttribute("offset", "0%");
        s1.setAttribute("stop-color", color);
        s1.setAttribute("stop-opacity", "1");

        const s2 = document.createElementNS("http://www.w3.org/2000/svg", "stop");
        s2.setAttribute("offset", "100%");
        s2.setAttribute("stop-color", color);
        s2.setAttribute("stop-opacity", "0.18");

        lg.appendChild(s1);
        lg.appendChild(s2);
        defs.appendChild(lg);
      }

      const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
      path.setAttribute("d", d);
      path.setAttribute("stroke", `url(#${gradId})`);
      path.setAttribute("stroke-width", width);
      path.setAttribute("fill", "none");
      path.setAttribute("stroke-linecap", "round");
      path.setAttribute("stroke-linejoin", "round");

      layer.appendChild(path);
    }

    series.forEach(s => addTeslaCurve(s.arr, s.color, s.width));
  }

  // --------------------------------------------------------------
  // RENDER P8 (auto + nouveaux blocs)
  // --------------------------------------------------------------
  function renderP8(d) {
    if (!d) return;

    // META
    setText("#p8_client", d.meta?.client || "—");
    setText("#p8_ref",    d.meta?.ref    || "—");
    setText("#p8_date",   d.meta?.date   || "—");
    if (d.year) {
      setText("#p8_meta_year", `Année de référence : ${d.year}`);
    } else {
      setText("#p8_meta_year", "");
    }

    const A = d.A || {}, B = d.B || {};

    const Aprod = +A.production_kwh || 0;
    const Bprod = +B.production_kwh || 0;

    const AautoPct = Aprod ? (A.autocons_kwh / Aprod) * 100 : 0;
    const AsurPct  = clampPct(100 - AautoPct);

    const BautoPct = Bprod ? (B.autocons_kwh / Bprod) * 100 : 0;
    const BbattPct = Bprod ? (B.battery_throughput_kwh / Bprod) * 100 : 0;
    const BsurPct  = clampPct(100 - BautoPct - BbattPct);

    // BARRES
    setSeg($("#p8_a_auto"),    AautoPct, "Autoconso");
    setSeg($("#p8_a_surplus"), AsurPct,  "Surplus");

    setSeg($("#p8_b_auto"),    BautoPct, "Autoconso");
    setSeg($("#p8_b_batt"),    BbattPct, "Batterie");
    setSeg($("#p8_b_surplus"), BsurPct,  "Surplus");

    // TABLEAU
    setText("#p8_t_A_prod", Aprod);
    setText("#p8_t_B_prod", Bprod);

    setText("#p8_t_A_auto", A.autocons_kwh);
    setText("#p8_t_B_auto", B.autocons_kwh);

    setText("#p8_t_B_batt", B.battery_throughput_kwh);

    setText("#p8_t_A_sur", A.surplus_kwh);
    setText("#p8_t_B_sur", B.surplus_kwh);

    setText("#p8_t_A_grid", A.grid_import_kwh);
    setText("#p8_t_B_grid", B.grid_import_kwh);

    setText("#p8_t_A_autopct", `${r0(A.autonomie_pct)} %`);
    setText("#p8_t_B_autopct", `${r0(B.autonomie_pct)} %`);

    // ================== NOUVEAUX BLOCS ==================

    // HYPOTHÈSES
    const h = d.hypotheses || {};
    setText("#p8_h_year",    `Année : ${h.annee ?? "—"}`);
    const hCycY = h.cycles_an;
    const hCycD = h.cycles_jour;
    const hCycStr =
      hCycY != null && Number.isFinite(Number(hCycY))
        ? hCycD != null && Number.isFinite(Number(hCycD))
          ? `${Number(hCycY).toFixed(1).replace(".", ",")} / an · ${Number(hCycD).toFixed(2).replace(".", ",")} / jour`
          : `${Number(hCycY).toFixed(1).replace(".", ",")} / an`
        : "—";
    setText("#p8_h_cycles", `Cycles : ${hCycStr}`);
    setText(
      "#p8_h_capacity",
      `Capacité utile : ${
        h.capacite_utile_kwh != null ? r0(h.capacite_utile_kwh) + " kWh" : "—"
      }`
    );
    setText(
      "#p8_h_profile",
      `Profil journée : ${h.profil_journee ?? "—"}`
    );

    // KPIs (gain d’autonomie / réduction achats réseau)
    const db  = d.detailsBatterie || {};
    const kpi = d.kpis || {};

    const gainAut = db.gain_autonomie_pts != null
      ? db.gain_autonomie_pts
      : (kpi.autonomie_gain_pts != null ? kpi.autonomie_gain_pts : 0);

    const redGridKwh = db.reduction_achat_kwh != null
      ? db.reduction_achat_kwh
      : (kpi.grid_delta_kwh != null ? kpi.grid_delta_kwh : 0);

    const redGridEur = db.reduction_achat_eur != null
      ? db.reduction_achat_eur
      : (kpi.grid_delta_eur != null ? kpi.grid_delta_eur : null);

    // Gain d’autonomie
    if ($("#p8_kpi_autonomie")) {
      const signe = gainAut > 0 ? "+" : "";
      setText("#p8_kpi_autonomie", `${signe}${r0(gainAut)} pts`);
      const autoA = A.autonomie_pct ?? AautoPct;
      const autoB = B.autonomie_pct ?? (BautoPct + BbattPct);
      setText(
        "#p8_kpi_autonomie_note",
        `Autonomie ${r0(autoA)} % → ${r0(autoB)} %`
      );
    }

    // Réduction achats réseau
    if ($("#p8_kpi_grid")) {
      const txtKwh =
        redGridKwh > 0
          ? `−${r0(redGridKwh)} kWh/an`
          : `${r0(redGridKwh)} kWh/an`;
      setText("#p8_kpi_grid", txtKwh);

      if (redGridEur != null) {
        setText("#p8_kpi_grid_note", `≈ ${r0(redGridEur)} € / an`);
      } else {
        setText("#p8_kpi_grid_note", "");
      }
    }

    // TEXTE SOUS LES BARRES
    const tb = d.texteSousBarres || {};
    setText("#p8_delta_autocons", tb.b1 || "—");
    setText("#p8_delta_reseau",   tb.b2 || "—");
    setText("#p8_delta_surplus",  tb.b3 || "—");

    // INTERPRÉTATION AUTOMATIQUE
    const inter = d.interpretation || {};
    setText("#p8_i_gain",    inter.ligne1 || "—");
    setText("#p8_i_grid",    inter.ligne2 || "—");
    setText("#p8_i_surplus", inter.ligne3 || "—");

    // COURBES
    drawLines(d.profile || {});
  }

  // --------------------------------------------------------------
  // HOOK ENGINE MAIN
  // --------------------------------------------------------------
  window.API = window.API || {};
  window.API.bindEngineP8 = function (Engine) {
    if (!Engine) return;

    if (typeof Engine.on === "function") {
      Engine.on("p8:update", payload => {
        $("#p8_action") && ($("#p8_action").style.display = "none");
        $("#p8_results") && ($("#p8_results").style.display = "");
        renderP8(payload);
      });
    }

    if (typeof Engine.getP8 === "function") {
      const first = Engine.getP8();
      if (first) {
        $("#p8_action") && ($("#p8_action").style.display = "none");
        $("#p8_results") && ($("#p8_results").style.display = "");
        renderP8(first);
      }
    }
  };

})();
