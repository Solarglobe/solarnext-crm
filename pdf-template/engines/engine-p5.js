// ============================================================================
// ENGINE-P5 — Journée annuelle moyenne + OPTION A++
// Solarglobe 2025 — Version ULTRA PREMIUM DOUCE
// (PV réel + conso/auto/batt amplifiés + courbes ultra arrondies)
// ============================================================================

(function(){

  const STORAGE = "smartpitch_overrides";
  const $ = (s,root=document)=>root.querySelector(s);
  const safe = v => Number.isFinite(Number(v)) ? Number(v) : null;
  const safeNum = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const hours24 = Array.from({length:24},(_,i)=>String(i).padStart(2,"0")+":00");

  // ============================================================================
  // 1) LOAD OVERRIDES
  // ============================================================================
  function loadOverrides(){
    const store = JSON.parse(localStorage.getItem(STORAGE) || "{}");
    const ovProd=[] , ovConso=[] , ovBatt=[];

    for(let i=0;i<24;i++){
      ovProd[i]  = safe(store["p5_prod_h"+i]);
      ovConso[i] = safe(store["p5_conso_h"+i]);
      ovBatt[i]  = safe(store["p5_batt_h"+i]);
    }

    return {ovProd, ovConso, ovBatt, store};
  }

  // ============================================================================
  // 2) MERGE BACKEND + OVERRIDES (sans jamais casser backend)
  // ============================================================================
  function mergeSeries(payload){
    const backProd  = payload.production_kw     || Array(24).fill(0);
    const backConso = payload.consommation_kw   || Array(24).fill(0);
    const backBatt  = payload.batterie_kw       || Array(24).fill(0);

    const { ovProd, ovConso, ovBatt } = loadOverrides();
    const final = [];

    for(let i=0;i<24;i++){
      const prod = ovProd[i]  ?? backProd[i];
      const con  = ovConso[i] ?? backConso[i];
      const batt = ovBatt[i]  ?? backBatt[i];

      final.push({
        prod: safeNum(prod),
        conso: safeNum(con),
        batt: safeNum(batt),
        auto: Math.min(safeNum(prod), safeNum(con))
      });
    }
    return final;
  }

  // ============================================================================
  // 3) META
  // ============================================================================
  function applyMeta(meta, store){
    $('#p5_client').textContent = store["p5_meta_client_in"] || meta.client || "—";
    $('#p5_ref').textContent    = store["p5_meta_ref_in"]    || meta.ref    || "—";
    $('#p5_date').textContent   = store["p5_meta_date_in"]   || meta.date   || "—";
    $('#p5_month').textContent  = "Annuel";
  }

  // ============================================================================
  // 4) HYDRATE
  // ============================================================================
  function hydrate(payload){
    if(!payload) return;

    const store = JSON.parse(localStorage.getItem(STORAGE) || "{}");
    applyMeta(payload.meta, store);

    const series = mergeSeries(payload);

    $('#p5_chart_zone').style.display = "block";
    window.API_p5_drawChart(series);
  }

  // ============================================================================
  // 5) BIND
  // ============================================================================
  window.API = window.API || {};

  window.API.bindEngineP5 = function(Engine){
    if(!Engine) return;

    Engine.on("p5:update", payload => {
      try { hydrate(payload.p5 || payload); }
      catch(e){ console.error("❌ hydrate P5:", e); }
    });
  };

})();

// ============================================================================
// 6) DRAW CHART — ENERGY-TECH PREMIUM (P5)
// ============================================================================

(function(){

  const $ = (s,root=document)=>root.querySelector(s);
  const safeNum = v => Number.isFinite(Number(v)) ? Number(v) : 0;
  const hours24 = Array.from({length:24},(_,i)=>String(i).padStart(2,"0")+":00");

  window.API_p5_drawChart = function(series){
    const svg = $('#p5-chart');
    if(!svg) return;

    // Fond technique gris pour détacher du PDF blanc
    svg.style.background = "#f3f4f6";
    svg.innerHTML = "";

    const W=2000, H=560;
    const PAD_L=70, PAD_R=50, PAD_T=25, PAD_B=70;

    // Max réels
    let maxProd=0, maxConso=0, maxBatt=0;
    for(const s of series){
      if(s.prod > maxProd) maxProd = s.prod;
      if(s.conso> maxConso) maxConso = s.conso;
      if(s.batt > maxBatt) maxBatt = s.batt;
    }

    // OPTION A++ (inchangé)
    const scalePV = 1;
    const scaleConso = 4 / Math.max(0.1, maxConso);
    const scaleAuto  = scaleConso;
    const scaleBatt  = 2.5 / Math.max(0.1, maxBatt);

    const visual = series.map(s => ({
      prod_real : s.prod,
      prod      : s.prod * scalePV,
      conso     : s.conso * scaleConso,
      auto      : Math.min(s.prod, s.conso) * scaleAuto,
      batt      : s.batt * scaleBatt
    }));

    const maxY = Math.max(
      0.1,
      ...visual.map(v => Math.max(v.prod, v.conso, Math.abs(v.batt)))
    ) * 1.12;

    const sx = i => PAD_L + i*((W-PAD_L-PAD_R)/23);
    const sy = v => H - PAD_B - (v/maxY)*(H-PAD_T-PAD_B);

    // SPLINE tech (tension = 0.10 → un peu plus tendu que P4)
    function spline(arr, acc){
      const pts = arr.map((d,i)=>[sx(i), sy(acc(d))]);
      if(!pts.length) return "";
      const k = 0.10;
      let d = `M ${pts[0][0]},${pts[0][1]}`;
      for(let i=0;i<pts.length-1;i++){
        const p0=pts[i], p1=pts[i+1];
        const p_1=pts[i-1]||p0, p2=pts[i+2]||p1;

        const c1x = p0[0] + (p1[0]-p_1[0])*k;
        const c1y = p0[1] + (p1[1]-p_1[1])*k;
        const c2x = p1[0] - (p2[0]-p0[0])*k;
        const c2y = p1[1] - (p2[1]-p0[1])*k;

        d += ` C ${c1x},${c1y} ${c2x},${c2y} ${p1[0]},${p1[1]}`;
      }
      return d;
    }

    // ========================================================================
    // DÉGRADÉS ENERGY-TECH (PROFONDS, SATURÉS, CONTRASTÉS)
    // ========================================================================
    const defs = document.createElementNS("http://www.w3.org/2000/svg","defs");
    defs.innerHTML = `

      <!-- Production solaire — OR ÉNERGIE -->
      <linearGradient id="p5pv" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#FFCE63" stop-opacity="1"/>
        <stop offset="100%" stop-color="#E2A93F" stop-opacity="0.55"/>
      </linearGradient>

      <!-- Consommation — BLEU CARBONE TECH -->
      <linearGradient id="p5conso" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#3A4A72" stop-opacity="0.9"/>
        <stop offset="100%" stop-color="#1A2A4A" stop-opacity="0.45"/>
      </linearGradient>

      <!-- Autoconsommation — CYAN TECH -->
      <linearGradient id="p5auto" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#00D0EA" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#00A5C0" stop-opacity="0.45"/>
      </linearGradient>

      <!-- Batterie — VERT ÉNERGIE -->
      <linearGradient id="p5batt" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0%" stop-color="#54F49B" stop-opacity="0.95"/>
        <stop offset="100%" stop-color="#1FC166" stop-opacity="0.45"/>
      </linearGradient>

      <!-- Glow énergétique pour la production -->
      <filter id="p5-glow">
        <feGaussianBlur stdDeviation="8" result="blur"/>
        <feMerge>
          <feMergeNode in="blur"/>
          <feMergeNode in="SourceGraphic"/>
        </feMerge>
      </filter>
    `;
    svg.appendChild(defs);

    // ========================================================================
    // AREAS
    // ========================================================================
    function area(arr, acc, grad){
      const top = spline(arr, acc);
      const p = document.createElementNS("http://www.w3.org/2000/svg","path");
      p.setAttribute("d", top + ` L ${sx(23)},${sy(0)} L ${sx(0)},${sy(0)} Z`);
      p.setAttribute("fill", `url(#${grad})`);
      p.setAttribute("opacity", "0.58"); // plus visible que P4
      svg.appendChild(p);
    }

    area(visual, d=>d.conso, "p5conso");
    area(visual, d=>d.auto,  "p5auto");
    area(visual, d=>d.prod,  "p5pv");

    if(series.some(s=>safeNum(s.batt) !== 0)){
      area(visual, d=>Math.max(0,d.batt), "p5batt");
      $("#p5_leg_batt").style.display="inline-block";
      $("#p5_leg_batt_text").style.display="block";
    } else {
      $("#p5_leg_batt").style.display="none";
      $("#p5_leg_batt_text").style.display="none";
    }

    // ========================================================================
    // LIGNES (fortes, techniques, identitaires)
    // ========================================================================
    function stroke(arr, acc, col, w, glow=false){
      const d = spline(arr, acc);
      const p = document.createElementNS("http://www.w3.org/2000/svg","path");
      p.setAttribute("d", d);
      p.setAttribute("fill","none");
      p.setAttribute("stroke", col);
      p.setAttribute("stroke-width", w);
      p.setAttribute("stroke-linecap", "round");
      if(glow) p.setAttribute("filter", "url(#p5-glow)");
      svg.appendChild(p);
    }

    stroke(visual, d=>d.conso, "#1A2A4A", 3.8);
    stroke(visual, d=>d.auto,  "#00A5C0", 3.4);
    stroke(visual, d=>d.prod,  "#E2A93F", 4.2, true);  // Glow solaire

    if(series.some(s=>safeNum(s.batt)!==0)){
      stroke(visual, d=>d.batt, "#1FC166", 3.0);
    }

    // ========================================================================
    // GRID TECH
    // ========================================================================
    for(let t=0;t<=5;t++){
      const y = sy(maxY*t/5);
      const line = document.createElementNS("http://www.w3.org/2000/svg","line");
      line.setAttribute("x1",PAD_L);
      line.setAttribute("x2",W-PAD_R);
      line.setAttribute("y1",y);
      line.setAttribute("y2",y);
      line.setAttribute("stroke","rgba(0,0,0,.08)");
      svg.appendChild(line);
    }

    // ========================================================================
    // HOURS
    // ========================================================================
    for(let i=0;i<24;i+=2){
      const tx=document.createElementNS("http://www.w3.org/2000/svg","text");
      tx.setAttribute("x", sx(i));
      tx.setAttribute("y", H-18);
      tx.setAttribute("text-anchor","middle");
      tx.style.fill="#333";
      tx.style.fontSize="13px";
      tx.style.fontWeight="600";
      tx.textContent=hours24[i];
      svg.appendChild(tx);
    }
  };

})();
