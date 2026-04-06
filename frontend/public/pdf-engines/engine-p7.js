// ============================================================================
// ENGINE-P7 — VERSION SOLARGLOBE PREMIUM 2025
// Origine / Destination des flux — Final Fusionné & Corrigé
// ============================================================================
(function(){

  // ============================================================================
  // Helpers
  // ============================================================================
  const $ = (s, r=document) => r.querySelector(s);
  const safeNum = v => Number.isFinite(Number(v)) ? Number(v) : 0;

  // ============================================================================
  // PAYLOAD → DOM (aucune transformation, pas de normalisation)
  // ============================================================================
  function mergeP7(payload){
    const pct = payload.pct || {};

    return {
      conso: {
        pv   : safeNum(pct.c_pv_pct),
        batt : safeNum(pct.c_bat_pct),
        grid : safeNum(pct.c_grid_pct)
      },
      prod: {
        auto    : safeNum(pct.p_auto_pct),
        batt    : safeNum(pct.p_bat_pct),
        surplus : safeNum(pct.p_surplus_pct)
      },
      kwh: {
        grid    : safeNum(payload.c_grid),
        surplus : safeNum(payload.p_surplus)
      },
      meta: {
        client : payload.meta?.client || "",
        ref    : payload.meta?.ref    || "",
        date   : payload.meta?.date   || "",
        scen   : payload.meta?.scenario_label || ""
      }
    };
  }

  // ============================================================================
  // META
  // ============================================================================
  function applyMeta(m){
    $('#p7_client').textContent = m.client || "—";
    $('#p7_ref').textContent    = m.ref    || "—";
    $('#p7_date').textContent   = m.date   || "—";
    $('#p7_meta_scen').textContent = m.scen || "—";
  }

  // ============================================================================
  // SEGMENT (BOUT DE BARRE)
  // ============================================================================
  function seg(percent, color, textColor, label){
    const v = safeNum(percent);
    const d = document.createElement("div");

    d.style.flex = v + "% 0 0";
    d.style.background = color;
    d.style.display = v < 2 ? "none" : "flex";
    d.style.alignItems = "center";
    d.style.justifyContent = "center";

    d.style.borderRadius = "5mm";
    d.style.boxShadow = "0 0 4px rgba(0,0,0,.14) inset";

    d.style.fontWeight = "700";
    d.style.fontSize = "3.2mm";
    d.style.color = textColor || "#1A1A1A";

    d.textContent = v >= 8 ? `${v}% ${label}` : "";
    return d;
  }

  // ============================================================================
  // BARRE COMPLÈTE
  // ============================================================================
  function buildBar(title, parts){
    const blk = document.createElement("div");
    blk.style.padding = "0 2mm 2mm 2mm";

    const lab = document.createElement("div");
    lab.style.fontWeight = "800";
    lab.style.color = "#C39847";
    lab.style.margin = "0 0 1mm 2mm";
    lab.style.fontSize = "3.4mm";
    lab.innerHTML = title;
    blk.appendChild(lab);

    const bar = document.createElement("div");
    bar.style.display = "flex";
    bar.style.height = "8mm";
    bar.style.borderRadius = "5mm";
    bar.style.overflow = "hidden";
    bar.style.boxShadow = "0 0 0 1px rgba(0,0,0,.06) inset";
    blk.appendChild(bar);

    parts.forEach(p => bar.appendChild(seg(p.pct, p.color, p.textColor, p.label)));

    const scale = document.createElement("div");
    scale.style.display = "flex";
    scale.style.justifyContent = "space-between";
    scale.style.fontSize = "3.1mm";
    scale.style.color = "#7C7C7C";
    scale.style.marginTop = "1.4mm";
    scale.style.padding = "0 2mm";
    scale.innerHTML = "<span>0%</span><span>25%</span><span>50%</span><span>75%</span><span>100%</span>";
    blk.appendChild(scale);

    return blk;
  }

  // ============================================================================
  // LÉGENDE PREMIUM
  // ============================================================================
  function buildLegend(){
    const wrap = document.createElement("div");
    wrap.style.display = "flex";
    wrap.style.flexWrap = "wrap";
    wrap.style.gap = "6mm";
    wrap.style.fontSize = "3.5mm";
    wrap.style.margin = "0 0 3mm";

    const item = (color, txt) => {
      const s = document.createElement("span");
      s.style.display = "inline-flex";
      s.style.alignItems = "center";
      s.style.gap = "2.5mm";

      const r = document.createElement("i");
      r.style.width = "7mm";
      r.style.height = "4.2mm";
      r.style.borderRadius = "2mm";
      r.style.background = color;
      r.style.boxShadow = "0 0 0 0.35mm rgba(0,0,0,.05) inset";

      s.appendChild(r);
      s.appendChild(document.createTextNode(txt));
      return s;
    };

    wrap.appendChild(item("#E7C25A","PV directe"));
    wrap.appendChild(item("#8EE6B4","Batterie"));
    wrap.appendChild(item("#B8A6FF","Réseau"));
    wrap.appendChild(item("#7FDDF3","Autoconso (prod)"));
    wrap.appendChild(item("#4CA8E5","Surplus"));

    return wrap;
  }

  // ============================================================================
  // KPI PREMIUM
  // ============================================================================
  function buildKPI(title, value, note){
    const box = document.createElement("div");
    box.className = "p7-kpi card soft";

    box.style.minHeight = "20mm";
    box.style.padding = "3.8mm 3.6mm";
    box.style.background = "#fdfcf9";
    box.style.border = "1px solid rgba(195,152,71,.25)";
    box.style.borderRadius = "6mm";
    box.style.boxShadow = "0 1mm 4mm rgba(0,0,0,.06)";

    const t = document.createElement("div");
    t.style.fontWeight = "800";
    t.style.marginBottom = "1mm";
    t.style.color = "#C39847";
    t.textContent = title;

    const v = document.createElement("div");
    v.style.fontSize = "6.8mm";
    v.style.lineHeight = "1";
    v.style.marginBottom = ".6mm";
    v.style.color = "#1A1A1A";
    v.textContent = value;

    const n = document.createElement("div");
    n.style.fontSize = "3.3mm";
    n.style.color = "#666";
    n.textContent = note;

    box.appendChild(t);
    box.appendChild(v);
    box.appendChild(n);
    return box;
  }

  // ============================================================================
  // BUILD PAGE 7
  // ============================================================================
  function buildP7(final){
    const zone = $('#p7_visual_zone');
    if(!zone) return;

    zone.innerHTML = "";
    zone.style.display = "block";

    const card = document.createElement("div");
    card.className = "card soft";
    card.style.padding = "3mm 6mm";
    card.style.marginBottom = "4mm";
    card.style.borderRadius = "5mm";
    card.style.border = ".45mm solid rgba(195,152,71,.25)";
    card.style.boxShadow = "0 1.6mm 5mm rgba(0,0,0,.04)";

    // Tête
    const head = document.createElement("div");
    head.style.display = "flex";
    head.style.justifyContent = "space-between";
    head.style.marginBottom = "1.6mm";

    const title = document.createElement("h3");
    title.style.margin = "0";
    title.style.fontSize = "4.6mm";
    title.textContent = "Origine / Destination — scénario retenu";

    const scen = document.createElement("div");
    scen.id = "p7_meta_scen";
    scen.style.fontWeight = "800";
    scen.style.fontSize = "3.6mm";
    scen.textContent = final.meta.scen || "";

    head.appendChild(title);
    head.appendChild(scen);
    card.appendChild(head);

    // Légende
    card.appendChild(buildLegend());

    // BARRE CONSOMMATION
    card.appendChild(
      buildBar("Origine de la <b>consommation</b> (100 %)", [
        {pct:final.conso.pv,   color:"#E7C25A", textColor:"#1b1b1b", label:"PV directe"},
        {pct:final.conso.batt, color:"#8EE6B4", textColor:"#0C2E1B", label:"Batterie"},
        {pct:final.conso.grid, color:"#B8A6FF", textColor:"#221",    label:"Réseau"}
      ])
    );

    // BARRE PRODUCTION
    card.appendChild(
      buildBar("Destination de la <b>production</b> (100 %)", [
        {pct:final.prod.auto,    color:"#7FDDF3", textColor:"#1A3C46", label:"Autoconso"},
        {pct:final.prod.batt,    color:"#8EE6B4", textColor:"#0C2E1B", label:"Batterie"},
        {pct:final.prod.surplus, color:"#4CA8E5", textColor:"#fff",    label:"Surplus"}
      ])
    );

    zone.appendChild(card);

    // KPIs
    const kpi = document.createElement("div");
    kpi.style.display = "grid";
    kpi.style.gridTemplateColumns = "repeat(4,1fr)";
    kpi.style.gap = "4mm";

    const autonomie = safeNum(final.conso.pv) + safeNum(final.conso.batt);
    const autocons  = safeNum(final.prod.auto) + safeNum(final.prod.batt);

    kpi.appendChild(
      buildKPI("Autonomie", String(autonomie)+" %",
        "= "+String(final.conso.pv)+" % PV directe + "+String(final.conso.batt)+" % Batterie")
    );

    kpi.appendChild(
      buildKPI("Autoconsommation", String(autocons)+" %",
        "= "+String(final.prod.auto)+" % Autoconso")
    );

    kpi.appendChild(
      buildKPI("Part réseau", String(final.conso.grid)+" %",
        "≈ "+String(final.kwh.grid)+" kWh")
    );

    kpi.appendChild(
      buildKPI("Surplus", String(final.prod.surplus)+" %",
        "≈ "+String(final.kwh.surplus)+" kWh")
    );

    zone.appendChild(kpi);
  }

  // ============================================================================
  // BIND ENGINE
  // ============================================================================
  window.API = window.API || {};

  window.API.bindEngineP7 = function(Engine){
    Engine.on("p7:update", payload => {
      try{
        const final = mergeP7(payload);
        applyMeta(final.meta);
        buildP7(final);
        window.__LAST_P7_PAYLOAD__ = payload;
      } catch(e){
        console.error("❌ P7 ERROR:", e);
      }
    });

    console.log("✔ ENGINE-P7 — VERSION PREMIUM FINALE");
  };

})();
