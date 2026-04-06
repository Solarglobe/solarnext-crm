// ======================================================================
// ENGINE-P9 — Rendu visuel (données inchangées : fullReport.p9)
// DOM principal : page legacy P8 premium (#p8_*). Repli #p9_* si présent.
// ======================================================================

(function () {
  "use strict";

  const ns = "http://www.w3.org/2000/svg";
  const $ = (s, root) => (root || document).querySelector(s);

  const API = (window.Engine = window.Engine || {});
  let payloadP9 = null;

  /** Trait + fill : bleu nuit profond (contraste fort sur beige) */
  const LINE_CURVE = "#062a40";
  const LINE_CURVE_MID = "#1e9ad6";
  const LINE_CURVE_GLOW = "rgba(6, 42, 64, 0.58)";
  const FILL_NEAR = "#0a3550";
  const FILL_MID = "#155a82";
  const FILL_SOFT = "#2688c4";
  const FILL_FADE = "#5aaee0";
  /** Repères page (doré) ; libellé courbe final en doré marque */
  const ROI_STROKE = "#9a7a52";
  const ROI_LABEL = "#7d6b5a";
  const AXIS_LABEL = "#3d4a55";
  const AXIS_Y = "#111827";
  const LABEL_GOLD_CHART = "#C39847";

  function num(v) {
    if (v == null || v === "") return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }

  function euro(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    const sign = v < 0 ? "- " : "";
    return sign + Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
  }

  function euroPlus(v) {
    if (v == null || !Number.isFinite(v)) return "—";
    const sign = v >= 0 ? "+ " : "- ";
    return sign + Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
  }

  function normalizeSeries25(raw) {
    const out = [];
    for (let i = 0; i < 25; i++) {
      const v = num(raw && raw[i]);
      out.push(v != null ? v : 0);
    }
    return out;
  }

  function clearNode(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }

  function formatRoiYears(y) {
    if (y == null || !Number.isFinite(y)) return "—";
    const r = Math.round(y);
    if (r <= 0) return "—";
    return r === 1 ? "1 an" : r + " ans";
  }

  function formatRoiYearApprox(y) {
    if (y == null || !Number.isFinite(y)) return "—";
    const r = Math.round(y);
    if (r <= 0) return "—";
    return "≈ année " + r;
  }

  function hint15y(gain15, finalNet) {
    if (gain15 == null || finalNet == null || !Number.isFinite(finalNet) || finalNet === 0) return "";
    const ratio = gain15 / finalNet;
    if (ratio >= 0.4 && ratio <= 0.6) return "≈ la moitié du bénéfice cumulé à 25 ans";
    return "Lecture sur la projection cumulée (année 15)";
  }

  function setBoth(p8Sel, p9Sel, text) {
    const a = $(p8Sel);
    const b = $(p9Sel);
    if (a) a.textContent = text;
    if (b) b.textContent = text;
  }

  /** Courbe lissée (cubiques Catmull-Rom → Bézier) */
  function buildSmoothLinePath(points) {
    if (points.length < 2) return "";
    if (points.length === 2) {
      return "M " + points[0].x + " " + points[0].y + " L " + points[1].x + " " + points[1].y;
    }
    let d = "M " + points[0].x + " " + points[0].y;
    for (let i = 0; i < points.length - 1; i++) {
      const p0 = points[Math.max(0, i - 1)];
      const p1 = points[i];
      const p2 = points[i + 1];
      const p3 = points[Math.min(points.length - 1, i + 2)];
      const cp1x = p1.x + (p2.x - p0.x) / 6;
      const cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6;
      const cp2y = p2.y - (p3.y - p1.y) / 6;
      d += " C " + cp1x + " " + cp1y + " " + cp2x + " " + cp2y + " " + p2.x + " " + p2.y;
    }
    return d;
  }

  function buildLinePathLinear(c, x0, y0, w, h, yMin, yMax, n) {
    function yAt(val) {
      return y0 + h - ((val - yMin) / (yMax - yMin)) * h;
    }
    let d = "";
    const pts = [];
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (w / (n - 1));
      const y = yAt(c[i]);
      pts.push({ x: x, y: y });
      d += (i === 0 ? "M" : "L") + x + " " + y + " ";
    }
    return { dLinear: d, dSmooth: buildSmoothLinePath(pts), pts: pts, lastX: pts[n - 1].x, lastY: pts[n - 1].y };
  }

  // -------------------------------------------------------------------
  function drawGraph(series, roiYear, finalVal) {
    const svg = $("#p8_chart") || $("#p9_chart");
    clearNode(svg);
    if (!svg) return;

    const gradPrefix = svg.id === "p8_chart" ? "p8FillGradPremium" : "p9FillGradPremium";
    const fillVertId = gradPrefix + "FillVertical";
    const fillHorizId = gradPrefix + "FillLightenRight";

    const c = normalizeSeries25(series);
    let yMin = Math.min(...c, 0);
    let yMax = Math.max(...c, 0);
    if (yMax === yMin) yMax = yMin + 1;
    const span = yMax - yMin;
    const pad = Math.max(span * 0.08, Math.abs(yMax) * 0.05, 500);
    yMin -= pad;
    yMax += pad;

    /** Marge gauche pour les libellés Y (k€) — sinon text-anchor end sort du viewBox */
    const x0 = 88;
    const y0 = 18;
    const w = 1642;
    const h = 630;
    const n = 25;
    const axisXOffset = 34;
    /** Décale Année 1 / 25 vers l’intérieur pour éviter le rognage (text-anchor middle au bord du SVG) */
    const xLabelEdgeInset = 48;

    const defs = document.createElementNS(ns, "defs");

    /* Fill 1 : couleur trait (dense) sous la courbe → fade vers l’axe X (presque transparent) */
    const lgV = document.createElementNS(ns, "linearGradient");
    lgV.setAttribute("id", fillVertId);
    lgV.setAttribute("gradientUnits", "userSpaceOnUse");
    lgV.setAttribute("x1", String(x0 + w * 0.5));
    lgV.setAttribute("y1", String(y0));
    lgV.setAttribute("x2", String(x0 + w * 0.5));
    lgV.setAttribute("y2", String(y0 + h));
    [
      ["0%", FILL_NEAR, "0.62"],
      ["18%", FILL_MID, "0.44"],
      ["42%", FILL_SOFT, "0.28"],
      ["68%", FILL_FADE, "0.14"],
      ["100%", "#e8f4fc", "0.05"]
    ].forEach(function (t) {
      const stop = document.createElementNS(ns, "stop");
      stop.setAttribute("offset", t[0]);
      stop.setAttribute("stop-color", t[1]);
      stop.setAttribute("stop-opacity", t[2]);
      lgV.appendChild(stop);
    });
    defs.appendChild(lgV);

    /* Fill 2 : droite un peu plus « ouverte » (bleu plus clair, toujours visible) — pas blanc plat */
    const lgH = document.createElementNS(ns, "linearGradient");
    lgH.setAttribute("id", fillHorizId);
    lgH.setAttribute("gradientUnits", "userSpaceOnUse");
    lgH.setAttribute("x1", String(x0));
    lgH.setAttribute("y1", String(y0 + h * 0.5));
    lgH.setAttribute("x2", String(x0 + w));
    lgH.setAttribute("y2", String(y0 + h * 0.5));
    [
      ["0%", FILL_NEAR, "0.12"],
      ["50%", FILL_MID, "0.1"],
      ["100%", "#4a9fd8", "0.28"]
    ].forEach(function (t) {
      const stop = document.createElementNS(ns, "stop");
      stop.setAttribute("offset", t[0]);
      stop.setAttribute("stop-color", t[1]);
      stop.setAttribute("stop-opacity", t[2]);
      lgH.appendChild(stop);
    });
    defs.appendChild(lgH);

    svg.appendChild(defs);

    function yAt(val) {
      return y0 + h - ((val - yMin) / (yMax - yMin)) * h;
    }

    const geo = buildLinePathLinear(c, x0, y0, w, h, yMin, yMax, n);
    const lineGeoD = geo.dSmooth || geo.dLinear;
    const xLast = geo.lastX;
    const yBottom = y0 + h;

    const rect = document.createElementNS(ns, "rect");
    rect.setAttribute("x", x0);
    rect.setAttribute("y", y0);
    rect.setAttribute("width", w);
    rect.setAttribute("height", h);
    rect.setAttribute("rx", "12");
    rect.setAttribute("fill", "#faf9f6");
    rect.setAttribute("stroke", "rgba(195,152,71,0.2)");
    rect.setAttribute("stroke-width", "1");
    svg.appendChild(rect);

    for (let i = 0; i <= 3; i++) {
      const gy = y0 + (h / 3) * i;
      const ln = document.createElementNS(ns, "line");
      ln.setAttribute("x1", x0);
      ln.setAttribute("x2", x0 + w);
      ln.setAttribute("y1", gy);
      ln.setAttribute("y2", gy);
      ln.setAttribute("stroke", "#eef1f4");
      ln.setAttribute("stroke-width", "1");
      svg.appendChild(ln);
    }

    if (yMin < 0 && yMax > 0) {
      const yZ = yAt(0);
      const l0 = document.createElementNS(ns, "line");
      l0.setAttribute("x1", x0);
      l0.setAttribute("x2", x0 + w);
      l0.setAttribute("y1", yZ);
      l0.setAttribute("y2", yZ);
      l0.setAttribute("stroke", "#d1d9e0");
      l0.setAttribute("stroke-width", "1.1");
      l0.setAttribute("stroke-dasharray", "4 6");
      l0.setAttribute("opacity", "0.95");
      svg.appendChild(l0);
    }

    const areaD =
      lineGeoD + " L " + xLast + " " + yBottom + " L " + x0 + " " + yBottom + " Z";

    const areaV = document.createElementNS(ns, "path");
    areaV.setAttribute("d", areaD);
    areaV.setAttribute("fill", "url(#" + fillVertId + ")");
    areaV.setAttribute("stroke", "none");
    areaV.setAttribute("shape-rendering", "geometricPrecision");
    svg.appendChild(areaV);

    const areaH = document.createElementNS(ns, "path");
    areaH.setAttribute("d", areaD);
    areaH.setAttribute("fill", "url(#" + fillHorizId + ")");
    areaH.setAttribute("stroke", "none");
    areaH.setAttribute("opacity", "0.92");
    areaH.setAttribute("shape-rendering", "geometricPrecision");
    svg.appendChild(areaH);

    const glow = document.createElementNS(ns, "path");
    glow.setAttribute("d", lineGeoD);
    glow.setAttribute("fill", "none");
    glow.setAttribute("stroke", LINE_CURVE_MID);
    glow.setAttribute("stroke-width", "16");
    glow.setAttribute("stroke-linecap", "round");
    glow.setAttribute("stroke-linejoin", "round");
    glow.setAttribute("opacity", "0.34");
    glow.setAttribute("shape-rendering", "geometricPrecision");
    svg.appendChild(glow);

    const glow2 = document.createElementNS(ns, "path");
    glow2.setAttribute("d", lineGeoD);
    glow2.setAttribute("fill", "none");
    glow2.setAttribute("stroke", LINE_CURVE_GLOW);
    glow2.setAttribute("stroke-width", "8");
    glow2.setAttribute("stroke-linecap", "round");
    glow2.setAttribute("stroke-linejoin", "round");
    glow2.setAttribute("opacity", "0.58");
    glow2.setAttribute("shape-rendering", "geometricPrecision");
    svg.appendChild(glow2);

    const curve = document.createElementNS(ns, "path");
    curve.setAttribute("d", lineGeoD);
    curve.setAttribute("fill", "none");
    curve.setAttribute("stroke", LINE_CURVE);
    curve.setAttribute("stroke-width", "7");
    curve.setAttribute("stroke-linecap", "round");
    curve.setAttribute("stroke-linejoin", "round");
    curve.setAttribute("shape-rendering", "geometricPrecision");
    svg.appendChild(curve);

    const rim = document.createElementNS(ns, "path");
    rim.setAttribute("d", lineGeoD);
    rim.setAttribute("fill", "none");
    rim.setAttribute("stroke", "rgba(255,255,255,0.55)");
    rim.setAttribute("stroke-width", "1.2");
    rim.setAttribute("stroke-linecap", "round");
    rim.setAttribute("stroke-linejoin", "round");
    rim.setAttribute("opacity", "0.85");
    rim.setAttribute("shape-rendering", "geometricPrecision");
    svg.appendChild(rim);

    const effectiveRoi = roiYear != null && roiYear >= 1 && roiYear <= 25 ? Math.round(roiYear) : null;
    if (effectiveRoi) {
      const xr = x0 + (effectiveRoi - 1) * (w / (n - 1));
      const vl = document.createElementNS(ns, "line");
      vl.setAttribute("x1", xr);
      vl.setAttribute("x2", xr);
      vl.setAttribute("y1", y0 + 6);
      vl.setAttribute("y2", yBottom - 4);
      vl.setAttribute("stroke", ROI_STROKE);
      vl.setAttribute("stroke-width", "1.45");
      vl.setAttribute("stroke-dasharray", "5 10");
      vl.setAttribute("stroke-linecap", "round");
      vl.setAttribute("opacity", "0.72");
      svg.appendChild(vl);

      const tr = document.createElementNS(ns, "text");
      tr.setAttribute("x", xr);
      tr.setAttribute("y", y0 + 22);
      tr.setAttribute("text-anchor", "middle");
      tr.setAttribute("font-size", "19");
      tr.setAttribute("font-weight", "500");
      tr.setAttribute("fill", ROI_LABEL);
      tr.setAttribute("opacity", "0.92");
      tr.textContent = "Projet amorti";
      svg.appendChild(tr);
    }

    const dot = document.createElementNS(ns, "circle");
    dot.setAttribute("cx", geo.lastX);
    dot.setAttribute("cy", geo.lastY);
    dot.setAttribute("r", "9");
    dot.setAttribute("fill", "#fff");
    dot.setAttribute("stroke", LINE_CURVE);
    dot.setAttribute("stroke-width", "3");
    svg.appendChild(dot);

    const dotCore = document.createElementNS(ns, "circle");
    dotCore.setAttribute("cx", geo.lastX);
    dotCore.setAttribute("cy", geo.lastY);
    dotCore.setAttribute("r", "3.6");
    dotCore.setAttribute("fill", "#051e2e");
    svg.appendChild(dotCore);

    if (finalVal != null && Number.isFinite(finalVal)) {
      const tx = document.createElementNS(ns, "text");
      tx.setAttribute("x", Math.min(geo.lastX + 16, x0 + w - 100));
      tx.setAttribute("y", geo.lastY - 14);
      tx.setAttribute("font-size", "24");
      tx.setAttribute("font-weight", "700");
      tx.setAttribute("fill", LABEL_GOLD_CHART);
      tx.setAttribute("opacity", "0.98");
      tx.textContent = "À 25 ans : " + euroPlus(finalVal);
      svg.appendChild(tx);
    }

    const gLab = document.createElementNS(ns, "g");
    gLab.setAttribute("font-size", "20");
    gLab.setAttribute("fill", AXIS_LABEL);
    gLab.setAttribute("font-weight", "600");
    [1, 5, 10, 15, 20, 25].forEach(function (yr) {
      let x = x0 + (yr - 1) * (w / (n - 1));
      if (yr === 1) x += xLabelEdgeInset;
      if (yr === 25) x -= xLabelEdgeInset;
      x = Math.max(x0 + 46, Math.min(x0 + w - 46, x));
      const t = document.createElementNS(ns, "text");
      t.setAttribute("x", x);
      t.setAttribute("y", yBottom + axisXOffset);
      t.setAttribute("text-anchor", "middle");
      t.textContent = "Année " + yr;
      gLab.appendChild(t);
    });
    svg.appendChild(gLab);

    const ticks = [yMin + (yMax - yMin) * 0.75, yMin + (yMax - yMin) * 0.5, yMin + (yMax - yMin) * 0.25];
    const gY = document.createElementNS(ns, "g");
    gY.setAttribute("font-size", "21");
    gY.setAttribute("fill", AXIS_Y);
    gY.setAttribute("font-weight", "700");
    ticks.forEach(function (tv) {
      const yy = yAt(tv);
      const lab = document.createElementNS(ns, "text");
      /* Marge gauche : ancrage début pour éviter tout rognage (PDF / overflow) */
      lab.setAttribute("x", "10");
      lab.setAttribute("y", yy + 7);
      lab.setAttribute("text-anchor", "start");
      lab.textContent = (tv / 1000).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " k€";
      gY.appendChild(lab);
    });
    svg.appendChild(gY);
  }

  // -------------------------------------------------------------------
  function render(p) {
    payloadP9 = p;
    if (!p) return;

    const meta = p.meta || {};
    const metaClient = meta.client != null && meta.client !== "" ? meta.client : "—";
    const metaRef = meta.ref != null && meta.ref !== "" ? meta.ref : "—";
    const metaDate = meta.date != null && meta.date !== "" ? meta.date : "—";
    setBoth("#p8_client", "#p9_client", metaClient);
    setBoth("#p8_ref", "#p9_ref", metaRef);
    setBoth("#p8_date", "#p9_date", metaDate);

    const emptyP8 = $("#p8_empty_state");
    const emptyP9 = $("#p9_empty_state");
    const mainP8 = $("#p8_main_stack");
    const mainP9 = $("#p9_main_stack");

    const sc = p.scenario && typeof p.scenario === "object" ? p.scenario : null;
    const blocked = !sc || p.error;

    const chartP8 = $("#p8_chart");
    const chartP9 = $("#p9_chart");

    if (blocked) {
      if (mainP8) mainP8.style.display = "none";
      if (mainP9) mainP9.style.display = "none";
      if (emptyP8) emptyP8.style.display = "flex";
      if (emptyP9) emptyP9.style.display = "flex";
      clearNode(chartP8);
      clearNode(chartP9);
      const r8 = $("#p8_results");
      const r9 = $("#p9_results");
      if (r8) r8.style.display = "flex";
      if (r9) r9.style.display = "flex";
      return;
    }

    if (emptyP8) emptyP8.style.display = "none";
    if (emptyP9) emptyP9.style.display = "none";
    if (mainP8) mainP8.style.display = "flex";
    if (mainP9) mainP9.style.display = "flex";

    const cumul = sc.cumul_25y || [];
    const finalNet = num(sc.final_cumul);
    const heroVal = finalNet != null ? euroPlus(finalNet) : "—";
    setBoth("#p8_hero_value", "#p9_hero_value", heroVal);

    var label = sc.label || "—";
    const scenLine = label !== "—" ? "Scénario retenu : " + label : "—";
    setBoth("#p8_scenario_label", "#p9_scenario_label", scenLine);

    setBoth("#p8_kpi_capex", "#p9_kpi_capex", euro(num(sc.capex_eur)));
    setBoth("#p8_kpi_avg", "#p9_kpi_avg", euro(num(sc.avg_savings_eur_year)));
    setBoth("#p8_kpi_roi", "#p9_kpi_roi", formatRoiYears(num(sc.roi_year)));

    const roiY = num(sc.roi_year);
    const roiDetail = formatRoiYearApprox(roiY);
    const elRoi = $("#p8_card_roi_detail");
    if (elRoi) elRoi.textContent = roiDetail;

    const gain15 = cumul.length >= 15 ? num(cumul[14]) : null;
    const el15 = $("#p8_card_15y_value");
    if (el15) el15.textContent = gain15 != null ? euroPlus(gain15) : "—";
    const el15s = $("#p8_card_15y_sub");
    if (el15s) el15s.textContent = hint15y(gain15, finalNet);

    const el25c = $("#p8_card_25y_value");
    if (el25c) el25c.textContent = finalNet != null ? euroPlus(finalNet) : "—";

    var roiForChart = roiY;

    drawGraph(cumul, roiForChart, finalNet);

    const r8 = $("#p8_results");
    const r9 = $("#p9_results");
    if (r8) r8.style.display = "flex";
    if (r9) r9.style.display = "flex";
  }

  API.setP9 = render;
  API.getP9 = function () {
    return payloadP9;
  };

  API.bindEngineP9 = function (engine) {
    if (!engine) return;
    if (typeof engine.on === "function") {
      engine.on("p9:update", function (payload) {
        render(payload);
      });
    }
    if (typeof engine.getP9 === "function") {
      var first = engine.getP9();
      if (first) render(first);
    }
  };

  if (window.Engine) {
    API.bindEngineP9(window.Engine);
  }
})();
