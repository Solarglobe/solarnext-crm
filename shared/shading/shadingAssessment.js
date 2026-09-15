/** Shared display contract: absence, stale data and failures are never a zero loss. */
const STATUSES = new Set(["computed", "not_calculated", "insufficient_data", "error", "stale"]);
const LABELS = {
  computed: "Calculé",
  not_calculated: "Non calculé",
  insufficient_data: "Non évalué — données insuffisantes",
  error: "Erreur de calcul",
  stale: "Résultat périmé — recalcul requis",
};

export function validShadingLossPct(value) {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}

export function getShadingStatusLabel(status) {
  return LABELS[status] || LABELS.not_calculated;
}

export function getShadingAssessment(shading) {
  if (!shading || typeof shading !== "object") {
    return { status: "not_calculated", nearStatus: "not_calculated", farStatus: "not_calculated", reasons: [] };
  }
  const assessment = shading.assessment || {};
  const pick = (...values) => values.find((value) => STATUSES.has(value));
  let status = pick(assessment.status, shading.combined?.status, shading.status) || "stale";
  let nearStatus = pick(assessment.nearStatus, shading.near?.status) || "stale";
  let farStatus = pick(assessment.farStatus, shading.far?.status) || "stale";
  if (shading.shadingQuality?.blockingReason === "missing_gps" || shading.far?.source === "UNAVAILABLE_NO_GPS") {
    status = "insufficient_data";
    farStatus = "insufficient_data";
  }
  if (shading.far?.source === 'FAR_UNAVAILABLE_ERROR' || shading.shadingQuality?.farShadingUnavailable === true) {
    status = 'error'; farStatus = 'error';
  }
  if (status === "error" || status === "stale") nearStatus = farStatus = status;
  if (nearStatus === "computed" && validShadingLossPct(shading.near?.totalLossPct) === null) nearStatus = "error";
  if (farStatus === "computed" && validShadingLossPct(shading.far?.totalLossPct) === null) farStatus = "error";
  if (status === "computed") {
    if (nearStatus !== "computed" || farStatus !== "computed") {
      status = [nearStatus, farStatus].includes("error") ? "error"
        : [nearStatus, farStatus].includes("stale") ? "stale" : "insufficient_data";
    } else if (validShadingLossPct(shading.combined?.totalLossPct) === null) status = "error";
  }
  return { ...assessment, status, nearStatus, farStatus, reasons: Array.isArray(assessment.reasons) ? assessment.reasons : [] };
}

export function getShadingComponentLossPct(shading, component = "combined") {
  const assessment = getShadingAssessment(shading);
  const status = component === "combined" ? assessment.status : assessment[`${component}Status`];
  return status === "computed" ? validShadingLossPct(shading?.[component]?.totalLossPct) : null;
}

export function formatShadingLossPct(value, status = "computed") {
  if (status !== "computed") return getShadingStatusLabel(status);
  const pct = validShadingLossPct(value);
  if (pct === null) return getShadingStatusLabel("insufficient_data");
  if (pct > 0 && pct < 0.1) return "< 0,1 %";
  return `${pct.toFixed(1).replace(".", ",")} %`;
}

/** Annual distributions must come from the same energy balance as the global KPI. */
export function getEnergyTemporalProfile(shading) {
  const total = getShadingComponentLossPct(shading);
  const d = shading?.distribution;
  if (!(total > 0) || !d || !Array.isArray(d.monthly) || d.monthly.length !== 12) return null;
  const periods = ['morning', 'midday', 'afternoon'];
  const validShares = a => a.every(v => typeof v === 'number' && Number.isFinite(v) && v >= 0 && v <= 100) && Math.abs(a.reduce((x,y) => x+y,0)-100) < 0.01;
  if (!validShares(d.monthly) || !validShares(periods.map(k => d.periods?.[k]))) return null;
  return {
    dayParts: periods.map((key,i) => ({ key, label: ['Matin', 'Midi', 'Après-midi'][i], value: d.periods[key] })),
    seasons: [
      {key:'winter',label:'Hiver',value:d.monthly[11]+d.monthly[0]+d.monthly[1]},
      {key:'spring',label:'Printemps',value:d.monthly[2]+d.monthly[3]+d.monthly[4]},
      {key:'summer',label:'Été',value:d.monthly[5]+d.monthly[6]+d.monthly[7]},
      {key:'autumn',label:'Automne',value:d.monthly[8]+d.monthly[9]+d.monthly[10]},
    ],
  };
}
