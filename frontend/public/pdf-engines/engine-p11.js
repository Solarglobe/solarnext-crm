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

  /** Mini-cartes « Synthèse années clés » : milliers en espace insécable, € collé (évite coupures PDF) */
  function fmtEurSynth(n) {
    if (n == null || !Number.isFinite(Number(n))) return "—";
    const core = Math.round(Number(n)).toLocaleString("fr-FR");
    return `${core.replace(/\s/g, "\u00a0")}€`;
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
    for (let i = 0; i < pay.length; i++) {
      if (Number(pay[i]) > 0.5) last = i;
    }
    return last;
  }

  function drawChart(svgEl, series) {
    if(!svgEl || !Array.isArray(series?.economies_annuelles))return;
    const eco=series.economies_annuelles, pay=series.paiement_annuel||[], n=eco.length;
    if(!n)return;
    while(svgEl.firstChild)svgEl.removeChild(svgEl.firstChild);
    const min=Math.min(0,...eco,...pay),max=Math.max(1,...eco,...pay),span=max-min;
    const top=min-span*.05,bottom=max+span*.05;
    const y=v=>20+580*(bottom-v)/(bottom-top), zero=y(0),w=2200/n;
    const add=(tag,attrs,text)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,String(v));if(text!=null)el.textContent=text;svgEl.appendChild(el);};
    for(let i=0;i<=4;i++){const v=top+i*(bottom-top)/4;if(Math.abs(v)<span*.08)continue;add('line',{x1:170,x2:2380,y1:y(v),y2:y(v),stroke:'#e2e0d8'});add('text',{x:160,y:y(v)+8,'text-anchor':'end','font-size':25,fill:'#454545'},fmtEur(v));}
    add('line',{x1:170,x2:2380,y1:zero,y2:zero,stroke:'#525252','stroke-width':3});
    add('text',{x:160,y:zero+8,'text-anchor':'end','font-size':25,'font-weight':700,fill:'#333'},'0 €');
    for(let i=0;i<n;i++)for(const[value,offset,color]of[[Number(eco[i])||0,.08,eco[i]<0?'#b91c1c':'#c99b34'],[Number(pay[i])||0,.52,'#28282d']])add('rect',{x:170+(i+offset)*w,y:Math.min(zero,y(value)),width:w*.35,height:Math.abs(y(value)-zero),fill:color,rx:3});
    for(const year of [...new Set([1,5,10,15,20,n].filter(v=>v<=n))])add('text',{x:170+(year-.5)*w,y:640,'font-size':26,'text-anchor':'middle',fill:'#333'},String(year));
    add('text',{x:1280,y:685,'font-size':26,'text-anchor':'middle',fill:'#444'},'Années — projection sur '+n+' ans');
  }

  /** Années affichées dans le mini tableau de synthèse (indices série = année − 1). */
  const P11_SYNTH_YEARS = [1, 5, 10, 15, 20, 25];

  function fillSummaryGrid(series) {
    if (!series || !Array.isArray(series.economies_annuelles)) return;
    const eco = series.economies_annuelles;
    const pay = series.paiement_annuel || [];
    const reste = series.reste_a_charge_annuel || [];
    for (const y of P11_SYNTH_YEARS) {
      const i = (y===25?eco.length:Math.min(y,eco.length)) - 1;
      set(`p11_syn_gain_${y}`, fmtEurSynth(eco[i]));
      const r = Number(reste[i]);
      const solde = Number.isFinite(r) ? r : (Number(eco[i]) || 0) - (Number(pay[i]) || 0);
      const soldeTxt = Number.isFinite(solde) ? fmtEurSynth(solde) : "—";
      set(`p11_syn_reste_${y}`, soldeTxt);
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
    set(
      "p11_kpi2_val",
      kpi.total_paid_eur != null
        ? kpi.credit_cost_eur != null && Number(kpi.credit_cost_eur) > 0
          ? `${fmtEur(kpi.total_paid_eur)} (coût ${fmtEur(kpi.credit_cost_eur)})`
          : fmtEur(kpi.total_paid_eur)
        : "—"
    );
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
