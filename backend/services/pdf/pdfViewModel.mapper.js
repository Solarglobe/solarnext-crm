/**
 * PDF V2 — Mapper snapshot → ViewModel rendu PDF
 * Entrée unique du moteur PDF V2. Pur : pas d'API, pas de DB, pas de mutation du snapshot.
 * Toutes les valeurs sont normalisées (null | 0 | "" | valeur typée), jamais undefined.
 */

import { resolveShadingTotalLossPct } from "../shading/resolveShadingTotalLossPct.js";
import {
  mergeOrgEconomicsPartial,
  overlayFormEconomics,
  DEFAULT_ECONOMICS_FALLBACK,
  resolveOaRateForKwc,
} from "../economicsResolve.service.js";
import {
  IMPACT_FACTOR_CO2_AUTO_KG_PER_KWH,
  IMPACT_FACTOR_CO2_SURPLUS_KG_PER_KWH,
  IMPACT_TREE_CO2_KG_PER_YEAR,
  IMPACT_CAR_CO2_KG_PER_KM,
} from "../core/engineConstants.js";
import { buildP5DailyProfiles } from "./pdfP5DailyProfile.js";

const SCENARIO_LABELS = {
  BASE: "Sans batterie",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
};

const MONTHS_COUNT = 12;

/**
 * Même priorité que financeService.pickEconomics pour l’affichage PDF (sans importer le moteur finance).
 */
function mirrorPickEconomicsForPdf(form, orgEconomics) {
  const f = form && typeof form === "object" ? form : {};
  const e = overlayFormEconomics(mergeOrgEconomicsPartial(orgEconomics ?? null), f.economics);
  const n = (v, fb) => {
    const x = Number(v);
    return Number.isFinite(x) ? x : fb;
  };
  return {
    price_eur_kwh: n(
      f.params?.tarif_kwh ?? f.params?.tarif_actuel ?? e.price_eur_kwh,
      DEFAULT_ECONOMICS_FALLBACK.price_eur_kwh
    ),
    elec_growth_pct: n(e.elec_growth_pct, DEFAULT_ECONOMICS_FALLBACK.elec_growth_pct),
    pv_degradation_pct: n(
      f.panel_input?.degradation_annual_pct ?? f.params?.degradation ?? e.pv_degradation_pct,
      DEFAULT_ECONOMICS_FALLBACK.pv_degradation_pct
    ),
    horizon_years: n(e.horizon_years, DEFAULT_ECONOMICS_FALLBACK.horizon_years),
    prime_lt9: n(e.prime_lt9, DEFAULT_ECONOMICS_FALLBACK.prime_lt9),
    prime_gte9: n(e.prime_gte9, DEFAULT_ECONOMICS_FALLBACK.prime_gte9),
  };
}

/** Répartition uniforme sur 12 mois (somme = total), sans courbe artificielle. */
function uniformMonthly12FromTotal(totalKwh) {
  const t = num(totalKwh);
  if (t == null || !Number.isFinite(t) || t <= 0) return Array(12).fill(0);
  const base = t / 12;
  const out = Array.from({ length: 12 }, () => base);
  const sum = out.reduce((a, b) => a + b, 0);
  out[11] += t - sum;
  return out.map((x) => Math.round(x));
}

/** Puissance moyenne (kW) par heure sur l’année : total kWh / 8760 — cohérent avec les agrégats moteur. */
function flatAverageKw24FromAnnualKwh(annualKwh) {
  const a = num(annualKwh);
  if (a == null || !Number.isFinite(a) || a <= 0) return Array(24).fill(0);
  const perHour = a / 8760;
  return Array.from({ length: 24 }, () => perHour);
}

function num(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return null;
  return Number(v);
}

function numOrZero(v) {
  const n = num(v);
  return n != null ? n : 0;
}

/**
 * Prime à l'autoconsommation (PDF P2) — même règle que financeService :
 * priorité au montant d'année 1 dans les flux du scénario si présent, sinon
 * kwc × prime_lt9 (moins de 9 kWc) ou × prime_gte9 (9 kWc et plus) depuis org + form.economics.
 */
function resolvePdfPrimeAutoconsoEur({ systemPowerKw, scenarioForFinance, snapshot, options }) {
  const flows =
    scenarioForFinance?.finance?.annual_cashflows ??
    (Array.isArray(scenarioForFinance?.cashflows) ? scenarioForFinance.cashflows : null);
  if (Array.isArray(flows) && flows.length > 0) {
    const y1 = flows.find((f) => num(f?.year) === 1) ?? flows[0];
    const p = num(y1?.prime);
    if (p != null && Number.isFinite(p) && p >= 0) return p;
  }
  const formEco =
    snapshot?.form && typeof snapshot.form === "object" && snapshot.form.economics != null
      ? snapshot.form.economics
      : null;
  const econ = overlayFormEconomics(mergeOrgEconomicsPartial(options?.org_economics ?? null), formEco);
  const kwc = Number(systemPowerKw);
  if (!Number.isFinite(kwc) || kwc <= 0) return 0;
  return kwc < 9 ? kwc * econ.prime_lt9 : kwc * econ.prime_gte9;
}

/**
 * P8 — kWh achetés au réseau (annuel) pour affichage comparatif.
 * - BASE & BATTERY_PHYSICAL : somme des imports mensuels `energy.monthly[].import|import_kwh`
 *   quand 12 mois sont disponibles (cohérent avec l’agrégat scénario) ; sinon fallback
 *   `import_kwh` → `import` → `grid_import_kwh`.
 * - BATTERY_VIRTUAL : priorité `billable_import_kwh` (import facturable / crédit), puis même logique
 *   que ci-dessus — ne pas confondre avec un champ d’un autre scénario.
 */
function sumMonthlyGridImportKwh(energy) {
  const m = energy?.monthly;
  if (!Array.isArray(m) || m.length < MONTHS_COUNT) return null;
  let sum = 0;
  for (let i = 0; i < MONTHS_COUNT; i++) {
    const row = m[i];
    sum += numOrZero(num(row?.import_kwh ?? row?.import));
  }
  return sum;
}

function p8AnnualGridImportKwh(energy, batteryTypeForColumnB) {
  const e = energy || {};
  if (batteryTypeForColumnB === "VIRTUAL") {
    const bill = num(e.billable_import_kwh);
    if (bill != null && Number.isFinite(bill)) return bill;
  }
  const monthSum = sumMonthlyGridImportKwh(e);
  if (monthSum != null && Number.isFinite(monthSum) && monthSum >= 0) return monthSum;
  return numOrZero(num(e.import_kwh) ?? num(e.import) ?? num(e.grid_import_kwh));
}

/**
 * Position nette € en fin de flux (25 ans) — finance.annual_cashflows[].cumul_eur
 * (amortissement : -capex_ttc + gains cumulés ; peut être négatif).
 */
function cumulEurEndFromScenario(sc) {
  if (!sc || typeof sc !== "object") return null;
  const flows = sc.finance?.annual_cashflows ?? sc.cashflows ?? [];
  if (!Array.isArray(flows) || flows.length === 0) return null;
  const last = flows[flows.length - 1];
  let v = num(last?.cumul_eur ?? last?.cumul);
  if (v != null && Number.isFinite(v)) return v;
  const y25 = flows.find((f) => num(f?.year) === 25);
  if (y25) {
    v = num(y25.cumul_eur ?? y25.cumul);
    if (v != null && Number.isFinite(v)) return v;
  }
  return null;
}

function str(v) {
  if (v == null) return "";
  return String(v).trim();
}

/** P1 — formatage unifié */
function formatKwC(v) {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return `${Number(v).toFixed(2).replace(".", ",")} kWc`;
}
function roundPercent(v) {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return `${Math.round(Number(v))} %`;
}
function oneDecimalPercent(v) {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return `${Number(v).toFixed(1).replace(".", ",")} %`;
}
function formatCurrency0(v) {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return `${Math.round(Number(v)).toLocaleString("fr-FR")} €`;
}
function formatNumber0(v) {
  if (v == null || !Number.isFinite(Number(v))) return "";
  return `${Math.round(Number(v)).toLocaleString("fr-FR")}`;
}

function formatDateFr(val) {
  if (!val) return "";
  const d = new Date(val);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleDateString("fr-FR", { day: "numeric", month: "long", year: "numeric" });
}

/**
 * Aligné sur le mergeFinancing du quote builder (StudyQuoteBuilder) :
 * montant par défaut = total TTC devis si durée + taux > 0 et montant absent.
 */
function normalizeQuoteFinancing(configJson, capexTtc) {
  const totalsTtc = num(configJson?.totals?.ttc);
  const fallbackCapex = numOrZero(capexTtc);
  const ttc = totalsTtc != null && totalsTtc > 0 ? totalsTtc : fallbackCapex;
  const raw = configJson && typeof configJson === "object" && configJson.financing ? configJson.financing : {};
  const duration = Math.max(0, numOrZero(raw.duration_months));
  const rateRaw = num(raw.interest_rate_annual);
  const rate = rateRaw != null && Number.isFinite(rateRaw) ? rateRaw : 0;
  const enabled = duration > 0 && rate > 0;
  let amount = num(raw.amount);
  if (amount == null || !Number.isFinite(amount) || amount < 0) amount = 0;
  if (enabled && amount <= 0 && ttc > 0) amount = ttc;
  return { enabled, amount, duration_months: duration, interest_rate_annual: rate };
}

/** Mensualité constante — amortissement à taux fixe (même formule que standards prêt). */
function loanMonthlyPaymentEur(principalEur, annualRatePct, months) {
  if (principalEur <= 0 || months <= 0 || annualRatePct <= 0) return null;
  const r = annualRatePct / 100 / 12;
  const n = months;
  const pay = (principalEur * (r * Math.pow(1 + r, n))) / (Math.pow(1 + r, n) - 1);
  return Number.isFinite(pay) ? pay : null;
}

function annualLoanPaymentForCalendarYear(year1Based, monthlyPayment, durationMonths) {
  if (monthlyPayment == null || monthlyPayment <= 0 || durationMonths <= 0) return 0;
  const startMonth = (year1Based - 1) * 12;
  if (startMonth >= durationMonths) return 0;
  const monthsThisYear = Math.min(12, durationMonths - startMonth);
  return monthsThisYear * monthlyPayment;
}

function formatEur0(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Math.round(Number(v)).toLocaleString("fr-FR")} €`;
}

function formatPctOneDec(v) {
  if (v == null || !Number.isFinite(Number(v))) return "—";
  return `${Number(v).toFixed(1).replace(".", ",")} %`;
}

/**
 * Série des gains € / an sur 25 ans depuis finance.annual_cashflows (moteur — total_eur par année,
 * inflation prix élec et dégradation PV déjà intégrées dans les flux).
 * Retourne null si aucun flux exploitable.
 *
 * Comportement métier attendu : une baisse sur une année donnée (souvent l’année 15 par défaut) peut
 * correspondre au coût de remplacement onduleur déduit dans buildCashflows (financeService.js :
 * inverter_replacement_year / inverter_cost_pct), pas à un défaut de mapping.
 */
function annualGainsEur25FromCashflows(flows) {
  if (!Array.isArray(flows) || flows.length === 0) return null;
  const out = [];
  let any = false;
  for (let i = 0; i < 25; i++) {
    const year = i + 1;
    const row = flows.find((f) => num(f?.year) === year) ?? flows[i];
    let v = null;
    if (row && typeof row === "object") {
      v = num(row.total_eur);
      if (v == null) {
        const ga = num(row.gain_auto);
        const go = num(row.gain_oa);
        const im = num(row.import_savings_eur);
        if (ga != null || go != null || im != null) v = (ga ?? 0) + (go ?? 0) + (im ?? 0);
      }
    }
    if (v != null && Number.isFinite(v)) {
      any = true;
      out.push(Math.max(0, Math.round(v)));
    } else {
      out.push(0);
    }
  }
  return any ? out : null;
}

/**
 * Construit fullReport.p11 + objet financing racine (viewModel) depuis snapshot + config économique.
 */
function buildP11Section({
  clientName,
  ref,
  dateDisplay,
  capex,
  systemPowerKw,
  batteryKwh,
  annualSavings,
  financeActive,
  financeSnapshot,
  economieTotal,
  economicConfigJson,
  annualCashflows,
}) {
  const fin = normalizeQuoteFinancing(economicConfigJson, capex);
  const monthly = fin.enabled ? loanMonthlyPaymentEur(fin.amount, fin.interest_rate_annual, fin.duration_months) : null;
  const totalPaid =
    monthly != null && fin.duration_months > 0 ? Math.round(monthly * fin.duration_months) : null;

  const fromFlows = annualGainsEur25FromCashflows(annualCashflows);
  const economies25 =
    fromFlows != null ? fromFlows : Array.from({ length: 25 }, () => numOrZero(annualSavings));

  const paiement25 = Array.from({ length: 25 }, (_, i) =>
    annualLoanPaymentForCalendarYear(i + 1, monthly, fin.duration_months)
  );
  const reste25 = economies25.map((eco, i) => paiement25[i] - eco);

  const modeLabel = fin.enabled ? "Financement" : "Comptant";
  const montantDisplay = fin.enabled ? formatEur0(fin.amount) : formatEur0(capex);
  const dureeDisplay =
    fin.duration_months > 0 ? `${fin.duration_months} mois` : "—";
  const taegDisplay = fin.enabled ? formatPctOneDec(fin.interest_rate_annual) : "—";
  const assuranceDisplay = "—";
  const apportVal =
    fin.enabled && fin.amount > 0 && capex > fin.amount ? Math.round(capex - fin.amount) : null;
  const apportDisplay = apportVal != null && apportVal > 0 ? formatEur0(apportVal) : "—";

  const avgAnnualEco =
    economies25.length === 25 ? economies25.reduce((a, b) => a + numOrZero(b), 0) / 25 : numOrZero(annualSavings);
  const resteMoyenMois =
    monthly != null ? Math.round(monthly - avgAnnualEco / 12) : null;

  const factureRestante = num(
    financeActive.facture_restante ?? financeActive.residual_bill_eur ?? financeSnapshot?.facture_restante
  );
  const resteChargeMoyenPost =
    factureRestante != null && Number.isFinite(factureRestante) ? Math.round(factureRestante / 12) : null;

  const p11 = {
    meta: { client: clientName, ref, date: dateDisplay },
    data: {
      capex_ttc: capex,
      kwc: systemPowerKw,
      battery_kwh: batteryKwh,
      economies_annuelles_25: economies25,
      financing: {
        mode_label: modeLabel,
        montant_finance_display: montantDisplay,
        duree_display: dureeDisplay,
        taeg_display: taegDisplay,
        assurance_display: assuranceDisplay,
        apport_display: apportDisplay,
        monthly_payment_eur: monthly != null ? Math.round(monthly * 100) / 100 : null,
        annual_payment_eur: monthly != null ? Math.round(monthly * 12 * 100) / 100 : null,
        total_paid_eur: totalPaid,
        duration_months: fin.duration_months,
        enabled: fin.enabled,
      },
      series: {
        economies_annuelles: economies25,
        paiement_annuel: paiement25,
        reste_a_charge_annuel: reste25,
      },
      kpi: {
        mensualite_eur: monthly != null ? Math.round(monthly * 100) / 100 : null,
        total_paid_eur: totalPaid,
        roi_years: (() => {
          const ry = num(financeActive.roi_years);
          return ry != null && ry > 0 ? ry : null;
        })(),
        reste_moyen_mois_eur: resteMoyenMois,
      },
      post_loan: {
        economies_net_25_eur: num(economieTotal) != null ? num(economieTotal) : null,
        mensualite_liberee_eur: monthly != null ? Math.round(monthly * 100) / 100 : null,
        reste_charge_moyen_mois_eur: resteChargeMoyenPost,
      },
      durations_summary: fin.duration_months > 0 ? `${fin.duration_months} mois` : null,
    },
  };

  const financingVm = {
    loanUsed: Boolean(fin.enabled && monthly != null),
    loanDurationYears: fin.duration_months > 0 ? Math.round((fin.duration_months / 12) * 10) / 10 : 0,
    monthlyPayment: monthly != null ? Math.round(monthly * 100) / 100 : 0,
    interestRate: fin.interest_rate_annual || 0,
  };

  return { p11, financingVm };
}

/** Garantit un tableau de 12 nombres (mois). */
function normalizeMonthlyProduction(monthly) {
  const arr = Array.isArray(monthly) ? monthly.slice(0, MONTHS_COUNT) : [];
  const result = [];
  for (let i = 0; i < MONTHS_COUNT; i++) {
    result.push(numOrZero(arr[i]));
  }
  return result;
}

/** Moyenne par heure (0–23) sur une série typiquement 8760h. */
function hourly8760ToAvg24(hourly) {
  if (!Array.isArray(hourly) || hourly.length < 24) return Array(24).fill(0);
  const len = hourly.length;
  return Array.from({ length: 24 }, (_, h) => {
    let sum = 0;
    let n = 0;
    for (let i = h; i < len; i += 24) {
      const v = Number(hourly[i]);
      if (Number.isFinite(v)) {
        sum += v;
        n++;
      }
    }
    return n > 0 ? sum / n : 0;
  });
}

/**
 * Transforme selected_scenario_snapshot en ViewModel destiné au rendu PDF V2.
 * @param {object} snapshot - Objet snapshot (study_versions.selected_scenario_snapshot)
 * @param {{ studyId?: string, versionId?: string }} [options] - Optionnel : ids à injecter dans meta
 * @returns {object} ViewModel stable, sans undefined
 */
export function mapSelectedScenarioSnapshotToPdfViewModel(snapshot, options = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return buildEmptyViewModel(options);
  }

  const meta = snapshot.meta || {};
  const client = snapshot.client || {};
  const site = snapshot.site || {};
  const installation = snapshot.installation || {};
  const equipment = snapshot.equipment || {};
  const hardware = snapshot.hardware || {};
  const form = snapshot.form || {};
  const formParams = form.params || {};
  const conso = snapshot.conso || {};
  const shading = snapshot.shading || {};
  const energy = snapshot.energy || {};
  const finance = snapshot.finance || {};
  const production = snapshot.production || {};

  const panneau = equipment.panneau && typeof equipment.panneau === "object" ? equipment.panneau : {};
  const onduleur = equipment.onduleur && typeof equipment.onduleur === "object" ? equipment.onduleur : {};

  const systemPowerKw = num(hardware.kwc) ?? num(installation.puissance_kwc) ?? 0;
  const annualKwh = num(production.annual_kwh) ?? num(installation.production_annuelle_kwh) ?? 0;
  let monthly = normalizeMonthlyProduction(production.monthly_kwh);
  const monthlyProdSum = monthly.reduce((a, b) => a + numOrZero(b), 0);
  if (monthlyProdSum < 0.01 && annualKwh > 0.01) {
    monthly = uniformMonthly12FromTotal(annualKwh);
  }
  const specificYield = systemPowerKw > 0 && annualKwh > 0 ? annualKwh / systemPowerKw : 0;

  const pdfEconomicsCtx = {
    settings: { economics: mergeOrgEconomicsPartial(options.org_economics ?? null) },
    form,
  };
  const econDisplay = mirrorPickEconomicsForPdf(form, options.org_economics);

  const scenariosArr = options.scenarios_v2 ?? [];
  const selectedKey = options.selected_scenario_id ?? snapshot.scenario_type ?? "BASE";
  const scenariosByKey = Object.fromEntries(
    (Array.isArray(scenariosArr) ? scenariosArr : []).map((s) => [s.id ?? s.name ?? "BASE", s])
  );
  const baseFromV2 = scenariosByKey.BASE || null;
  const batteryPhysicalGlobal = scenariosByKey.BATTERY_PHYSICAL || null;
  const batteryVirtualGlobal = scenariosByKey.BATTERY_VIRTUAL || null;
  const selectedScenario = scenariosByKey[selectedKey] ?? null;

  let pdfBatteryScenario = null;
  let pdfBatteryType = null;
  if (selectedKey === "BATTERY_VIRTUAL" && batteryVirtualGlobal) {
    pdfBatteryScenario = batteryVirtualGlobal;
    pdfBatteryType = "VIRTUAL";
  } else if (selectedKey === "BATTERY_PHYSICAL" && batteryPhysicalGlobal) {
    pdfBatteryScenario = batteryPhysicalGlobal;
    pdfBatteryType = "PHYSICAL";
  } else if (selectedKey === "BASE") {
    pdfBatteryScenario = null;
    pdfBatteryType = null;
  } else if (batteryVirtualGlobal) {
    pdfBatteryScenario = batteryVirtualGlobal;
    pdfBatteryType = "VIRTUAL";
  } else if (batteryPhysicalGlobal) {
    pdfBatteryScenario = batteryPhysicalGlobal;
    pdfBatteryType = "PHYSICAL";
  }

  const scenarioForFinance = selectedScenario ?? baseFromV2;
  const financeActive =
    scenarioForFinance && typeof scenarioForFinance.finance === "object" && scenarioForFinance.finance !== null
      ? scenarioForFinance.finance
      : finance;

  const clientName = str(meta.client_nom) || [str(client.prenom), str(client.nom)].filter(Boolean).join(" ") || "";
  const ref = options.studyNumber || "—";
  const dateDisplay = formatDateFr(snapshot.computed_at) || formatDateFr(snapshot.created_at) || "";
  const autonomyPct = num(energy.energy_independence_pct) ?? num(energy.independence_pct) ?? (energy.autoconsumption_kwh != null && energy.production_kwh != null && energy.production_kwh > 0
    ? Math.min(100, (num(energy.autoconsumption_kwh) / num(energy.production_kwh)) * 100) : null);
  const selfConsumptionPct = num(energy.autoconsumption_kwh) != null && num(energy.production_kwh) != null && num(energy.production_kwh) > 0
    ? Math.min(100, (num(energy.autoconsumption_kwh) / num(energy.production_kwh)) * 100) : null;

  const puissanceKva = num(formParams.puissance_kva) ?? num(site.puissance_compteur_kva);
  const reseauType = str(formParams.reseau_type) || str(site.type_reseau) || "";
  // Conso annuelle : fallback robuste (priorité 1→4), valeur numérique ou null
  const consoAnnuelle =
    num(conso.annual_kwh) ??
    num(energy.consumption_kwh) ??
    num(form.conso?.annuelle_kwh) ??
    num(meta.annual_consumption_kwh) ??
    null;
  const economieTotal = num(financeActive.economie_total) ?? numOrZero(financeActive.economie_year_1) * 25;
  const irrPct = num(financeActive.irr_pct);

  const p1_auto = {
    p1_client: clientName || "—",
    p1_ref: ref,
    p1_date: dateDisplay || "—",
    p1_why: "Étude photovoltaïque personnalisée",
    p1_m_kwc: formatKwC(systemPowerKw) || systemPowerKw,
    p1_m_auto: autonomyPct != null ? roundPercent(autonomyPct) : null,
    p1_m_gain: formatCurrency0(economieTotal) || formatCurrency0(numOrZero(financeActive.economie_year_1) * 25),
    p1_k_puissance: formatKwC(num(hardware.kwc) ?? systemPowerKw),
    p1_k_autonomie: roundPercent(num(energy.energy_independence_pct) ?? autonomyPct),
    p1_k_tri: oneDecimalPercent(irrPct),
    p1_k_gains: formatCurrency0(economieTotal),
    p1_param_kva: puissanceKva != null ? `${puissanceKva} kVA` : "",
    p1_param_reseau: reseauType === "mono" ? "Monophasé" : reseauType === "tri" ? "Triphasé" : reseauType || "—",
    p1_param_conso: consoAnnuelle,
  };

  const roiYears = Math.max(0, numOrZero(financeActive.roi_years));
  const capex = numOrZero(financeActive.capex_ttc);
  const factureRestante = numOrZero(financeActive.facture_restante ?? finance.facture_restante);

  // Comparatif financier : dépenses électricité sur 25 ans
  // economieTotal (issue du moteur) = position nette APRÈS remboursement du capex
  //   = (sans_solaire - avec_solaire) - capex
  // => sans_solaire = economieTotal + avec_solaire + capex  (reconstruction algébrique correcte)
  //
  // IMPORTANT — distinction entre deux grandeurs :
  //   • économie BRUTE  = sans_solaire - avec_solaire  → s'affiche dans la colonne "Économie cumulée"
  //                        garantit la cohérence : eco_Y = sans_Y - avec_Y pour chaque jalon
  //   • économie NETTE  = economieTotal (après capex)  → bénéfice réel de l'investissement
  //                        stockée dans p2_economie_nette pour usage séparé si besoin
  const gridCostWithSolar = Math.round(factureRestante * 25);
  const gridCostWithoutSolar = Math.round(economieTotal + gridCostWithSolar + capex);
  // Économie brute = différence pure de factures électricité (sans investissement)
  const economieGross = gridCostWithoutSolar - gridCostWithSolar;

  const primeAmount = resolvePdfPrimeAutoconsoEur({
    systemPowerKw,
    scenarioForFinance,
    snapshot,
    options
  });
  const resteACharge = Math.max(0, Math.round(capex - primeAmount));

  const lcoeVal = systemPowerKw > 0 && annualKwh > 0 ? capex / (annualKwh * 25) : null;

  const p2_auto = {
    p2_client: clientName,
    p2_ref: ref,
    p2_date: dateDisplay,
    p2_sans_solaire: formatCurrency0(gridCostWithoutSolar),
    p2_avec_solaire: formatCurrency0(gridCostWithSolar),
    // p2_economie_totale = économie BRUTE (sans_solaire - avec_solaire)
    // Garantit que eco_Y = sans_Y - avec_Y pour chaque jalon de l'engine-p2.js
    p2_economie_totale: formatCurrency0(economieGross),
    // p2_economie_nette = position nette APRÈS capex (bénéfice réel de l'investissement)
    p2_economie_nette: formatCurrency0(economieTotal),
    p2_tri: num(financeActive.irr_pct) != null ? `${num(financeActive.irr_pct).toFixed(1)} %` : "—",
    p2_roi: `${roiYears} ans`,
    p2_lcoe: lcoeVal != null ? `${lcoeVal.toFixed(2).replace(".", ",")} €/kWh` : "—",
    p2_prime: formatCurrency0(primeAmount),
    p2_reste_charge: formatCurrency0(resteACharge),
    p2_production: annualKwh > 0 ? `${Math.round(annualKwh).toLocaleString("fr-FR")} kWh` : "—",
  };

  const orientationMap = { S: "Sud", SE: "Sud-Est", SO: "Sud-Ouest", SW: "Sud-Ouest", E: "Est", O: "Ouest", W: "Ouest" };
  const p3b_auto = {
    client: clientName,
    ref,
    date: dateDisplay,
    inclinaison: num(site.tilt_deg) != null ? `${num(site.tilt_deg)}°` : "",
    orientation: orientationMap[String(site.orientation_deg || "").toUpperCase()] || str(site.orientation_deg) || "",
    surface_m2: num(installation.surface_panneaux_m2) ?? (numOrZero(installation.panneaux_nombre) * 2),
    nb_panneaux: numOrZero(installation.panneaux_nombre),
    layout_snapshot: options.calpinage_layout_snapshot ?? null,
  };

  const consumptionKwh = num(energy.consumption_kwh) ?? consoAnnuelle ?? 0;
  const economieAn1 = numOrZero(financeActive.economie_year_1);
  const annualSavings = Math.max(0, economieAn1);

  const batteryKwhP11 =
    num(equipment.batterie?.capacite_kwh) ??
    num(pdfBatteryScenario?.hardware?.battery_capacity_kwh) ??
    num(selectedScenario?.hardware?.battery_capacity_kwh) ??
    0;

  /** Flux annuels du scénario sélectionné (scenarios_v2) — même source que P9 / graphique étude. */
  const annualCashflowsForP11 =
    scenarioForFinance?.finance && Array.isArray(scenarioForFinance.finance.annual_cashflows)
      ? scenarioForFinance.finance.annual_cashflows
      : null;

  const { p11: p11Section, financingVm } = buildP11Section({
    clientName,
    ref,
    dateDisplay,
    capex,
    systemPowerKw,
    batteryKwh: batteryKwhP11,
    annualSavings,
    financeActive,
    financeSnapshot: finance,
    economieTotal,
    economicConfigJson: options.economic_snapshot_config ?? null,
    annualCashflows: annualCashflowsForP11,
  });

  const energyP10 =
    scenarioForFinance?.energy && typeof scenarioForFinance.energy === "object"
      ? scenarioForFinance.energy
      : energy;
  const autonomyPctP10 =
    num(energyP10.energy_independence_pct) ??
    num(energyP10.independence_pct) ??
    (energyP10.autoconsumption_kwh != null &&
    energyP10.production_kwh != null &&
    num(energyP10.production_kwh) > 0
      ? Math.min(100, (num(energyP10.autoconsumption_kwh) / num(energyP10.production_kwh)) * 100)
      : null);
  const selfConsumptionPctP10 =
    num(energyP10.autoconsumption_kwh) != null &&
    num(energyP10.production_kwh) != null &&
    num(energyP10.production_kwh) > 0
      ? Math.min(100, (num(energyP10.autoconsumption_kwh) / num(energyP10.production_kwh)) * 100)
      : null;

  // P4 mensuel : priorité energy.monthly du scénario (scenarios_v2), sinon répartition uniforme (somme = annuel)
  let consoMonthly;
  let autoMonthly;
  let surplusMonthly;
  const scenarioMonthly = selectedScenario?.energy?.monthly;
  const isBatteryScenario = selectedKey === "BATTERY_PHYSICAL" || selectedKey === "BATTERY_VIRTUAL";

  if (Array.isArray(scenarioMonthly) && scenarioMonthly.length >= 12) {
    consoMonthly = scenarioMonthly.slice(0, 12).map((m) => numOrZero(m.conso_kwh ?? m.conso));
    autoMonthly = scenarioMonthly.slice(0, 12).map((m) => numOrZero(m.auto_kwh ?? m.auto));
    surplusMonthly = scenarioMonthly.slice(0, 12).map((m) => numOrZero(m.surplus_kwh ?? m.surplus));
  } else {
    const cTot = num(consoAnnuelle) ?? num(consumptionKwh) ?? 0;
    consoMonthly = uniformMonthly12FromTotal(cTot);
    autoMonthly = monthly.map((p, i) => Math.min(numOrZero(p), numOrZero(consoMonthly[i])));
    surplusMonthly = monthly.map((p, i) => Math.max(0, numOrZero(p) - numOrZero(autoMonthly[i])));
  }

  // P6 : batterie mensuelle — lue depuis scenarioMonthly si scénario batterie, sinon 0
  const batMonthly = isBatteryScenario && Array.isArray(scenarioMonthly) && scenarioMonthly.length >= 12
    ? scenarioMonthly.slice(0, 12).map((m) => numOrZero(m.batt_kwh ?? m.batt))
    : Array(12).fill(0);

  // dir = PV directe = auto - batterie (auto inclut direct + décharge batterie)
  const dirMonthly = autoMonthly.map((a, i) => Math.max(0, (a ?? 0) - (batMonthly[i] ?? 0)));
  const gridMonthly = consoMonthly.map((c, i) => Math.max(0, c - dirMonthly[i] - batMonthly[i]));
  const totMonthly = consoMonthly;
  const price = econDisplay.price_eur_kwh;

  // P4 — synthèse annuelle (données réelles energy/finance)
  const prodAnnuelle = num(energy.production_kwh) ?? annualKwh;
  const consoAnnuelleP4 = num(energy.consumption_kwh) ?? consumptionKwh;
  const autoAnnuelle = num(energy.autoconsumption_kwh) ?? autoMonthly.reduce((a, b) => a + b, 0);
  const surplusAnnuelle = num(energy.surplus_kwh) ?? (surplusMonthly ? surplusMonthly.reduce((a, b) => a + b, 0) : Math.max(0, prodAnnuelle - autoAnnuelle));
  const importAnnuelle = num(energy.import_kwh) ?? numOrZero(energy.import_kwh);
  const couverturePct = consoAnnuelleP4 > 0 ? Math.min(100, Math.round((autoAnnuelle / consoAnnuelleP4) * 100)) : null;
  const tauxAutoPct = prodAnnuelle > 0 ? Math.min(100, Math.round((autoAnnuelle / prodAnnuelle) * 100)) : (selfConsumptionPct != null ? Math.round(selfConsumptionPct) : null);

  let pvHourlyKw8760 = null;
  const shapePerKwc = options.p5_pv_hourly_shape_per_kwc_8760;
  if (Array.isArray(shapePerKwc) && shapePerKwc.length >= 8760 && systemPowerKw > 0) {
    pvHourlyKw8760 = shapePerKwc.map((v) => (Number(v) || 0) * systemPowerKw);
  } else if (Array.isArray(options.p5_pv_hourly_kw_8760) && options.p5_pv_hourly_kw_8760.length >= 8760) {
    pvHourlyKw8760 = options.p5_pv_hourly_kw_8760.map((v) => Number(v) || 0);
  }

  let consoHourlyKw8760 = null;
  if (Array.isArray(options.p5_conso_hourly_kw_8760) && options.p5_conso_hourly_kw_8760.length >= 8760) {
    consoHourlyKw8760 = options.p5_conso_hourly_kw_8760.map((v) => Number(v) || 0);
  }

  const p5Profiles = buildP5DailyProfiles({
    annualProductionKwh: annualKwh,
    monthlyProductionKwh12: monthly,
    annualConsumptionKwh: consumptionKwh,
    monthlyConsumptionKwh12: consoMonthly,
    latitudeDeg: num(site.lat),
    pvHourlyKw8760,
    consoHourlyKw8760,
  });
  const p5Prod = p5Profiles.production_kw;
  const p5Conso = p5Profiles.consommation_kw;
  let p5Batt = Array(24).fill(0);
  if (pdfBatteryType === "VIRTUAL" && pdfBatteryScenario) {
    const vbP5 =
      pdfBatteryScenario.virtual_battery_8760 || pdfBatteryScenario._virtualBattery8760 || {};
    const rawCh =
      vbP5.virtual_battery_hourly_charge_kwh ?? vbP5.hourly_charge ?? [];
    if (Array.isArray(rawCh) && rawCh.length >= 8760) {
      p5Batt = hourly8760ToAvg24(rawCh);
    } else if (Array.isArray(rawCh) && rawCh.length >= 24) {
      p5Batt = rawCh.slice(0, 24).map((x) => numOrZero(x));
    }
  }

  const offerMateriel = Math.round(capex * 0.7);
  const offerPose = Math.round(capex * 0.3);
  const batterieHtPdf = Math.round(numOrZero(pdfBatteryScenario?.finance?.capex_ttc));
  const primeAmountRounded = Math.round(primeAmount);
  const totalTtcOffer = Math.round(capex * 1.1);
  const offer = {
    materiel_ht: offerMateriel,
    batterie_ht: batterieHtPdf,
    shelly_ht: 0,
    pose_ht: offerPose,
    gestion_ht: 0,
    sous_total_ht: capex,
    tva_mat: 10,
    tva_pose: 10,
    tva_materiel_eur: Math.round(offerMateriel * 0.1),
    tva_pose_eur: Math.round(offerPose * 0.1),
    total_ttc: totalTtcOffer,
    prime: primeAmountRounded,
    reste: Math.max(0, totalTtcOffer - primeAmountRounded),
    puissance: systemPowerKw,
    batterie_label: "",
    onduleurs: str(onduleur.modele) || str(onduleur.marque) || "",
    garantie: "25 ans",
    echelon: "À définir",
    validite: "30 jours",
    delai: "À définir",
  };

  const autoKwhCo2 = num(energy.autoconsumption_kwh) ?? num(selectedScenario?.energy?.autoconsumption_kwh) ?? 0;
  const surplusKwhCo2 = num(energy.surplus_kwh) ?? num(selectedScenario?.energy?.surplus_kwh) ?? 0;
  const co2Evite = Math.round(
    autoKwhCo2 * IMPACT_FACTOR_CO2_AUTO_KG_PER_KWH + surplusKwhCo2 * IMPACT_FACTOR_CO2_SURPLUS_KG_PER_KWH
  );
  const treesEquiv = Math.round(co2Evite / IMPACT_TREE_CO2_KG_PER_YEAR);
  const carsEquiv = Math.round(co2Evite / IMPACT_CAR_CO2_KG_PER_KM);

  const generatedAt = str(snapshot.computed_at) || str(snapshot.created_at) || new Date().toISOString();
  return {
    meta: {
      studyId: options.studyId ?? null,
      versionId: options.versionId ?? null,
      generatedAt,
      scenarioType: str(selectedKey),
    },
    study_number: options.studyNumber ?? null,
    generated_at: generatedAt,
    client: {
      name: clientName,
      city: str(client.ville),
      postalCode: str(client.cp),
      fullAddress: str(client.adresse),
    },
    project: {
      projectName: "",
      installationType: "PV",
      gridConnection: str(site.type_reseau) || null,
      meterPowerKva: num(site.puissance_compteur_kva),
    },
    site: {
      latitude: num(site.lat),
      longitude: num(site.lon),
      orientationDeg: num(site.orientation_deg),
      tiltDeg: num(site.tilt_deg),
      roofType: null,
      shadingLossPct: num(resolveShadingTotalLossPct(shading, form)),
    },
    technical: {
      panelsCount: numOrZero(installation.panneaux_nombre),
      panelModel: str(panneau.modele) || str(panneau.marque) || "",
      inverterModel: str(onduleur.modele) || str(onduleur.marque) || "",
      inverterType: "",
      systemPowerKw,
      panelPowerW: num(panneau.puissance_wc) ?? 0,
      installationSurfaceM2: num(installation.surface_panneaux_m2),
    },
    production: {
      annualProductionKwh: annualKwh,
      monthlyProduction: monthly,
      specificYield,
    },
    economics: {
      capex: numOrZero(financeActive.capex_ttc),
      annualRevenue: numOrZero(financeActive.revenu_surplus ?? finance.revenu_surplus),
      annualSavings,
      roiYears: Math.max(0, numOrZero(financeActive.roi_years)),
      tri: num(financeActive.irr_pct),
      paybackYears: Math.max(0, numOrZero(financeActive.roi_years)),
    },
    financing: financingVm,
    savings: {
      gridImportBefore: num(energy.consumption_kwh),
      gridImportAfter: num(energy.import_kwh),
      selfConsumptionRate: (() => {
        const prod = num(energy.production_kwh);
        const auto = num(energy.autoconsumption_kwh);
        if (prod == null || prod <= 0 || auto == null) return null;
        return Math.min(100, (auto / prod) * 100);
      })(),
      autonomyRate: num(energy.independence_pct),
      annualElectricityBillBefore: null,
      annualElectricityBillAfter: num(financeActive.facture_restante ?? finance.facture_restante),
    },
    selectedScenario: {
      scenarioType: str(selectedKey),
      label: SCENARIO_LABELS[selectedKey] || str(selectedKey),
      description: "",
    },
    company: {
      companyName: "",
      brand: "",
      contactEmail: "",
      contactPhone: "",
    },
    disclaimers: {
      legalNotice: "",
      methodologyNote: "",
      simulationDisclaimer: "",
    },
    fullReport: {
      p1: { p1_auto },
      p2: { p2_auto },
      p3: {
        meta: { client: clientName, ref, date: dateDisplay },
        offer,
        finance: { mensualite: 0, note: "" },
        tech: {},
      },
      p3b: { p3b_auto },
      p4: {
        meta: { client: clientName, ref, date: dateDisplay, date_display: dateDisplay },
        production_kwh: monthly,
        consommation_kwh: consoMonthly,
        autoconso_kwh: autoMonthly,
        surplus_kwh: surplusMonthly,
        batterie_kwh: batMonthly,
        // Synthèse annuelle (données réelles)
        production_annuelle: prodAnnuelle,
        consommation_annuelle: consoAnnuelleP4,
        energie_consommee_directement: autoAnnuelle,
        energie_injectee: surplusAnnuelle,
        taux_autoconsommation_pct: tauxAutoPct,
        couverture_besoins_pct: couverturePct,
        autonomie_pct: autonomyPct,
        economie_annee_1: economieAn1,
      },
      p5: {
        meta: { client: clientName, ref, date: dateDisplay },
        production_kw: p5Prod,
        consommation_kw: p5Conso,
        batterie_kw: p5Batt,
        profile_notes: p5Profiles.profile_notes,
      },
      p6: {
        p6: {
          meta: { client: clientName, ref, date: dateDisplay },
          price,
          dir: dirMonthly,
          bat: batMonthly,
          grid: gridMonthly,
          tot: totMonthly,
        },
      },
      // P7 — source principale = selectedScenario.energy (scenarios_v2), fallback = snapshot.energy
      // Aligné avec P6 : réagit aux recalculs calpinage / scénario
      // Origine consommation : c_pv+c_bat = autonomie (sans réseau), c_grid = part réseau
      // Destination production : p_auto = autoconsommation, p_surplus = injecté
      p7: (() => {
        const energyP7 = selectedScenario?.energy ?? energy;
        const prodP7 = num(energyP7.production_kwh) ?? annualKwh;
        const consoP7 = num(energyP7.consumption_kwh) ?? consumptionKwh;
        const autoP7 = num(energyP7.autoconsumption_kwh) ?? autoMonthly.reduce((a, b) => a + b, 0);
        const surplusP7 = num(energyP7.surplus_kwh) ?? Math.max(0, prodP7 - autoP7);
        const importP7 = num(energyP7.import_kwh) ?? Math.max(0, consoP7 - autoP7);
        const selfConsP7 = prodP7 > 0 && autoP7 != null ? Math.min(100, (autoP7 / prodP7) * 100) : null;
        const autonomyP7 = num(energyP7.energy_independence_pct) ?? num(energyP7.independence_pct)
          ?? (consoP7 > 0 && importP7 != null ? Math.max(0, 100 - (importP7 / consoP7) * 100) : null);
        const partReseauP7 = autonomyP7 != null ? Math.round(100 - autonomyP7) : (consoP7 > 0 && importP7 != null ? Math.round((importP7 / consoP7) * 100) : 0);
        const surplusPctP7 = prodP7 > 0 && surplusP7 != null ? Math.min(100, (surplusP7 / prodP7) * 100) : (selfConsP7 != null ? 100 - selfConsP7 : 0);
        const autonomiePct = autonomyP7 != null ? Math.round(autonomyP7) : (partReseauP7 > 0 ? Math.max(0, 100 - partReseauP7) : 0);

        const isBatScen = selectedKey === "BATTERY_PHYSICAL" || selectedKey === "BATTERY_VIRTUAL";
        const restoredP7 =
          num(energyP7.restored_kwh) ?? num(energyP7.used_credit_kwh) ?? 0;
        const creditedP7 = num(energyP7.credited_kwh) ?? 0;
        let cBat = consoP7 > 0 && isBatScen ? Math.min(100, (restoredP7 / consoP7) * 100) : 0;
        let cGrid = consoP7 > 0 ? Math.min(100, (importP7 / consoP7) * 100) : 0;
        let cPv = isBatScen ? Math.max(0, 100 - cBat - cGrid) : autonomiePct;
        if (isBatScen) {
          const cSum = cPv + cBat + cGrid;
          if (cSum > 100.01 && cSum > 0) {
            const f = 100 / cSum;
            cPv *= f;
            cBat *= f;
            cGrid *= f;
          }
        } else {
          cBat = 0;
          cGrid = partReseauP7;
          cPv = autonomiePct;
        }
        let pBat = prodP7 > 0 && isBatScen ? Math.min(100, (creditedP7 / prodP7) * 100) : 0;
        let pSurplusRounded = Math.round(surplusPctP7);
        let pAuto = isBatScen
          ? Math.max(0, 100 - pBat - pSurplusRounded)
          : (selfConsP7 != null ? Math.round(selfConsP7) : 0);
        if (isBatScen) {
          const pSum = pAuto + pBat + pSurplusRounded;
          if (pSum > 100.01 && pSum > 0) {
            const f = 100 / pSum;
            pAuto = Math.round(pAuto * f);
            pBat = Math.round(pBat * f);
            pSurplusRounded = Math.round(pSurplusRounded * f);
          }
        }

        return {
          meta: {
            client: clientName,
            ref,
            date: dateDisplay,
            scenario_label: SCENARIO_LABELS[selectedKey] || str(selectedKey),
          },
          pct: {
            c_pv_pct: Math.round(cPv),
            c_bat_pct: Math.round(cBat),
            c_grid_pct: Math.round(cGrid),
            p_auto_pct: pAuto,
            p_bat_pct: Math.round(pBat),
            p_surplus_pct: pSurplusRounded,
          },
          c_grid: numOrZero(importP7),
          p_surplus: numOrZero(surplusP7),
          consumption_kwh: numOrZero(consoP7),
          autoconsumption_kwh: numOrZero(autoP7),
          production_kwh: numOrZero(prodP7),
        };
      })(),
      // P8 — source UNIQUE = scenarios_v2, JAMAIS snapshot. Conditionnel : null si pas de batterie.
      p8: (() => {
        const base = baseFromV2;
        const batteryScenario = pdfBatteryScenario;
        const batteryType = pdfBatteryType;
        if (!base || !batteryScenario || !batteryType) return null;

        if (batteryType === "VIRTUAL" && process.env.DEBUG_PDF_BV === "1") {
          console.log("=== PDF BV INPUT ===", batteryScenario);
        }

        const A = base.energy || {};
        const B = batteryScenario.energy || {};
        const financeB = batteryScenario.finance || {};

        const autonomieA = num(A.energy_independence_pct) ?? num(A.independence_pct) ?? 0;
        const autonomieB = num(B.energy_independence_pct) ?? num(B.independence_pct) ?? 0;
        const gainAutonomie = autonomieB - autonomieA;
        const gridImportA = p8AnnualGridImportKwh(A, null);
        const gridImportB = p8AnnualGridImportKwh(B, batteryType);
        const reductionAchatKwh = gridImportA - gridImportB;
        const reductionAchatEur =
          num(financeB.economie_year_1) ?? num(financeB.annual_savings) ?? 0;

        const bv =
          batteryType === "VIRTUAL" ? (batteryScenario.battery_virtual || {}) : {};
        const vb8760 =
          batteryScenario.virtual_battery_8760 ||
          batteryScenario._virtualBattery8760 ||
          {};

        const battNested =
          typeof batteryScenario?.battery === "object" && batteryScenario?.battery !== null
            ? batteryScenario.battery
            : null;

        let cyclesYear = null;
        let cyclesDay = null;
        if (batteryType === "VIRTUAL") {
          cyclesYear =
            bv.cycles_equivalent != null && Number.isFinite(Number(bv.cycles_equivalent))
              ? Number(bv.cycles_equivalent)
              : null;
          cyclesDay =
            num(batteryScenario.battery_daily_cycles) ??
            (cyclesYear != null ? cyclesYear / 365 : null);
        } else {
          cyclesYear =
            num(batteryScenario.battery_cycles_per_year) ??
            num(battNested?.equivalent_cycles) ??
            null;
          cyclesDay =
            num(batteryScenario.battery_daily_cycles) ??
            num(battNested?.daily_cycles_avg) ??
            (cyclesYear != null ? cyclesYear / 365 : null);
        }

        const prodKwh = num(A.production_kwh) ?? num(B.production_kwh) ?? annualKwh;
        const sliceOrAvg24 = (arr) => {
          if (!Array.isArray(arr) || arr.length < 24) return Array(24).fill(0);
          if (arr.length >= 8760) return hourly8760ToAvg24(arr);
          return arr.slice(0, 24).map((x) => numOrZero(x));
        };
        const consoKwhP8 = num(A.consumption_kwh) ?? consumptionKwh;
        const pvFallback = flatAverageKw24FromAnnualKwh(prodKwh);
        const loadFallback = flatAverageKw24FromAnnualKwh(consoKwhP8);

        const rawCharge =
          vb8760.virtual_battery_hourly_charge_kwh ??
          vb8760.hourly_charge ??
          B.hourly_charge ??
          [];
        const rawDischarge =
          vb8760.virtual_battery_hourly_discharge_kwh ??
          vb8760.hourly_discharge ??
          B.hourly_discharge ??
          [];

        const interpretation = {};
        if (batteryType === "PHYSICAL") {
          interpretation.ligne1 = "Votre batterie vous permet de stocker votre production solaire";
        } else {
          interpretation.ligne1 = "Votre batterie virtuelle valorise votre surplus d'énergie";
        }
        interpretation.ligne2 = `Vous gagnez ${Math.round(gainAutonomie)} points d'autonomie`;
        interpretation.ligne3 = `Vous réduisez vos achats réseau de ${Math.round(reductionAchatKwh)} kWh`;
        interpretation.texte_court =
          batteryType === "PHYSICAL"
            ? "Votre batterie stocke votre énergie produite en journée pour l'utiliser le soir, lorsque votre consommation est la plus élevée."
            : "Votre batterie virtuelle valorise votre surplus en journée pour réduire vos achats au réseau le soir.";

        const batt = batteryScenario?.battery || batteryScenario?.equipment?.batterie || {};
        const deltaAuto = (num(B.autoconsumption_kwh) ?? num(B.auto_kwh) ?? 0) - (num(A.autoconsumption_kwh) ?? num(A.auto_kwh) ?? 0);
        const deltaSurplus = (num(B.surplus_kwh) ?? 0) - (num(A.surplus_kwh) ?? 0);

        const cumulSansBat = cumulEurEndFromScenario(base);
        const cumulAvecBat = cumulEurEndFromScenario(batteryScenario);
        const gainBatterie25Brut =
          cumulSansBat != null && cumulAvecBat != null
            ? Math.round(cumulAvecBat - cumulSansBat)
            : null;
        const gainBatterie25 =
          gainBatterie25Brut != null && Number.isFinite(gainBatterie25Brut) && gainBatterie25Brut > 0
            ? gainBatterie25Brut
            : null;

        let optionSupplementKwh25y = null;
        let optionSupplementAutonomiePts = null;
        if (reductionAchatKwh > 0 && Number.isFinite(reductionAchatKwh)) {
          const kwhProj = Math.round(reductionAchatKwh * 25);
          if (kwhProj > 0) optionSupplementKwh25y = kwhProj;
        }
        if (optionSupplementKwh25y == null && gainAutonomie > 0 && Number.isFinite(gainAutonomie)) {
          optionSupplementAutonomiePts = Math.round(gainAutonomie);
        }

        const throughputKwh =
          batteryType === "VIRTUAL"
            ? numOrZero(bv.annual_throughput_kwh)
            : numOrZero(batteryScenario.battery_throughput_kwh ?? B.battery_throughput_kwh);

        return {
          meta: { client: clientName, ref, date: dateDisplay },
          year: new Date().getFullYear().toString(),
          batteryType,
          A: {
            production_kwh: num(A.production_kwh) ?? prodKwh,
            autocons_kwh: num(A.autoconsumption_kwh) ?? num(A.auto_kwh) ?? 0,
            surplus_kwh: num(A.surplus_kwh) ?? 0,
            grid_import_kwh: gridImportA,
            autonomie_pct: autonomieA,
          },
          B: {
            production_kwh: num(B.production_kwh) ?? prodKwh,
            autocons_kwh: num(B.autoconsumption_kwh) ?? num(B.auto_kwh) ?? 0,
            surplus_kwh: num(B.surplus_kwh) ?? 0,
            grid_import_kwh: gridImportB,
            autonomie_pct: autonomieB,
            battery_throughput_kwh: throughputKwh,
          },
          gain_batterie_25_ans_eur: gainBatterie25,
          option_supplement_kwh_25y: optionSupplementKwh25y,
          option_supplement_autonomie_pts:
            optionSupplementKwh25y != null && optionSupplementKwh25y > 0 ? null : optionSupplementAutonomiePts,
          detailsBatterie: {
            gain_autonomie_pts: gainAutonomie,
            gain_autoconsommation_kwh: deltaAuto,
            reduction_achat_kwh: reductionAchatKwh,
            reduction_achat_eur: reductionAchatEur,
            credited_kwh: numOrZero(B.credited_kwh),
            restored_kwh: numOrZero(B.restored_kwh ?? B.used_credit_kwh),
            overflow_export_kwh: numOrZero(B.overflow_export_kwh ?? B.virtual_battery_overflow_export_kwh),
            billable_import_kwh: numOrZero(B.billable_import_kwh ?? B.import_kwh),
          },
          profile: {
            pv: Array.isArray(A.hourly_pv) && A.hourly_pv.length >= 24 ? A.hourly_pv.slice(0, 24) : pvFallback,
            load: Array.isArray(A.hourly_load) && A.hourly_load.length >= 24 ? A.hourly_load.slice(0, 24) : loadFallback,
            charge: sliceOrAvg24(rawCharge),
            discharge: sliceOrAvg24(rawDischarge),
          },
          hypotheses: {
            annee: null,
            cycles_an: cyclesYear,
            cycles_jour: cyclesDay,
            capacite_utile_kwh:
              batteryType === "VIRTUAL"
                ? (bv.capacity_simulated_kwh != null ? num(bv.capacity_simulated_kwh) : null)
                : (batt.capacity_kwh ?? batt.capacite_kwh ?? null),
            profil_journee: null,
          },
          texteSousBarres: {
            b1: `Autoconso : +${Math.round(deltaAuto)} kWh`,
            b2: `Achats réseau : −${Math.round(reductionAchatKwh)} kWh`,
            b3: `Surplus : ${Math.round(deltaSurplus)} kWh`,
          },
          interpretation,
        };
      })(),
      /**
       * P9 — Données strictement issues de data_json.scenarios_v2 (aucune lecture snapshot pour le métier).
       * Clé : options.selected_scenario_id uniquement (pas de repli snapshot.scenario_type).
       * Capex : finance.capex_ttc ; ROI : finance.roi_years (amortissement TTC) ;
       * cumul_25y : cumul_eur = position nette après CAPEX TTC ; cumul_gains_eur = somme des flux.
       */
      p9: (() => {
        const p9Key = options.selected_scenario_id;
        const scenariosArr = Array.isArray(options.scenarios_v2) ? options.scenarios_v2 : [];
        const scenariosByKey = Object.fromEntries(scenariosArr.map((s) => [s.id ?? s.name ?? "BASE", s]));
        const meta = { client: clientName, ref, date: dateDisplay };

        const notFound = {
          meta,
          scenario: null,
          error: "SCENARIO_NOT_FOUND",
          warnings: [],
        };

        if (p9Key == null || p9Key === "") {
          return notFound;
        }

        const scenario = scenariosByKey[p9Key];
        if (!scenario || typeof scenario !== "object") {
          return notFound;
        }

        const flows = scenario.finance?.annual_cashflows ?? [];

        const buildCumul25yP9 = (sc) => {
          const f = sc.finance?.annual_cashflows ?? [];
          return Array.from({ length: 25 }, (_, i) => {
            const row = f[i] ?? f.find((x) => num(x?.year) === i + 1);
            return num(row?.cumul_eur ?? row?.cumul);
          });
        };

        function yearlyNetFromFlow(row) {
          if (!row || typeof row !== "object") return null;
          const t = num(row.total_eur);
          if (t != null && Number.isFinite(t)) return t;
          const ga = num(row.gain_auto);
          const go = num(row.gain_oa);
          if (ga != null || go != null) return (ga ?? 0) + (go ?? 0);
          return null;
        }

        function avgSavingsFromFlowsOnly(f) {
          if (!Array.isArray(f) || f.length === 0) return null;
          let sum = 0;
          let n = 0;
          for (let i = 0; i < Math.min(25, f.length); i++) {
            const y = yearlyNetFromFlow(f[i]);
            if (y != null && Number.isFinite(y)) {
              sum += y;
              n++;
            }
          }
          return n > 0 ? sum / n : null;
        }

        function finalCumulFrom25(arr) {
          if (!Array.isArray(arr)) return null;
          const y25 = num(arr[24]);
          if (y25 != null) return y25;
          for (let i = arr.length - 1; i >= 0; i--) {
            const v = num(arr[i]);
            if (v != null) return v;
          }
          return null;
        }

        const cumul_25y = buildCumul25yP9(scenario);
        const final_cumul = finalCumulFrom25(cumul_25y);
        const label = scenario.label ?? SCENARIO_LABELS[p9Key] ?? str(p9Key) ?? "—";

        const capex_eur = num(scenario.finance?.capex_ttc) ?? num(scenario.capex?.total_ttc) ?? null;
        const roi_year = num(scenario.finance?.roi_years);
        const avg_savings_eur_year = avgSavingsFromFlowsOnly(flows);

        const lastFlow = Array.isArray(flows) && flows.length > 0 ? flows[flows.length - 1] : null;
        const cumul_gains_end =
          num(lastFlow?.cumul_gains_eur) ??
          (final_cumul != null && capex_eur != null && Number.isFinite(final_cumul) && Number.isFinite(capex_eur)
            ? final_cumul + capex_eur
            : null);

        const engineWarnings = Array.isArray(scenario.finance?.warnings)
          ? scenario.finance.warnings.filter((w) => typeof w === "string")
          : [];

        const warningsRaw = [...engineWarnings];
        if (capex_eur != null && capex_eur < 1000) warningsRaw.push("INVALID_CAPEX");
        if (roi_year != null && roi_year < 2) warningsRaw.push("SUSPICIOUS_ROI");
        if (
          avg_savings_eur_year != null &&
          cumul_gains_end != null &&
          Number.isFinite(avg_savings_eur_year) &&
          Number.isFinite(cumul_gains_end) &&
          avg_savings_eur_year * 25 < cumul_gains_end
        ) {
          warningsRaw.push("INCOHERENT_AVG_VS_CUMUL");
        }
        const warnings = [...new Set(warningsRaw)];

        return {
          meta,
          scenario: {
            label,
            capex_eur: capex_eur != null && Number.isFinite(capex_eur) ? capex_eur : null,
            avg_savings_eur_year:
              avg_savings_eur_year != null && Number.isFinite(avg_savings_eur_year) ? avg_savings_eur_year : null,
            roi_year: roi_year != null && Number.isFinite(roi_year) ? roi_year : null,
            cumul_25y,
            final_cumul: final_cumul != null && Number.isFinite(final_cumul) ? final_cumul : null,
          },
          warnings,
          error: null,
        };
      })(),
      p10: {
        meta: { client: clientName, ref, date: dateDisplay },
        best: {
          kwc: systemPowerKw,
          modules_label: str(panneau.modele) || str(panneau.marque) || "",
          inverter_label: str(onduleur.modele) || str(onduleur.marque) || "",
          savings_year1_eur: annualSavings,
          roi_years: roiYears,
          tri_pct: irrPct,
          cfg_label: `${systemPowerKw} kWc`,
          battery_kwh: 0,
          autoprod_pct: selfConsumptionPctP10,
          autonomy_pct: autonomyPctP10,
          gains_25_eur: economieTotal,
          lcoe_eur_kwh: lcoeVal,
          nb_panels: numOrZero(installation.panneaux_nombre),
          annual_production_kwh: annualKwh,
        },
        hyp: {
          pv_degrad: econDisplay.pv_degradation_pct,
          elec_infl: econDisplay.elec_growth_pct,
          oa_price: resolveOaRateForKwc(pdfEconomicsCtx, systemPowerKw),
          price_kwh: econDisplay.price_eur_kwh,
          horizon_years: econDisplay.horizon_years,
          prime_autoconso_eur: primeAmount,
        },
      },
      p11: p11Section,
      p12: {
        meta: { client: clientName, ref, date: dateDisplay },
        env: { autocons_pct: selfConsumptionPct ?? 0 },
        v_co2: `${co2Evite.toLocaleString("fr-FR")} kg`,
        v_trees: treesEquiv.toString(),
        v_cars: carsEquiv.toString(),
        v_co2_25: `${(co2Evite * 25).toLocaleString("fr-FR")} kg`,
        v_trees_25: (treesEquiv * 25).toString(),
        v_cars_25: (carsEquiv * 25).toString(),
      },
      p13: { meta: { client: clientName, ref, date: dateDisplay } },
      p14: { meta: { client: clientName, ref, date: dateDisplay } },
    },
  };
}

function buildEmptyViewModel(options) {
  const emptyMonthly = Array.from({ length: MONTHS_COUNT }, () => 0);
  const generatedAt = new Date().toISOString();
  return {
    meta: {
      studyId: options.studyId ?? null,
      versionId: options.versionId ?? null,
      generatedAt,
      scenarioType: "",
    },
    study_number: options.studyNumber ?? null,
    generated_at: generatedAt,
    client: { name: "", city: "", postalCode: "", fullAddress: "" },
    project: { projectName: "", installationType: "PV", gridConnection: null, meterPowerKva: null },
    site: { latitude: null, longitude: null, orientationDeg: null, tiltDeg: null, roofType: null, shadingLossPct: null },
    technical: {
      panelsCount: 0,
      panelModel: "",
      inverterModel: "",
      inverterType: "",
      systemPowerKw: 0,
      panelPowerW: 0,
      installationSurfaceM2: null,
    },
    production: { annualProductionKwh: 0, monthlyProduction: emptyMonthly, specificYield: 0 },
    economics: { capex: 0, annualRevenue: 0, annualSavings: 0, roiYears: 0, tri: null, paybackYears: 0 },
    financing: { loanUsed: false, loanDurationYears: 0, monthlyPayment: 0, interestRate: 0 },
    savings: {
      gridImportBefore: null,
      gridImportAfter: null,
      selfConsumptionRate: null,
      autonomyRate: null,
      annualElectricityBillBefore: null,
      annualElectricityBillAfter: null,
    },
    selectedScenario: { scenarioType: "", label: "", description: "" },
    company: { companyName: "", brand: "", contactEmail: "", contactPhone: "" },
    disclaimers: { legalNotice: "", methodologyNote: "", simulationDisclaimer: "" },
    fullReport: buildEmptyFullReport(),
  };
}

function buildEmptyFullReport() {
  const emptyMeta = { client: "", ref: "", date: "" };
  const emptyMonthly = Array.from({ length: MONTHS_COUNT }, () => 0);
  const empty24 = Array.from({ length: 24 }, () => 0);
  const empty25 = Array.from({ length: 25 }, () => 0);
  return {
    p1: { p1_auto: {} },
    p2: { p2_auto: {} },
    p3: { meta: emptyMeta, offer: {}, finance: {}, tech: {} },
    p3b: { p3b_auto: {} },
    p4: {
      meta: emptyMeta,
      production_kwh: emptyMonthly,
      consommation_kwh: emptyMonthly,
      autoconso_kwh: emptyMonthly,
      surplus_kwh: emptyMonthly,
      batterie_kwh: emptyMonthly,
      production_annuelle: 0,
      consommation_annuelle: 0,
      energie_consommee_directement: 0,
      energie_injectee: 0,
      taux_autoconsommation_pct: null,
      couverture_besoins_pct: null,
      autonomie_pct: null,
      economie_annee_1: 0,
    },
    p5: {
      meta: emptyMeta,
      production_kw: empty24,
      consommation_kw: empty24,
      batterie_kw: empty24,
      profile_notes: { production: "", consumption: "" },
    },
    p6: { p6: { meta: emptyMeta, price: 0, dir: emptyMonthly, bat: emptyMonthly, grid: emptyMonthly, tot: emptyMonthly } },
    p7: { meta: emptyMeta, pct: {}, c_grid: 0, p_surplus: 0 },
    p8: null,
    p9: {
      meta: emptyMeta,
      scenario: null,
      error: null,
      warnings: [],
    },
    p10: { meta: emptyMeta, best: {}, hyp: {} },
    p11: {
      meta: emptyMeta,
      data: {
        economies_annuelles_25: empty25,
        series: {
          economies_annuelles: empty25,
          paiement_annuel: empty25,
          reste_a_charge_annuel: empty25,
        },
        financing: {},
        kpi: {},
        post_loan: {},
      },
    },
    p12: { meta: emptyMeta, env: {}, v_co2: "", v_trees: "", v_cars: "", v_co2_25: "", v_trees_25: "", v_cars_25: "" },
    p13: { meta: emptyMeta },
    p14: { meta: emptyMeta },
  };
}
