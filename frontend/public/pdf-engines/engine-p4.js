// ======================================================================
// ENGINE-P4 — Production & Consommation (overlay + graph)
// Pattern identique P2/P3 : écoute "p4:update" émis par engine-main
// ======================================================================

(function () {
  const MONTHS = [
    "Jan",
    "Fév",
    "Mar",
    "Avr",
    "Mai",
    "Juin",
    "Juil",
    "Aoû",
    "Sep",
    "Oct",
    "Nov",
    "Déc",
  ];
  const OV_ID = "p4_overlay";
  const $ = (s, root = document) => root.querySelector(s);

  function applyMeta(meta){
    if(!meta) return;
    document.getElementById("p4_client").textContent = meta.client || "—";
    document.getElementById("p4_ref").textContent    = meta.ref || "—";
    document.getElementById("p4_date").textContent   = meta.date_display || meta.date || "—";
  }

  // PHASE 1 SAFE — auto-hide overlay DOM (no deletion)
  if (window.SMARTPITCH_DISABLE_OVERLAYS) {
    const ov = document.getElementById(OV_ID);
    if (ov) {
      ov.style.display = "none";
      ov.setAttribute("aria-hidden", "true");
    }
  }

  // ---------- Construction du tableau dans l’overlay ----------
  function buildOverlayInputs(prefill) {
    const tbody = $("#g4_inputs_body");
    if (!tbody) return;
    tbody.innerHTML = "";

    const dataFromBackend = prefill || {};
    const prodArr = dataFromBackend.production_kwh || [];
    const consoArr = dataFromBackend.consommation_kwh || [];
    const autoArr = dataFromBackend.autoconso_kwh || [];
    const battArr = dataFromBackend.batterie_kwh || [];

    for (let i = 1; i <= 12; i++) {
      const vProd = prodArr[i - 1] ?? "";
      const vConso = consoArr[i - 1] ?? "";
      const vAuto = autoArr[i - 1] ?? "";
      const vBatt = battArr[i - 1] ?? "";

      const tr = document.createElement("tr");
      tr.style.borderBottom = "0.2mm solid #eee";
      tr.innerHTML = `
        <td style="padding:1.8mm 0;">${MONTHS[i - 1]}</td>
        <td align="right"><input id="p4_prod_m${i}"  type="number" min="0" step="1" value="${vProd}"></td>
        <td align="right"><input id="p4_conso_m${i}" type="number" min="0" step="1" value="${vConso}"></td>
        <td align="right"><input id="p4_auto_m${i}"  type="number" min="0" step="1" value="${vAuto}" placeholder="auto"></td>
        <td align="right"><input id="p4_batt_m${i}"  type="number" min="0" step="1" value="${vBatt}" placeholder="opt."></td>
      `;
      tbody.appendChild(tr);
    }
  }

  // ---------- Overlay open/close ----------
  function openOverlay() {
    if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
    const ov = document.getElementById(OV_ID);
    if (!ov) return;

    // Récupérer les données du backend et les injecter dans l'overlay
    const backendPayload = window.ViewPayload?.p4 || null;  // Récupérer les données depuis le backend si disponibles
    buildOverlayInputs(backendPayload);  // Fonction pour remplir l'overlay avec les données du backend

    // Afficher l'overlay
    ov.style.display = "block";
    ov.setAttribute("aria-hidden", "false");

    const backendPayload = window.ViewPayload?.p4 || null;
    const prodArr = backendPayload?.production_kwh || [];
    const consoArr = backendPayload?.consommation_kwh || [];
    const autoArr = backendPayload?.autoconso_kwh || [];
    const battArr = backendPayload?.batterie_kwh || [];
    const rows = [];
    for (let i = 0; i < 12; i++) {
      rows.push({
        prod: prodArr[i] ?? 0,
        conso: consoArr[i] ?? 0,
        auto: autoArr[i] ?? Math.min(prodArr[i] ?? 0, consoArr[i] ?? 0),
        batt: battArr[i] ?? 0,
      });
    }
    drawChart(rows);
  }

  function closeOverlay() {
    if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
    const ov = document.getElementById(OV_ID);
    if (!ov) return;
    ov.style.display = "none";
    ov.setAttribute("aria-hidden", "true");
  }

  // ---------- Catmull-Rom → Bézier ----------
  function catmullRom2bezier(pts) {
    if (pts.length < 2) return "";
    let d = `M ${pts[0].x},${pts[0].y}`;
    for (let i = 0; i < pts.length - 1; i++) {
      const p0 = pts[i - 1] || pts[i],
        p1 = pts[i],
        p2 = pts[i + 1],
        p3 = pts[i + 2] || p2;
      const cp1x = p1.x + (p2.x - p0.x) / 6,
        cp1y = p1.y + (p2.y - p0.y) / 6;
      const cp2x = p2.x - (p3.x - p1.x) / 6,
        cp2y = p2.y - (p3.y - p1.y) / 6;
      d += ` C ${cp1x},${cp1y} ${cp2x},${cp2y} ${p2.x},${p2.y}`;
    }
    return d;
  }
  // ---------- Dessin du graphique ----------

// ---------- Dessin du graphe (VERSION SOLAR-TECH PREMIUM) ----------
function drawChart(rows) {
  const svg = document.getElementById("p4-chart");
  if (!svg) return;

  // RESET + GRADIENTS PREMIUM
  svg.innerHTML = `
<defs>

  <!-- PRODUCTION — OR PREMIUM -->
  <linearGradient id="grad-prod" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#F9D27C"/>
    <stop offset="100%" stop-color="#E6B653"/>
  </linearGradient>
  <linearGradient id="grad-prod-area" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#C29226" stop-opacity="0.55"/>
    <stop offset="100%" stop-color="#C29226" stop-opacity="0"/>
  </linearGradient>

  <!-- CONSOMMATION RÉSEAU — BLEU NUIT -->
  <linearGradient id="grad-conso" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#3E4D82"/>
    <stop offset="100%" stop-color="#1B2A59"/>
  </linearGradient>
  <linearGradient id="grad-conso-area" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#1B2A59" stop-opacity="0.50"/>
    <stop offset="100%" stop-color="#1B2A59" stop-opacity="0"/>
  </linearGradient>

  <!-- AUTOCONSO — TURQUOISE TECH -->
  <linearGradient id="grad-auto" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#4FD1DF"/>
    <stop offset="100%" stop-color="#0091A4"/>
  </linearGradient>
  <linearGradient id="grad-auto-area" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#0091A4" stop-opacity="0.50"/>
    <stop offset="100%" stop-color="#0091A4" stop-opacity="0"/>
  </linearGradient>

  <!-- BATTERIE — VERT ÉNERGIE -->
  <linearGradient id="grad-batt" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#55E6A8"/>
    <stop offset="100%" stop-color="#1EC27A"/>
  </linearGradient>
  <linearGradient id="grad-batt-area" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0%" stop-color="#1EC27A" stop-opacity="0.50"/>
    <stop offset="100%" stop-color="#1EC27A" stop-opacity="0"/>
  </linearGradient>

  <!-- SOFT SHADOW -->
  <filter id="soft-shadow" x="-20%" y="-20%" width="140%" height="140%">
    <feGaussianBlur stdDeviation="12" result="blur" />
    <feOffset dy="4" result="offsetBlur" />
    <feBlend in="SourceGraphic" in2="offsetBlur" mode="normal"/>
  </filter>

</defs>
`;

  const W = 2200,
    H = 600,
    PAD_L = 10,
    PAD_R = 30,
    PAD_T = 15,
    PAD_B = 55;

  const maxY = Math.max(
    1,
    ...rows.map((r) => Math.max(r.prod, r.conso, r.auto || 0, r.batt || 0))
  );

  const X_OFFSET = -165;
  const scaleX = (i) =>
    PAD_L + i * ((W - PAD_L - PAD_R) / 11) + X_OFFSET;
  const scaleY = (v) =>
    H - PAD_B - (v / maxY) * (H - PAD_T - PAD_B);

  // GRILLE
  for (let t = 0; t <= 6; t++) {
    const v = (maxY * t) / 6;
    const y = scaleY(v);
    const line = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "line"
    );
    line.setAttribute("x1", PAD_L);
    line.setAttribute("x2", W - PAD_R);
    line.setAttribute("y1", y);
    line.setAttribute("y2", y);
    line.setAttribute("stroke", "rgba(0,0,0,.07)");
    svg.appendChild(line);

    const lab = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    lab.setAttribute("x", PAD_L - 208);
    lab.setAttribute("y", y + 4);
    lab.setAttribute("text-anchor", "end");
    lab.style.fill = "#555";
    lab.style.fontSize = "13px";
    lab.style.fontWeight = "600";
    lab.textContent = String(v);
    svg.appendChild(lab);
  }

  // AXE X
  const xAxis = document.createElementNS(
    "http://www.w3.org/2000/svg",
    "line"
  );
  xAxis.setAttribute("x1", PAD_L);
  xAxis.setAttribute("y1", H - PAD_B);
  xAxis.setAttribute("x2", W - PAD_R);
  xAxis.setAttribute("y2", H - PAD_B);
  xAxis.setAttribute("stroke", "#999");
  svg.appendChild(xAxis);

  MONTHS.forEach((m, i) => {
    const tx = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "text"
    );
    tx.setAttribute("x", scaleX(i));
    tx.setAttribute("y", H - 20);
    tx.setAttribute("text-anchor", "middle");
    tx.style.fill = "#222";
    tx.style.fontSize = "14px";
    tx.style.fontWeight = "700";
    tx.textContent = m;
    svg.appendChild(tx);
  });

  const toPoints = (key) =>
    rows.map((r, i) => ({ x: scaleX(i), y: scaleY(r[key] || 0) }));

  // COURBES + ZONES
  function drawAreaLine(points, gradId) {
    if (!points.length) return;

    const d = catmullRom2bezier(points);

    // ZONE
    const first = points[0];
    const last = points[points.length - 1];
    const dArea =
      d + ` L ${last.x},${H - PAD_B} L ${first.x},${H - PAD_B} Z`;

    const area = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    );
    area.setAttribute("d", dArea);
    area.setAttribute("fill", `url(#${gradId}-area)`);
    area.setAttribute("opacity", "1");
    svg.appendChild(area);

    // LIGNE
    const path = document.createElementNS(
      "http://www.w3.org/2000/svg",
      "path"
    );
    path.setAttribute("d", d);
    path.setAttribute("fill", "none");
    path.setAttribute("stroke", `url(#${gradId})`);
    path.setAttribute("stroke-width", "5");
    path.setAttribute("stroke-linecap", "round");
    path.setAttribute("stroke-linejoin", "round");
    path.setAttribute("filter", "url(#soft-shadow)");
    svg.appendChild(path);
  }

  const consoPts = toPoints("conso");
  const prodPts = toPoints("prod");
  const autoPts = toPoints("auto");
  const battPts = toPoints("batt");

  drawAreaLine(consoPts, "grad-conso");
  drawAreaLine(prodPts, "grad-prod");
  if (rows.some((r) => r.auto > 0))
    drawAreaLine(autoPts, "grad-auto");

  const hasBatt = rows.some((r) => r.batt > 0);
  if (hasBatt) drawAreaLine(battPts, "grad-batt");

  const legBatt = document.getElementById("leg-batt");
  const legBattText = document.getElementById("leg-batt-text");
  if (legBatt && legBattText) {
    legBatt.style.display = hasBatt ? "inline-block" : "none";
    legBattText.style.display = hasBatt ? "block" : "none";
  }
}




  // ---------- Validation overlay → page ----------
  function validateOverlay() {
    if (window.SMARTPITCH_DISABLE_OVERLAYS) return;

    const rows = [];
    for (let i = 1; i <= 12; i++) {
      const prod = parseFloat($("#p4_prod_m" + i).value) || 0;
      const conso = parseFloat($("#p4_conso_m" + i).value) || 0;
      let auto = ($("#p4_auto_m" + i).value || "").trim();
      auto =
        auto === ""
          ? Math.min(prod, conso)
          : Math.max(0, parseFloat(auto) || 0);
      const batt = parseFloat($("#p4_batt_m" + i).value) || 0;

      rows.push({ prod, conso, auto, batt });
    }

    $("#p4_chart_zone").style.display = "block";
    drawChart(rows);

    const wrap = $("#p4_numbers");
    const zone = $("#p4_numbers_table");
    wrap.style.display = "block";

    const tot = rows.reduce(
      (a, r) => ({
        prod: a.prod + (r.prod || 0),
        conso: a.conso + (r.conso || 0),
        auto: a.auto + (r.auto || 0),
        batt: a.batt + (r.batt || 0),
      }),
      { prod: 0, conso: 0, auto: 0, batt: 0 }
    );

    zone.innerHTML = `
      <table style="width:100%;border-collapse:collapse;font-size:3.6mm;min-width:120mm;">
        <thead>
          <tr style="border-bottom:0.3mm solid #eee;color:#555">
            <th align="left">Période</th>
            <th align="right">Production (kWh)</th>
            <th align="right">Consommation (kWh)</th>
            <th align="right">Autoconso (kWh)</th>
            <th align="right">Batterie (kWh)</th>
          </tr>
        </thead>
        <tbody>
                <tr style="border-bottom:0.2mm solid #f2f2f2">
                  <td>Année</td>
                  <td align="right">${String(tot.prod)}</td>
                  <td align="right">${String(tot.conso)}</td>
                  <td align="right">${String(tot.auto)}</td>
                  <td align="right">${String(tot.batt)}</td>
                </tr>
        </tbody>
      </table>
    `;

    const ok = $("#p4_validated");
    if (ok) {
      ok.style.opacity = 1;
      setTimeout(() => (ok.style.opacity = 0), 1100);
    }

    closeOverlay();
  }

  // ---------- Démo ----------
  function demoFill() {
    if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
    $("#g4_client").value = "Client Démo";
    $("#g4_ref").value = "SP-2025-004";
    $("#g4_date").value = new Date().toLocaleDateString("fr-FR");

    const baseProd = [300, 380, 520, 650, 780, 900, 980, 930, 760, 520, 380, 310];
    const baseConso = [600, 620, 580, 520, 500, 520, 540, 560, 590, 620, 650, 640];

    for (let i = 1; i <= 12; i++) {
      $("#p4_prod_m" + i).value = baseProd[i - 1];
      $("#p4_conso_m" + i).value = baseConso[i - 1];
      $("#p4_auto_m" + i).value = "";
      $("#p4_batt_m" + i).value = i >= 4 && i <= 9 ? 120 : 60;
    }
  }

  // ---------- Hydratation depuis le backend (p4:update) ----------
  function hydrateFromBackend(payload) {
    if (!payload) return;

    // Construire les inputs overlay à partir du backend
    const backendView = {
      production_kwh: payload.production_kwh || [],
      consommation_kwh: payload.consommation_kwh || [],
      autoconso_kwh: payload.autoconso_kwh || [],
      batterie_kwh: payload.batterie_kwh || [],
    };
    buildOverlayInputs(backendView);

    const rows = [];
      for (let i = 0; i < 12; i++) {
        const prod = backendView.production_kwh[i] || 0;
        const conso = backendView.consommation_kwh[i] || 0;
        const auto =
          backendView.autoconso_kwh[i] ??
          Math.min(prod, conso);
        const batt = backendView.batterie_kwh[i] || 0;
        rows.push({ prod, conso, auto, batt });
      }
      if (rows.some((r) => r.prod || r.conso || r.auto || r.batt)) {
        const wrap = $("#p4_numbers");
        const zone = $("#p4_numbers_table");
        $("#p4_chart_zone").style.display = "block";
        drawChart(rows);

        if (wrap && zone) {
          wrap.style.display = "block";
          const tot = rows.reduce(
            (a, r) => ({
              prod: a.prod + (r.prod || 0),
              conso: a.conso + (r.conso || 0),
              auto: a.auto + (r.auto || 0),
              batt: a.batt + (r.batt || 0),
            }),
            { prod: 0, conso: 0, auto: 0, batt: 0 }
          );
          zone.innerHTML = `
            <table style="width:100%;border-collapse:collapse;font-size:3.6mm;min-width:120mm;">
              <thead>
                <tr style="border-bottom:0.3mm solid #eee;color:#555">
                  <th align="left">Période</th>
                  <th align="right">Production (kWh)</th>
                  <th align="right">Consommation (kWh)</th>
                  <th align="right">Autoconso (kWh)</th>
                  <th align="right">Batterie (kWh)</th>
                </tr>
              </thead>
              <tbody>
                <tr style="border-bottom:0.2mm solid #f2f2f2">
                  <td>Année</td>
                  <td align="right">${String(tot.prod)}</td>
                  <td align="right">${String(tot.conso)}</td>
                  <td align="right">${String(tot.auto)}</td>
                  <td align="right">${String(tot.batt)}</td>
                </tr>
              </tbody>
            </table>
          `;
        }
      }
  }

  // ---------- Bind Engine (pattern P2/P3) ----------
  window.API = window.API || {};
  window.API.bindEngineP4 = function (Engine) {
    if (!Engine) return;
    Engine.on("p4:update", (payload) => {
      try {
        applyMeta(payload?.meta);
        console.log("→ HYDRATATION P4 (engine-p4.js)", payload);
        hydrateFromBackend(payload);
      } catch (e) {
        console.error("❌ Erreur hydratation P4 :", e);
      }
    });
    console.log("🔗 Bind Engine → P4 OK");
  };

  // ---------- Events overlay ----------
  $("#p4_open_overlay")?.addEventListener("click", () => {
    if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
    openOverlay();
  });
  $("#p4_ov_close")?.addEventListener("click", () => {
    if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
    closeOverlay();
  });
  document
    .getElementById(OV_ID)
    ?.addEventListener("click", (e) => {
      if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
      if (
        e.target.id === OV_ID ||
        e.target.classList.contains("p4-ov-backdrop")
      ) {
        closeOverlay();
      }
    });

  $("#p4_ov_ok")?.addEventListener("click", () => {
    if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
    validateOverlay();
  });
  $("#p4_ov_demo")?.addEventListener("click", () => {
    if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
    demoFill();
  });

  document
    .querySelectorAll("#p4 [contenteditable]")
    .forEach((el) => {
      el.addEventListener(
        "focus",
        (e) => {
          if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
          e.preventDefault();
          el.blur();
          openOverlay();
        },
        { once: false }
      );
      el.addEventListener("click", (e) => {
        if (window.SMARTPITCH_DISABLE_OVERLAYS) return;
        e.preventDefault();
        openOverlay();
      });
    });
})();
