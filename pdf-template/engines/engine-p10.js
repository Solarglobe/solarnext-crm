// ============================================================================
// ENGINE-P10 — Synthèse finale (PDF) — version correcte SmartPitch
// ============================================================================

(function(){

  const nf0 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 0 });
  const nf1 = new Intl.NumberFormat("fr-FR", { maximumFractionDigits: 1 });
  const nf3 = new Intl.NumberFormat("fr-FR", { minimumFractionDigits: 3, maximumFractionDigits: 3 });

  const MAX = { ROI:20, TRI:20, LCOE:0.25 };

  const $ = (s,root=document)=>root.querySelector(s);
  const set = (id,val)=>{ const el=document.getElementById(id); if(el) el.textContent=val; };
  const clamp01 = x=>Math.max(0,Math.min(1,x));

  // -------------------------
  // RENDER
  // -------------------------
  function render(payload){
    if(!payload) return;

    const meta = payload.meta || {};
    const b = payload.best || {};
    const hyp = payload.hyp || {};

    // META
    set("p10_client", meta.client || "—");
    set("p10_ref",    meta.ref    || "—");
    set("p10_date",   meta.date   || "—");

    // KPIs
    set("p10_kwc", nf1.format(b.kwc || 0));
    set("p10_modules", [b.modules_label,b.inverter_label].filter(Boolean).join(" • ") || "—");
    set("p10_savings_y1", nf0.format(b.savings_year1_eur || 0));
    set("p10_roi", nf1.format(b.roi_years || 0));
    set("p10_tri", nf1.format(b.tri_pct || 0));

    // config
    const cfg = b.cfg_label || `${nf1.format(b.kwc||0)} kWc${b.battery_kwh ? ` + Batterie ${nf1.format(b.battery_kwh)} kWh` : ""}`;
    set("p10_cfg", cfg);

    // auto
    set("p10_autoprod",  b.autoprod_pct!=null  ? `${nf1.format(b.autoprod_pct)} %` : "—");
    set("p10_autonomy",  b.autonomy_pct!=null  ? `≈ ${nf1.format(b.autonomy_pct)} %` : "—");
    set("p10_gains25",   b.gains_25_eur!=null  ? `${nf0.format(b.gains_25_eur)} €` : "—");
    set("p10_lcoe",      b.lcoe_eur_kwh!=null  ? `${nf3.format(b.lcoe_eur_kwh)} €/kWh` : "—");

    // valeur chiffres
    set("p10_roi_val",  b.roi_years!=null ? nf1.format(b.roi_years) : "—");
    set("p10_tri_val",  b.tri_pct!=null   ? nf1.format(b.tri_pct)   : "—");
    set("p10_lcoe_val", b.lcoe_eur_kwh!=null ? nf3.format(b.lcoe_eur_kwh) : "—");

    // barres
    $("#p10_roi_bar").style.width  = (clamp01((MAX.ROI-(b.roi_years||MAX.ROI))/MAX.ROI)*100)+"%";
    $("#p10_tri_bar").style.width  = (clamp01((b.tri_pct||0)/MAX.TRI)*100)+"%";
    $("#p10_lcoe_bar").style.width = (clamp01((b.lcoe_eur_kwh||0)/MAX.LCOE)*100)+"%";

    // AUDIT
    set("p10_audit",
      `PVGIS + hypothèses Solarglobe (dégrad. −${nf1.format(hyp.pv_degrad ?? 0.5)} %/an, `+
      `élec +${nf1.format(hyp.elec_infl ?? 4)} %/an, `+
      `OA ${nf3.format(hyp.oa_price ?? 0.04)} €/kWh) — audit automatique ✅`
    );

    // show results
    const action = document.getElementById("p10_action");
    const res = document.getElementById("p10_result");
    if(action) action.style.display = "none";
    if(res) res.style.display = "";
  }

  // -------------------------
  // BIND ENGINE
  // -------------------------
  const API = (window.EngineP10 = {});

  API.bind = function(engine){
    if(!engine) return;

    engine.on("p10:update", data=>{
      console.log("🔥 ENGINE-P10 payload:", data);
      render(data);
    });

    if(typeof engine.getP10==="function"){
      const first = engine.getP10();
      if(first) render(first);
    }
  };

  if(window.Engine){
    API.bind(window.Engine);
  }

})();
