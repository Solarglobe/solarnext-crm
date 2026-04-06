// ======================================================================
// ENGINE-P9 — Gains cumulés (25 ans)
// Version premium Solarglobe — moteur autonome
// ----------------------------------------------------------------------
// Ce moteur :
//  ✔ reçoit le payload complet du VIEW-P9
//  ✔ remplit TOUS les champs #p9_*
//  ✔ génère le graphique SVG tout seul (sans dépendre du HTML)
// ======================================================================

(function () {

  const ns = "http://www.w3.org/2000/svg";
  const $  = (s, root = document) => root.querySelector(s);
const $$ = (s, root = document) => root.querySelectorAll(s);

  const API = (window.Engine = window.Engine || {});
  let payloadP9 = null;

  // -------------------------------------------------------------------
  // Helpers
  // -------------------------------------------------------------------
  function euro(v) {
    return (v < 0 ? "- " : "") + Math.abs(v).toLocaleString("fr-FR", { maximumFractionDigits: 0 }) + " €";
  }

  function roiYear(arr) {
    for (let i = 0; i < arr.length; i++) if (arr[i] >= 0) return i + 1;
    return null;
  }

  function clearNode(el) {
    if (!el) return;
    while (el.firstChild) el.removeChild(el.firstChild);
  }


  // -------------------------------------------------------------------
// GRAPH DRAWING
// -------------------------------------------------------------------
function drawGraph(Ac, Bc) {
  const svg = $("#p9_chart");
  const pins = $("#p9_roi_pins");
  clearNode(svg);
  clearNode(pins);
  if (!svg) return;

  // DOMAIN
  const all = [...Ac, ...Bc];
  let yMin = Math.min(...all);
  let yMax = Math.max(...all);
  if (yMax === yMin) yMax = yMin + 1;

  const pad = Math.max((yMax - yMin) * 0.1, 500);
  yMin -= pad;
  yMax += pad;

  // FRAME
  const x0 = 100, y0 = 30, w = 1460, h = 500;

  // FRAME RECT
  const rect = document.createElementNS(ns, "rect");
  rect.setAttribute("x", x0);
  rect.setAttribute("y", y0);
  rect.setAttribute("width", w);
  rect.setAttribute("height", h);
  rect.setAttribute("rx", 8);
  rect.setAttribute("fill", "none");
  rect.setAttribute("stroke", "#E8EAED");
  rect.setAttribute("stroke-width", "1.5");
  svg.appendChild(rect);

  // GRID
  for (let i = 0; i <= 5; i++) {
    const y = y0 + (h / 5) * i;
    const ln = document.createElementNS(ns, "line");
    ln.setAttribute("x1", x0);
    ln.setAttribute("x2", x0 + w);
    ln.setAttribute("y1", y);
    ln.setAttribute("y2", y);
    ln.setAttribute("stroke", "#F1F3F5");
    ln.setAttribute("stroke-width", "1.2");
    svg.appendChild(ln);
  }

  // ZERO LINE
  if (yMin < 0 && yMax > 0) {
    const yZero = y0 + h - ((0 - yMin) / (yMax - yMin)) * h;
    const l0 = document.createElementNS(ns, "line");
    l0.setAttribute("x1", x0);
    l0.setAttribute("x2", x0 + w);
    l0.setAttribute("y1", yZero);
    l0.setAttribute("y2", yZero);
    l0.setAttribute("stroke", "#C5CCD3");
    l0.setAttribute("stroke-width", "1.8");
    l0.setAttribute("stroke-dasharray", "4 6");
    svg.appendChild(l0);
  }

  // LABELS "Année"
  const gLab = document.createElementNS(ns, "g");
  gLab.setAttribute("font-size", "26");
  gLab.setAttribute("fill", "#7A828C");
  [1, 5, 10, 15, 20, 25].forEach(n => {
    const x = x0 + (n - 1) * (w / 24);
    const t = document.createElementNS(ns, "text");
    t.setAttribute("x", x);
    t.setAttribute("y", y0 + h + 42);
    t.setAttribute("text-anchor", "middle");
    t.textContent = "Année " + n;
    gLab.appendChild(t);
  });
  svg.appendChild(gLab);

  // PATH BUILDER
  function buildPath(c) {
    const n = 25;
    let d = "";
    for (let i = 0; i < n; i++) {
      const x = x0 + i * (w / (n - 1));
      const y = y0 + h - ((c[i] - yMin) / (yMax - yMin)) * h;
      d += (i === 0 ? "M" : "L") + x + " " + y + " ";
    }
    return d;
  }

  // CURVES
  function drawCurve(arr, color, width = 5) {
    const p = document.createElementNS(ns, "path");
    p.setAttribute("d", buildPath(arr));
    p.setAttribute("fill", "none");
    p.setAttribute("stroke", color);
    p.setAttribute("stroke-width", width);
    p.setAttribute("stroke-linecap", "round");
    p.setAttribute("stroke-linejoin", "round");
    svg.appendChild(p);
  }

  // Sans batterie = doré (A), Avec batterie = violet (B)
  drawCurve(Ac, "#4A5568", 6);
  drawCurve(Bc, "#C39847", 4);

  // ROI pins
  function pin(year, color, top) {
    if (!year) return;
    const x = x0 + (year - 1) * (w / 24);
    const line = document.createElement("div");
    line.style.position = "absolute";
    line.style.left = `calc(${(x / 1750 * 100).toFixed(4)}%)`;
    line.style.top = 0;
    line.style.bottom = 0;
    line.style.borderLeft = `1.5px dashed ${color}`;
    line.style.opacity = 0.7;
    pins.appendChild(line);

    const badge = document.createElement("div");
    badge.textContent = `ROI : année ${year}`;
    Object.assign(badge.style, {
      position: "absolute",
      left: `calc(${(x / 1750 * 100).toFixed(4)}%)`,
      transform: "translateX(-50%)",
      background: "#fff",
      border: `1px solid ${color}`,
      padding: "1.8mm 3mm",
      borderRadius: "6px",
      fontSize: "3mm",
      boxShadow: "0 2px 6px rgba(0,0,0,.06)"
    });
    badge.style[top ? "top" : "bottom"] = "10mm";
    pins.appendChild(badge);
  }

  pin(payloadP9.recommended.roi_year, "#4A5568", true);   // Sans batterie
  pin(payloadP9.compare.roi_year, "#C39847", false);      // Avec batterie
}

  // -------------------------------------------------------------------
  // MAIN RENDER
  // -------------------------------------------------------------------
  function render(p) {
    payloadP9 = p;
    if (!p) return;

    // META
    $("#p9_client").textContent = p.meta?.client ?? "—";
    $("#p9_ref").textContent = p.meta?.ref ?? "—";
    $("#p9_date").textContent = p.meta?.date ?? "—";

    // LEGEND LABELS
    $("#p9_leg_a").textContent = p.recommended.label;
    $("#p9_leg_b").textContent = p.compare.label;

    // FINAL VALUES
    const A = p.recommended;
    const B = p.compare;

    $("#p9_a_total").textContent = euro(A.cumul_25y[24]);
    $("#p9_b_total").textContent = euro(B.cumul_25y[24]);

    $("#p9_a_meta").textContent =
      `ROI : année ${A.roi_year ?? "—"} — TRI : ${A.tri_pct != null ? A.tri_pct.toFixed(1) + " %" : "—"}`;

    $("#p9_b_meta").textContent =
      `ROI : année ${B.roi_year ?? "—"} — TRI : ${B.tri_pct != null ? B.tri_pct.toFixed(1) + " %" : "—"}`;

    $("#p9_tri_a").textContent = `${A.label} — TRI : ${A.tri_pct != null ? A.tri_pct.toFixed(1) + " %" : "—"}`;
    $("#p9_tri_b").textContent = `${B.label} — TRI : ${B.tri_pct != null ? B.tri_pct.toFixed(1) + " %" : "—"}`;

    // GRAPH
    drawGraph(A.cumul_25y, B.cumul_25y);

    // VISIBILITY
    $("#p9_results").style.display = "";
  }

  // -------------------------------------------------------------------
  // API
  // -------------------------------------------------------------------
  API.setP9 = render;
  API.getP9 = () => payloadP9;

// ------------------------------------------------------------
// BIND ENGINE-P9 AU MOTEUR PRINCIPAL
// ------------------------------------------------------------
API.bindEngineP9 = function(engine){
    if (!engine) return;

    // écouter l'événement du moteur principal
    if (typeof engine.on === "function"){
        engine.on("p9:update", (payload)=>{
            console.log("🔥 Hydratation P9 (engine-p9.js) :", payload);
            render(payload);
        });
    }

    // récupérer les données si déjà chargées
    if (typeof engine.getP9 === "function"){
        const first = engine.getP9();
        if (first){
            console.log("🔥 Rendu initial P9 (engine-p9.js) :", first);
            render(first);
        }
    }
};

// si le moteur principal est déjà là → bind direct
if (window.Engine){
    API.bindEngineP9(window.Engine);
}



})();
