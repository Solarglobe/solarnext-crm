// ======================================================================
// ENGINE-P6 — Répartition consommation 12 mois (Graphique + KPI + Overlay)
// Version corrigée Solarglobe : batterie collée parfaitement au-dessus du bleu
// ======================================================================

(function () {

  const STORAGE = "smartpitch_overrides";
  const MONTHS = ["Jan","Fév","Mar","Avr","Mai","Juin","Juil","Août","Sep","Oct","Nov","Déc"];
  const $ = (s, r=document) => r.querySelector(s);
  const safe = v => Number.isFinite(Number(v)) ? Number(v) : 0;

  // --------------------------------------------------------------------
  // STORE HELPERS
  // --------------------------------------------------------------------
  function getStore() {
    try { return JSON.parse(localStorage.getItem(STORAGE) || "{}"); }
    catch { return {}; }
  }
  function setStore(o) {
    localStorage.setItem(STORAGE, JSON.stringify(o || {}));
  }

  // --------------------------------------------------------------------
  // MERGE PAYLOAD + STORE
  // --------------------------------------------------------------------
  function mergeSeries(payload) {
    const st = getStore();

    const dir=[], bat=[], grid=[], tot=[];
    for (let i=1;i<=12;i++) {
      dir[i-1]  = st["p6_dir_m"+i]  ?? safe(payload.dir[i-1]);
      bat[i-1]  = st["p6_bat_m"+i]  ?? safe(payload.bat[i-1]);
      grid[i-1] = st["p6_grid_m"+i] ?? safe(payload.grid[i-1]);
      tot[i-1]  = st["p6_tot_m"+i]  ?? safe(payload.tot[i-1]);
    }

    return { dir, bat, grid, tot };
  }


// --------------------------------------------------------------------
// GRAPHIC FINAL — PALETTE ORIGINALE MAIS PLUS FLASH
// --------------------------------------------------------------------
function drawChart(dir, bat, grid, tot) {

  const svg = $("#p6-chart");
  if (!svg) return;

  svg.innerHTML = "";
  const S = "http://www.w3.org/2000/svg";

  // même fond mais plus clair = plus contrasté
  svg.style.background = "#f8f9fc";

  const W = 1750, H = 520;
  const L = 28, R = 14, T = 24, B = 70;
  const innerW = W - L - R;
  const innerH = H - T - B;
  const colW = innerW / 12;

  // MAX global
  const MAXY = Math.ceil(Math.max(...tot) / 50) * 50 + 50;
  const y = v => H - B - (v/MAXY) * innerH;

  // =====================================================================
  // GRILLE — plus visible (mais fine)
  // =====================================================================
  for (let i=0;i<=6;i++) {
    const val = (MAXY/6) * i;
    const yy = y(val);

    const line = document.createElementNS(S,"line");
    line.setAttribute("x1", L);
    line.setAttribute("y1", yy);
    line.setAttribute("x2", W - R);
    line.setAttribute("y2", yy);
    line.setAttribute("stroke", "rgba(0,0,0,.07)");
    svg.appendChild(line);

    const tx = document.createElementNS(S,"text");
    tx.setAttribute("x", L - 10);
    tx.setAttribute("y", yy + 6);
    tx.setAttribute("text-anchor","end");
    tx.setAttribute("style","font-size:16px; fill:#4a5568; font-weight:500;");
    tx.textContent = Math.round(val) + " kWh";
    svg.appendChild(tx);
  }

  // Ligne moyenne (renforcée)
  const avg = tot.reduce((a,b)=>a+b,0)/12;
  const avgLine = document.createElementNS(S,"line");
  avgLine.setAttribute("x1", L);
  avgLine.setAttribute("y1", y(avg));
  avgLine.setAttribute("x2", W-R);
  avgLine.setAttribute("y2", y(avg));
  avgLine.setAttribute("stroke", "#cbd5e1");
  avgLine.setAttribute("stroke-width", "2");
  svg.appendChild(avgLine);

  // =====================================================================
  // COULEURS ORIGINALES MAIS PLUS FLASH
  // (on garde EXACTEMENT ta palette, juste plus saturée)
  // =====================================================================
  const C_DIR  = "#86D8F1";  // Bleu original → augmenté (plus flash)
  const C_BATT = "#B3F4C4";  // Vert original → boosté
  const C_GRID = "#CFCBFF";  // Violet original → renforcé

  // Ombre douce pour donner du relief
  const SHADOW = "drop-shadow(0px 3px 5px rgba(0,0,0,0.18))";

  // =====================================================================
  // BARRES EMPILÉES
  // =====================================================================
  for (let i=0;i<12;i++) {

    const x0 = L + i*colW + 8;
    const w = colW - 16;
    const base = H - B;

    const hDir  = innerH * (dir[i]  / MAXY);
    const hBat  = innerH * (bat[i]  / MAXY);
    const hGrid = innerH * (grid[i] / MAXY);

    // ----- BLEU → PV DIRECTE -----
    const r1 = document.createElementNS(S,"rect");
    r1.setAttribute("x", x0);
    r1.setAttribute("width", w);
    r1.setAttribute("y", base - hDir);
    r1.setAttribute("height", hDir);
    r1.setAttribute("fill", C_DIR);
    r1.setAttribute("rx", "6");
    r1.style.filter = SHADOW;
    svg.appendChild(r1);

    // ----- VERT → BATTERIE -----
    if (hBat > 0.5) {
      const r2 = document.createElementNS(S,"rect");
      r2.setAttribute("x", x0);
      r2.setAttribute("width", w);
      r2.setAttribute("y", base - hDir - hBat);
      r2.setAttribute("height", hBat);
      r2.setAttribute("fill", C_BATT);
      r2.setAttribute("rx","6");
      r2.style.filter = SHADOW;
      svg.appendChild(r2);
    }

    // ----- VIOLET → RÉSEAU -----
    if (hGrid > 0.5) {
      const r3 = document.createElementNS(S,"rect");
      r3.setAttribute("x", x0);
      r3.setAttribute("width", w);
      r3.setAttribute("y", base - hDir - hBat - hGrid);
      r3.setAttribute("height", hGrid);
      r3.setAttribute("fill", C_GRID);
      r3.setAttribute("rx","6");
      r3.style.filter = SHADOW;
      svg.appendChild(r3);
    }

    // Label mois (renforcé)
    const month = document.createElementNS(S,"text");
    month.setAttribute("x", L + i*colW + colW/2);
    month.setAttribute("y", H - 12);
    month.setAttribute("text-anchor","middle");
    month.setAttribute("style","font-size:18px; fill:#1e293b; font-weight:600;");
    month.textContent = MONTHS[i];
    svg.appendChild(month);

  }
}

  
  // --------------------------------------------------------------------
  // KPI (inchangé)
  // --------------------------------------------------------------------
  function renderKPIs(dir, bat, grid, tot, price) {

    const sum = arr => arr.reduce((a,b)=>a+b,0);

    const totConso = sum(tot);
    const totDir   = sum(dir);
    const totBat   = sum(bat);
    const totGrid  = sum(grid);

    const autonomie = totConso ? (1 - (totGrid/totConso)) : 0;
    const autoPct   = totConso ? ((totDir+totBat)/totConso) : 0;

    $("#p6_autonomie").textContent =
      Math.round(autonomie*100) + " %";

    $("#p6_autonomie_txt").textContent =
      `${Math.round(totDir+totBat)} kWh couverts / ${Math.round(totConso)} kWh`;

    $("#p6_grid_kwh").textContent =
      Math.round(totGrid).toLocaleString("fr-FR") + " kWh";

    $("#p6_grid_eur").textContent =
      Math.round(totGrid * price).toLocaleString("fr-FR") + " €";

    $("#p6_auto_pct").textContent =
      Math.round(autoPct*100) + " %";

    $("#p6_auto_txt").textContent =
      `PV directe + batterie = ${(totDir+totBat).toLocaleString("fr-FR")} kWh`;

    $("#p6_kpis").style.display = "grid";
  }

  // --------------------------------------------------------------------
  // HYDRATATION
  // --------------------------------------------------------------------
  function hydrate(payload) {

    const data = payload.p6 || payload;

    const st = getStore();
    st["p6_meta_client_in"] = data.meta.client;
    st["p6_meta_ref_in"]    = data.meta.ref;
    st["p6_meta_date_in"]   = data.meta.date;
    st["p6_price"]          = data.price;

    const {dir,bat,grid,tot} = mergeSeries(data);

    setStore(st);

    // Maj métas
    $("#p6_client").textContent = data.meta.client;
    $("#p6_ref").textContent    = data.meta.ref;
    $("#p6_date").textContent   = data.meta.date;

    // Graphique
    drawChart(dir, bat, grid, tot);

    // KPI
    renderKPIs(dir, bat, grid, tot, data.price);

    $("#p6_cta").style.display = "none";
    $("#p6_chart_zone").style.display = "block";
  }

  // --------------------------------------------------------------------
  // BIND
  // --------------------------------------------------------------------
  window.API = window.API || {};
  window.API.bindEngineP6 = function (Engine) {
    if (!Engine) return;

    Engine.on("p6:update", payload => {
      try { hydrate(payload); }
      catch (e) { console.error("❌ Hydratation P6 ratée :", e); }
    });

    console.log("✔ ENGINE-P6 chargé (version finale Solarglobe)");
  };

})();
