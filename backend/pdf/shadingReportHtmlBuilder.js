/**
 * shadingReportHtmlBuilder.js
 * Génère le HTML du rapport "Analyse d'ombrage" Phase 3.
 * Thème sombre SolarNext — rendu autonome sans React.
 * Données issues de getDsmAnalysisData() + buildSolarNextPayload().
 */

const MONTHS = ["Jan", "Fév", "Mar", "Avr", "Mai", "Jui", "Jul", "Aoû", "Sep", "Oct", "Nov", "Déc"];

function fmtN(v) {
  if (v == null || !isFinite(v)) return "—";
  return Math.round(v).toLocaleString("fr-FR");
}
function fmtPct(v) {
  if (v == null || !isFinite(v)) return "—";
  return v.toFixed(1) + " %";
}
function lossColor(pct) {
  if (pct == null || !isFinite(pct)) return "#E8ECF8";
  if (pct < 5)  return "#9FA8C7";
  if (pct < 15) return "#C39847";
  return "#E57373";
}

/**
 * @param {object} data - résultat de getDsmAnalysisData()
 * @param {object} [orgBranding] - { name, logoBase64 }
 */
export function buildShadingReportHtml(data, orgBranding = {}) {
  const { address, date, shading, lat, lon, orientationDeg, tiltDeg, horizonMask, org, lead } = data;

  // ── Données d'ombrage ─────────────────────────────────────────────────────
  const combinedPct  = shading?.combined?.totalLossPct ?? shading?.totalLossPct ?? null;
  const farPct       = shading?.far?.totalLossPct      ?? shading?.far_loss_pct ?? null;
  const nearPct      = shading?.near?.totalLossPct     ?? shading?.near_loss_pct ?? null;
  const annualLossKwh = shading?.annualLossKwh ?? null;
  const pvgisRef     = shading?.pvgisReference ?? {};
  const monthlyFactors  = Array.isArray(shading?.monthlyFactors)  ? shading.monthlyFactors  : null;
  const monthlyKwhStats = Array.isArray(shading?.monthlyKwhStats) ? shading.monthlyKwhStats : null;

  // Production totale théorique / réelle
  const prodNoShading   = monthlyKwhStats ? Math.round(monthlyKwhStats.reduce((s, m) => s + (m.productionNoShadingKwh  ?? 0), 0)) : null;
  const prodWithShading = monthlyKwhStats ? Math.round(monthlyKwhStats.reduce((s, m) => s + (m.productionWithShadingKwh ?? 0), 0)) : null;

  const farHorizonKind = shading?.horizonMask?.farHorizonKind ?? horizonMask?.source ?? "UNAVAILABLE";
  const badgeColor = farHorizonKind === "REAL_TERRAIN" ? "#4ade80" : farHorizonKind === "SYNTHETIC" ? "#F59E0B" : "#E57373";
  const badgeText  = farHorizonKind === "REAL_TERRAIN" ? "ÉLEVÉE" : farHorizonKind === "SYNTHETIC" ? "ESTIMÉE" : "LIMITÉE";

  const maskArray  = horizonMask?.mask ?? [];
  const clientName = lead?.first_name && lead?.last_name ? `${lead.first_name} ${lead.last_name}` : address || "—";
  const orgName    = orgBranding.name || org?.name || "SolarNext";
  const logoHtml   = orgBranding.logoBase64
    ? `<img src="data:image/png;base64,${orgBranding.logoBase64}" style="height:32px;object-fit:contain">`
    : `<span style="font-size:14pt;font-weight:700;color:#C39847;letter-spacing:.06em">${orgName.toUpperCase()}</span>`;

  // ── Séries pour les barres mensuelles ─────────────────────────────────────
  const factorsJson = monthlyFactors
    ? JSON.stringify(monthlyFactors.map(m => ({
        f: parseFloat(((m.farLossFraction  ?? 0) * 100).toFixed(1)),
        n: parseFloat(((m.nearLossFraction ?? 0) * 100).toFixed(1)),
        c: parseFloat(((m.combinedLossFraction ?? 0) * 100).toFixed(1)),
      })))
    : "null";

  const maskJson = maskArray.length > 0 ? JSON.stringify(maskArray) : "null";

  // ── Tableau kWh mensuel ────────────────────────────────────────────────────
  let tableRows = "";
  if (monthlyKwhStats && monthlyKwhStats.length === 12) {
    const sorted = [...monthlyKwhStats].sort((a, b) => a.month - b.month);
    const tRef  = sorted.reduce((s, r) => s + (r.productionNoShadingKwh  ?? 0), 0);
    const tNet  = sorted.reduce((s, r) => s + (r.productionWithShadingKwh ?? 0), 0);
    const tLoss = sorted.reduce((s, r) => s + (r.kwhLoss ?? 0), 0);
    const tPct  = tRef > 0 ? (tLoss / tRef * 100).toFixed(1) + "%" : "—";
    const cs = "padding:2px 5px;text-align:right;border-bottom:1px solid rgba(255,255,255,0.04);font-size:7.5pt";
    const totCls = "border-left:1px solid rgba(255,255,255,0.12)";
    const rows4 = [
      { lb:"Prod. référence (kWh)", vs:sorted.map(r=>fmtN(r.productionNoShadingKwh)),  tot:fmtN(tRef),  col:"#E8ECF8", w:400 },
      { lb:"Prod. nette (kWh)",      vs:sorted.map(r=>fmtN(r.productionWithShadingKwh)), tot:fmtN(tNet),  col:"#C39847", w:600 },
      { lb:"Perte (kWh)",            vs:sorted.map(r=>fmtN(r.kwhLoss)),                  tot:fmtN(tLoss), col:"#E57373", w:400 },
      { lb:"Perte (%)",              vs:sorted.map(r=>r.lossPct!=null?r.lossPct.toFixed(1)+"%":"—"), tot:tPct, col:"#9FA8C7", w:400, it:true },
    ];
    tableRows = rows4.map((row, ri) =>
      `<tr style="background:${ri%2===0?"rgba(255,255,255,0.02)":"transparent"}">
        <td style="${cs};text-align:left;color:#9FA8C7;padding-right:8px;white-space:nowrap">${row.lb}</td>
        ${row.vs.map(v=>`<td style="${cs};color:${row.col};font-weight:${row.w};${row.it?"font-style:italic":""}">${v}</td>`).join("")}
        <td style="${cs};${totCls};color:${row.col};font-weight:${row.w===400?600:700};${row.it?"font-style:italic":""}">${row.tot}</td>
      </tr>`
    ).join("");
  }

  const footerPvgis = [
    pvgisRef.source && pvgisRef.source !== "PVGIS_UNAVAILABLE" ? "Source : PVGIS v5.3 (JRC)" : null,
    tiltDeg != null ? `Inclinaison : ${tiltDeg}°` : null,
    orientationDeg != null ? `Azimut : ${orientationDeg}°` : null,
  ].filter(Boolean).join("  ·  ");

  const tableSection = monthlyKwhStats && monthlyKwhStats.length === 12
    ? `<table style="width:100%;border-collapse:collapse;font-size:7.5pt">
        <thead><tr style="background:rgba(255,255,255,0.03)">
          <th style="text-align:left;padding:2px 5px;color:#9FA8C7;font-size:7pt;font-weight:500;border-bottom:1px solid rgba(255,255,255,0.04)"></th>
          ${MONTHS.map(m=>`<th style="text-align:right;padding:2px 5px;color:#9FA8C7;font-size:7pt;font-weight:500;border-bottom:1px solid rgba(255,255,255,0.04)">${m}</th>`).join("")}
          <th style="text-align:right;padding:2px 5px;color:#9FA8C7;font-size:7pt;font-weight:600;border-bottom:1px solid rgba(255,255,255,0.04);border-left:1px solid rgba(255,255,255,0.12)">Total</th>
        </tr></thead>
        <tbody>${tableRows}</tbody>
      </table>
      ${footerPvgis ? `<div style="margin-top:4px;font-size:6.5pt;color:#9FA8C7;opacity:.65">${footerPvgis}</div>` : ""}`
    : `<div style="text-align:center;padding:14px 0;font-size:8.5pt;color:#9FA8C7;opacity:.6;line-height:1.6">
        Données énergétiques mensuelles indisponibles<br>
        (puissance crête non renseignée ou données PVGIS inaccessibles)
      </div>`;

  // ── HTML complet ──────────────────────────────────────────────────────────
  return `<!DOCTYPE html>
<html lang="fr">
<head>
<meta charset="UTF-8">
<title>Analyse d'ombrage — ${clientName}</title>
<style>
*{box-sizing:border-box;margin:0;padding:0}
html,body{width:1122px;height:794px;overflow:hidden}
body{background:#0B0F1E;color:#E8ECF8;font-family:system-ui,'Segoe UI',Arial,sans-serif;padding:16px 22px 12px;display:flex;flex-direction:column;gap:0}
.sep{height:1px;background:linear-gradient(90deg,#C39847,rgba(195,152,71,0.3),transparent);margin:5px 0}
.kpi-row{display:flex;gap:7px}
.kpi{flex:1;background:rgba(255,255,255,0.04);border:1px solid rgba(255,255,255,0.08);border-radius:6px;padding:8px 11px;display:flex;flex-direction:column;gap:3px;min-width:0}
.kpi-label{font-size:7pt;color:#9FA8C7;text-transform:uppercase;letter-spacing:.04em;font-weight:500}
.kpi-value{font-size:12pt;font-weight:500;color:#E8ECF8;line-height:1.1}
.kpi-value.hero{font-size:14pt;font-weight:700;color:#C39847}
.kpi-sub{font-size:8pt;color:#9FA8C7;line-height:1.3}
.kpi-tech{font-size:7pt;color:#9FA8C7;opacity:.8}
.charts{display:flex;gap:7px}
.chart-box{background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.06);border-radius:6px;padding:7px 9px 3px;overflow:hidden;display:flex;flex-direction:column}
.chart-title{font-size:7.5pt;color:#9FA8C7;font-weight:500;margin-bottom:3px;letter-spacing:.03em;text-transform:uppercase}
.legend{display:flex;gap:10px;justify-content:center;padding:3px 0;flex-wrap:wrap}
.leg-item{display:flex;align-items:center;gap:4px;font-size:7pt;color:#9FA8C7}
.leg-swatch{width:10px;height:7px;border-radius:2px;display:inline-block}
.footer{display:flex;justify-content:space-between;font-size:7pt;color:#9FA8C7;opacity:.55;padding-top:5px;border-top:1px solid rgba(255,255,255,0.06)}
</style>
</head>
<body>

<!-- HEADER -->
<div style="display:flex;align-items:flex-end;justify-content:space-between;padding-bottom:7px;border-bottom:1px solid rgba(255,255,255,0.08);margin-bottom:5px">
  <div style="display:flex;align-items:center;gap:14px">
    ${logoHtml}
    <div>
      <div style="font-size:10pt;color:#C39847;font-weight:700;letter-spacing:.06em;text-transform:uppercase">Analyse d'ombrage</div>
      <div style="font-size:8pt;color:#9FA8C7;margin-top:1px">Production théorique · Pertes · Impact énergétique</div>
    </div>
  </div>
  <div style="text-align:right;font-size:8pt;color:#9FA8C7;line-height:1.5">
    <div><b style="color:#E8ECF8">Client</b> : ${clientName}</div>
    <div><b style="color:#E8ECF8">Site</b> : ${address || "—"}</div>
    <div><b style="color:#E8ECF8">Date</b> : ${date}</div>
  </div>
</div>
<div class="sep"></div>

<!-- KPI STRIP -->
<div class="kpi-row" style="margin-bottom:5px">
  <div class="kpi">
    <div class="kpi-label">Production théorique</div>
    <div class="kpi-value">${prodNoShading != null ? prodNoShading.toLocaleString("fr-FR") + " kWh" : "—"}</div>
    <div class="kpi-sub">Sans ombrage · PVGIS réf.</div>
  </div>
  <div class="kpi" style="border-color:rgba(195,152,71,0.3)">
    <div class="kpi-label">Production réelle</div>
    <div class="kpi-value hero">${prodWithShading != null ? prodWithShading.toLocaleString("fr-FR") + " kWh" : "—"}</div>
    <div class="kpi-sub">Après pertes d'ombrage</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Énergie perdue / an</div>
    <div class="kpi-value" style="color:${lossColor(combinedPct)}">${annualLossKwh != null ? Math.round(annualLossKwh).toLocaleString("fr-FR") + " kWh" : "—"}</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Perte d'ombrage</div>
    <div class="kpi-value" style="color:${lossColor(combinedPct)}">${fmtPct(combinedPct)}</div>
    <div class="kpi-tech">Horizon : ${fmtPct(farPct)}</div>
    <div class="kpi-tech">Masques : ${fmtPct(nearPct)}</div>
  </div>
  <div class="kpi">
    <div class="kpi-label">Qualité données</div>
    <div class="kpi-value" style="font-size:12pt;font-weight:600;color:${badgeColor}">● ${badgeText}</div>
    <div class="kpi-sub">${farHorizonKind === "REAL_TERRAIN" ? "GeoTIFF terrain réel" : farHorizonKind === "SYNTHETIC" ? "Modèle synthétique" : "Données insuffisantes"}</div>
  </div>
</div>
<div class="sep"></div>

<!-- CHARTS -->
<div class="charts" style="height:218px;margin-bottom:5px">
  <div class="chart-box" style="flex:0 0 58%">
    <div class="chart-title">Pertes mensuelles (%)</div>
    <svg id="bars" viewBox="0 0 520 178" style="width:100%;flex:1"></svg>
    <div class="legend">
      <div class="leg-item"><span class="leg-swatch" style="background:#C39847;opacity:.9"></span>Horizon lointain (far)</div>
      <div class="leg-item"><span class="leg-swatch" style="background:#4A90E2;opacity:.9"></span>Masques proches (near)</div>
      <div class="leg-item"><span style="width:16px;height:1.5px;background:#E8ECF8;opacity:.55;display:inline-block;vertical-align:middle"></span>Total combiné</div>
    </div>
  </div>
  <div class="chart-box" style="flex:1">
    <div class="chart-title">Profil horizon</div>
    <svg id="horiz" viewBox="0 0 252 172" style="width:100%;flex:1"></svg>
    <div class="legend">
      <div class="leg-item">
        <span style="width:12px;height:7px;background:linear-gradient(to bottom,rgba(195,152,71,0.4),rgba(195,152,71,0.08));border:1px solid #D4AC5A;border-radius:2px;display:inline-block"></span>
        Horizon terrain / bâti
      </div>
    </div>
  </div>
</div>
<div class="sep"></div>

<!-- TABLEAU kWh -->
<div style="flex:1">${tableSection}</div>

<!-- FOOTER -->
<div class="footer">
  <span>${orgName} · Étude photovoltaïque</span>
  <span>${lat != null && lon != null ? `GPS : ${lat.toFixed(4)}, ${lon.toFixed(4)}` : ""}</span>
</div>

<script>
(function(){
  const ns="http://www.w3.org/2000/svg";
  function el(tag,attrs){const e=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs||{}))e.setAttribute(k,v);return e;}

  // ── BARRES MENSUELLES ────────────────────────────────────────────────────
  const F=${factorsJson};
  const MONTHS=["Jan","Fév","Mar","Avr","Mai","Jui","Jul","Aoû","Sep","Oct","Nov","Déc"];
  const sv=document.getElementById("bars");
  if(F&&F.length===12){
    const VW=520,VH=178,PL=30,PR=8,PT=10,PB=18,CW=VW-PL-PR,CH=VH-PT-PB;
    const mxP=Math.max(20,Math.ceil(Math.max(...F.map(d=>d.c))/5)*5);
    const N=12,sW=CW/N,bW=sW*0.66;
    const xB=i=>PL+i*sW+sW*0.17;
    const yP=p=>PT+CH-(p/mxP)*CH;
    const hP=p=>(p/mxP)*CH;
    const defs=el("defs");
    defs.innerHTML="<linearGradient id='gf' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#D4AC5A'/><stop offset='100%' stop-color='#A07020'/></linearGradient><linearGradient id='gn' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#5FA8F5'/><stop offset='100%' stop-color='#2D6FC8'/></linearGradient>";
    sv.appendChild(defs);
    [0,mxP/2,mxP].forEach((v,ti)=>{
      const y=yP(v);
      const l=el("line",{x1:PL,x2:VW-PR,y1:y,y2:y,stroke:ti===0?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.07)","stroke-width":0.7});
      if(ti>0)l.setAttribute("stroke-dasharray","3,3");sv.appendChild(l);
      const t=el("text",{x:PL-3,y:y+3.5,"text-anchor":"end",fill:"#9FA8C7","font-size":7});t.textContent=v+"%";sv.appendChild(t);
    });
    const lPts=[];
    F.forEach((d,i)=>{
      const xi=xB(i),hF=hP(d.f),hN=hP(d.n),yF=yP(d.f),yN=yF-hN;
      if(hF>0.5){const r=el("rect",{x:xi,y:yF,width:bW,height:hF,fill:"url(#gf)",opacity:0.9,rx:1.5});sv.appendChild(r);}
      if(hN>0.5){const r=el("rect",{x:xi,y:yN,width:bW,height:hN,fill:"url(#gn)",opacity:0.9,rx:1.5});sv.appendChild(r);}
      if(d.c>=mxP*0.1){const t=el("text",{x:xi+bW/2,y:yP(d.c)-2.5,"text-anchor":"middle",fill:"#E8ECF8","font-size":6.5,"font-weight":500,opacity:0.82});t.textContent=d.c.toFixed(1)+"%";sv.appendChild(t);}
      lPts.push({x:xi+bW/2,y:yP(d.c)});
      const t=el("text",{x:xi+bW/2,y:VH-4,"text-anchor":"middle",fill:"#9FA8C7","font-size":7.5});t.textContent=MONTHS[i];sv.appendChild(t);
    });
    const path=el("path",{d:lPts.map((p,i)=>(i?"L":"M")+p.x.toFixed(1)+","+p.y.toFixed(1)).join(" "),fill:"none",stroke:"#E8ECF8","stroke-width":1.2,"stroke-dasharray":"4,3","stroke-linecap":"round",opacity:0.55});sv.appendChild(path);
    lPts.forEach(p=>sv.appendChild(el("circle",{cx:p.x,cy:p.y,r:1.7,fill:"#E8ECF8",opacity:0.6})));
  } else {
    const t=el("text",{x:260,y:89,"text-anchor":"middle",fill:"#9FA8C7","font-size":9,opacity:0.6});t.textContent="Données non disponibles — Recalculer l'étude";sv.appendChild(t);
  }

  // ── PROFIL HORIZON ───────────────────────────────────────────────────────
  const MASK=${maskJson};
  const hsvg=document.getElementById("horiz");
  if(MASK&&MASK.length>=2){
    const hW=252,hH=172,hPL=22,hPR=5,hPT=8,hPB=20,hCW=hW-hPL-hPR,hCH=hH-hPT-hPB;
    const rawMx=Math.max(...MASK.filter(v=>isFinite(v)));
    const maxEl=Math.max(15,Math.ceil((rawMx+2)/5)*5);
    const hdefs=el("defs");hdefs.innerHTML="<linearGradient id='gh' x1='0' y1='0' x2='0' y2='1'><stop offset='0%' stop-color='#C39847' stop-opacity='0.32'/><stop offset='100%' stop-color='#C39847' stop-opacity='0.05'/></linearGradient>";hsvg.appendChild(hdefs);
    const xAz=az=>hPL+(az/360)*hCW;
    const yEl=e=>hPT+hCH-Math.max(0,e/maxEl)*hCH;
    const hStep=maxEl<=20?5:10;
    for(let v=0;v<=maxEl;v+=hStep){
      const yv=yEl(v);
      const li=el("line",{x1:hPL,x2:hW-hPR,y1:yv,y2:yv,stroke:v===0?"rgba(255,255,255,0.15)":"rgba(255,255,255,0.07)","stroke-width":v===0?0.9:0.6});if(v>0)li.setAttribute("stroke-dasharray","3,3");hsvg.appendChild(li);
      const t=el("text",{x:hPL-2,y:yv+2.5,"text-anchor":"end",fill:"#9FA8C7","font-size":6});t.textContent=v+"°";hsvg.appendChild(t);
    }
    [{a:0,l:"N"},{a:90,l:"E"},{a:180,l:"S"},{a:270,l:"O"}].forEach(({a,l})=>{
      const xv=xAz(a);
      const li=el("line",{x1:xv,x2:xv,y1:hPT,y2:hPT+hCH,stroke:"rgba(255,255,255,0.18)","stroke-width":0.6,"stroke-dasharray":"2,3"});hsvg.appendChild(li);
      const t=el("text",{x:xv,y:hPT+hCH+12,"text-anchor":"middle",fill:"#9FA8C7","font-size":8,"font-weight":600});t.textContent=l;hsvg.appendChild(t);
    });
    const n2=MASK.length,pts=[];
    for(let i=0;i<=180;i++){
      const az=i*2,idx=(i/180)*(n2-1),lo=Math.floor(idx),hi=Math.min(lo+1,n2-1),t=idx-lo;
      pts.push({x:xAz(az),y:yEl(Math.max(0,(MASK[lo]||0)*(1-t)+(MASK[hi]||0)*t))});
    }
    const base=hPT+hCH;
    const lp2=pts.map((p,i)=>(i?"L":"M")+p.x.toFixed(1)+","+p.y.toFixed(1)).join(" ");
    hsvg.appendChild(el("path",{d:lp2+" L"+pts[180].x.toFixed(1)+","+base+" L"+pts[0].x.toFixed(1)+","+base+" Z",fill:"url(#gh)"}));
    hsvg.appendChild(el("path",{d:lp2,fill:"none",stroke:"#D4AC5A","stroke-width":1.4,"stroke-linecap":"round","stroke-linejoin":"round"}));
    [45,135,225,315].forEach(az=>{const t=el("text",{x:xAz(az),y:hPT+hCH+12,"text-anchor":"middle",fill:"#9FA8C7","font-size":5.5,opacity:0.55});t.textContent=az+"°";hsvg.appendChild(t);});
  } else {
    const t=el("text",{x:126,y:86,"text-anchor":"middle",fill:"#9FA8C7","font-size":8,opacity:0.55});t.textContent="Profil horizon non disponible";hsvg.appendChild(t);
  }
})();
</script>
</body>
</html>`;
}
