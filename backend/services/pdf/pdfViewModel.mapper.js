/**
 * PDF V2 — Mapper snapshot → ViewModel rendu PDF
 * Entrée unique du moteur PDF V2. Pur : pas d'API, pas de DB, pas de mutation du snapshot.
 * Toutes les valeurs sont normalisées (null | 0 | "" | valeur typée), jamais undefined.
 */

import { resolveShadingTotalLossPct } from "../shading/resolveShadingTotalLossPct.js";
import {
  IMPACT_FACTOR_CO2_AUTO_KG_PER_KWH,
  IMPACT_FACTOR_CO2_SURPLUS_KG_PER_KWH,
  IMPACT_TREE_CO2_KG_PER_YEAR,
  IMPACT_CAR_CO2_KG_PER_KM,
} from "../core/engineConstants.js";
import { buildP5DailyProfiles } from "./pdfP5DailyProfile.js";
import { formatFlatRoofMountingForPdf } from "../quotePrep/flatRoofMounting.util.js";

const SCENARIO_LABELS = {
  BASE: "Sans batterie",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
  BATTERY_HYBRID: "Hybride : physique + virtuelle",
  VEHICLE_V2H: "Voiture V2H",
  VEHICLE_V2H_PHYSICAL: "Voiture V2H + batterie physique",
  VEHICLE_V2H_VIRTUAL: "Voiture V2H + batterie virtuelle",
  VEHICLE_V2H_PHYSICAL_VIRTUAL: "Voiture V2H + physique + virtuelle",
};

const MONTHS_COUNT = 12;

/**
 * Même priorité que financeService.pickEconomics pour l’affichage PDF (sans importer le moteur finance).
 */
function frozenEconomicsForPdf(snapshotEconomic) {
  const e = snapshotEconomic && typeof snapshotEconomic === "object" ? snapshotEconomic : {};
  return {
    price_eur_kwh: num(e.price_eur_kwh),
    elec_growth_pct: num(e.elec_growth_pct),
    pv_degradation_pct: num(e.pv_degradation_pct),
    horizon_years: num(e.horizon_years),
    oa_rate_eur_kwh: num(e.oa_rate_eur_kwh),
    prime_eur: num(e.prime_eur),
    prime_rate_eur_kwc: num(e.prime_rate_eur_kwc),
    capex_ttc: num(e.capex_ttc),
    reste_a_charge_eur: num(e.reste_a_charge_eur),
    financing: e.financing && typeof e.financing === "object" ? e.financing : null,
    hash: typeof e.hash === "string" ? e.hash : null,
    calculated_at: typeof e.calculated_at === "string" ? e.calculated_at : null,
    blocking_warnings: Array.isArray(e.blocking_warnings) ? e.blocking_warnings : [],
  };
}

function frozenEconomicConfigForP11(snapshotEconomic) {
  const e = snapshotEconomic && typeof snapshotEconomic === "object" ? snapshotEconomic : null;
  const f = e?.financing && typeof e.financing === "object" ? e.financing : null;
  if (!e || !f) return null;
  return {
    totals: { ttc: e.capex_ttc ?? null },
    financing: {
      amount: f.amount_eur ?? null,
      duration_months: f.duration_months ?? null,
      interest_rate_annual: f.interest_rate_annual_pct ?? null,
      taeg_pct: f.taeg_pct ?? null,
      insurance_eur: f.insurance_eur ?? null,
      application_fee_eur: f.application_fee_eur ?? null,
    },
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

function isVehicleV2hScenarioId(id) {
  return (
    id === "VEHICLE_V2H" ||
    id === "VEHICLE_V2H_PHYSICAL" ||
    id === "VEHICLE_V2H_VIRTUAL" ||
    id === "VEHICLE_V2H_PHYSICAL_VIRTUAL"
  );
}

function isVirtualLikeScenarioId(id) {
  return (
    id === "BATTERY_VIRTUAL" ||
    id === "BATTERY_HYBRID" ||
    id === "VEHICLE_V2H_VIRTUAL" ||
    id === "VEHICLE_V2H_PHYSICAL_VIRTUAL"
  );
}

function isStorageScenarioId(id) {
  return (
    id === "BATTERY_PHYSICAL" ||
    id === "BATTERY_VIRTUAL" ||
    id === "BATTERY_HYBRID" ||
    isVehicleV2hScenarioId(id)
  );
}

function canonicalGridImportKwh(energy) {
  const e = energy || {};
  return (
    num(e.energy_grid_import_kwh) ??
    num(e.billable_import_kwh) ??
    num(e.grid_import_kwh) ??
    num(e.import_kwh) ??
    num(e.import)
  );
}

function canonicalGridImportKwhForPdf(energy) {
  const e = energy || {};
  const canonical = canonicalGridImportKwh(e);
  if (!hasVirtualCreditEnergy(e)) return canonical;

  const conso = num(e.consumption_kwh ?? e.conso);
  const covered =
    num(e.site_solar_or_credit_used_kwh) ??
    num(e.energy_solar_used_kwh) ??
    num(e.total_pv_used_on_site_kwh) ??
    coveredFromCanonicalImportKwh(e);
  if (conso == null || conso <= 0 || covered == null || !Number.isFinite(covered)) return canonical;

  const inferred = Math.max(0, conso - Math.min(conso, covered));
  if (canonical == null || canonical <= 0) return inferred;
  return Math.max(0, canonical);
}

function coveredFromCanonicalImportKwh(energy) {
  const conso = num(energy?.consumption_kwh ?? energy?.conso);
  const imp = canonicalGridImportKwh(energy);
  if (conso == null || conso <= 0 || imp == null || !Number.isFinite(imp)) return null;
  return Math.max(0, Math.min(conso, conso - imp));
}

function hasVirtualCreditEnergy(energy) {
  return (
    num(energy?.used_credit_kwh) != null ||
    num(energy?.restored_kwh) != null ||
    num(energy?.virtual_battery_discharge_kwh) != null ||
    num(energy?.credited_kwh) != null ||
    num(energy?.surplus_used_by_virtual_battery_kwh) != null
  );
}

function resolvePvUsedOnSiteKwhForPdf(energy) {
  const e = energy || {};
  if (hasVirtualCreditEnergy(e)) {
    const physicalAuto = num(e.physical_auto_kwh);
    if (physicalAuto != null) return Math.max(0, physicalAuto);
    const direct = num(e.direct_self_consumption_kwh);
    const physicalDischarge = num(e.physical_battery_discharge_kwh);
    if (direct != null && physicalDischarge != null) return Math.max(0, direct + physicalDischarge);
    if (direct != null) return Math.max(0, direct);
  }
  return num(e.total_pv_used_on_site_kwh ?? e.energy_solar_used_kwh ?? e.autoconsumption_kwh ?? e.auto);
}

function resolveBatteryRestoredKwhForPdf(scenario, energy) {
  const e = energy && typeof energy === "object" ? energy : {};
  const battery = scenario?.battery && typeof scenario.battery === "object" ? scenario.battery : {};
  const virtualBattery =
    scenario?.battery_virtual && typeof scenario.battery_virtual === "object"
      ? scenario.battery_virtual
      : {};
  const vehicleV2h =
    scenario?.vehicle_v2h && typeof scenario.vehicle_v2h === "object"
      ? scenario.vehicle_v2h
      : {};
  if (vehicleV2h.enabled === true) {
    return (
      (num(e.physical_battery_discharge_kwh) ??
        num(scenario?.battery_discharge_kwh) ??
        num(battery.annual_discharge_kwh) ??
        0) +
      (num(vehicleV2h.ev_v2h_discharge_kwh) ?? num(e.ev_v2h_discharge_kwh) ?? 0) +
      (num(e.virtual_battery_discharge_kwh) ??
        num(e.used_credit_kwh) ??
        num(virtualBattery.annual_discharge_kwh) ??
        num(virtualBattery.restored_kwh) ??
        0)
    );
  }
  const inferredFromDirect =
    num(e.total_pv_used_on_site_kwh ?? e.autoconsumption_kwh ?? e.energy_solar_used_kwh ?? e.auto) != null &&
    num(e.direct_self_consumption_kwh) != null
      ? Math.max(
          0,
          num(e.total_pv_used_on_site_kwh ?? e.autoconsumption_kwh ?? e.energy_solar_used_kwh ?? e.auto) -
            num(e.direct_self_consumption_kwh)
        )
      : null;

  return (
    num(e.battery_discharge_kwh) ??
    num(e.physical_battery_discharge_kwh) ??
    num(scenario?.battery_discharge_kwh) ??
    num(scenario?.hardware?.battery_discharge_kwh) ??
    num(battery.annual_discharge_kwh) ??
    (inferredFromDirect != null && inferredFromDirect > 0 ? inferredFromDirect : null) ??
    num(e.virtual_battery_discharge_kwh) ??
    num(e.restored_kwh) ??
    num(e.used_credit_kwh) ??
    num(scenario?.used_credit_kwh) ??
    num(virtualBattery.annual_discharge_kwh) ??
    num(virtualBattery.restored_kwh) ??
    0
  );
}

function clampPctVal(x) {
  if (x == null || !Number.isFinite(Number(x))) return null;
  return Math.max(0, Math.min(100, Number(x)));
}

/** Autonomie site : 1 − import / conso (sans fallback auto/prod). */
function resolveSiteAutonomyPct(energy) {
  if (hasVirtualCreditEnergy(energy)) {
    const consoLocal = num(energy?.consumption_kwh ?? energy?.conso);
    const local = resolvePvUsedOnSiteKwhForPdf(energy);
    if (consoLocal != null && consoLocal > 0 && local != null && Number.isFinite(local)) {
      return clampPctVal((local / consoLocal) * 100);
    }
  }
  const conso = num(energy?.consumption_kwh ?? energy?.conso);
  const imp = canonicalGridImportKwh(energy);
  if (conso != null && conso > 0 && imp != null && Number.isFinite(imp)) {
    return clampPctVal((1 - imp / conso) * 100);
  }
  return clampPctVal(num(energy?.site_autonomy_pct));
}

/** Autoconsommation PV : part de la production valorisée sur site. */
function resolvePvSelfConsumptionPct(energy) {
  const prod = num(energy?.production_kwh ?? energy?.prod);
  const preset = clampPctVal(num(energy?.pv_self_consumption_pct));
  if (!hasVirtualCreditEnergy(energy) && preset != null) return preset;
  const total = resolvePvUsedOnSiteKwhForPdf(energy);
  if (prod == null || prod <= 0 || total == null || !Number.isFinite(total)) return null;
  return clampPctVal((total / prod) * 100);
}

/** Couverture besoins via PV (+ batterie) : total utilisé / conso. */
function resolveSiteCoverageFromPvPct(energy) {
  if (hasVirtualCreditEnergy(energy)) {
    const consoVirtual = num(energy?.consumption_kwh ?? energy?.conso);
    const coveredVirtual =
      num(energy?.site_solar_or_credit_used_kwh) ??
      coveredFromCanonicalImportKwh(energy) ??
      resolvePvUsedOnSiteKwhForPdf(energy);
    if (consoVirtual == null || consoVirtual <= 0 || coveredVirtual == null || !Number.isFinite(coveredVirtual)) {
      return null;
    }
    return clampPctVal((coveredVirtual / consoVirtual) * 100);
  }
  const preset = clampPctVal(num(energy?.solar_coverage_pct));
  if (!hasVirtualCreditEnergy(energy) && preset != null) return preset;
  const conso = num(energy?.consumption_kwh ?? energy?.conso);
  const total = resolvePvUsedOnSiteKwhForPdf(energy);
  if (conso == null || conso <= 0 || total == null || !Number.isFinite(total)) return null;
  return clampPctVal((total / conso) * 100);
}

/** Détail facture résiduelle BV (TTC) — même logique que selectedScenarioSnapshot. */
function buildResidualBillVirtualVmFromScenario(scenario) {
  const sid = scenario?.id ?? scenario?.scenario_type;
  if (!isVirtualLikeScenarioId(sid)) return null;
  const vf = scenario.virtual_battery_finance;
  if (!vf || typeof vf !== "object") return null;
  const e = scenario.energy || {};
  const impKwh = canonicalGridImportKwhForPdf(e);
  const residualBill = scenario.finance?.residual_bill_eur;
  const priceImplied =
    impKwh > 0 && residualBill != null && Number.isFinite(Number(residualBill))
      ? Number(residualBill) / impKwh
      : null;
  return {
    grid_import_kwh: Number.isFinite(impKwh) ? impKwh : null,
    energy_purchase_from_grid_eur:
      impKwh > 0 && priceImplied != null ? Math.round(impKwh * priceImplied * 100) / 100 : null,
    virtual_battery_subscription_ttc: vf.annual_subscription_ttc ?? null,
    virtual_battery_autoproducer_contribution_ttc: vf.annual_autoproducer_contribution_ttc ?? null,
    virtual_battery_discharge_fees_ttc: vf.annual_virtual_discharge_cost_ttc ?? null,
    virtual_battery_activation_ttc: vf.annual_activation_fee_ttc ?? null,
    activation_applies_note:
      (vf.annual_activation_fee_ttc ?? 0) > 0
        ? "Frais d'activation : première année contractuelle (TTC), si applicable."
        : null,
    supplier_subscription_eur: null,
    supplier_subscription_note:
      "Abonnement fournisseur (accès réseau, puissance souscrite) : non ventilé dans le moteur (hors hypothèse kWh projet).",
    discharge_fees_note:
      "Ligne « restitution stockage virtuel » : coûts associés aux kWh restitués (composantes fournisseur agrégées TTC).",
  };
}

/**
 * Prime à l'autoconsommation (PDF P2) — même règle que financeService :
 * priorité au montant d'année 1 dans les flux du scénario si présent, sinon
 * aucun recalcul depuis les settings organisation au rendu PDF.
 */
function resolvePdfPrimeAutoconsoEur({ systemPowerKw, scenarioForFinance, snapshot, economicSnapshotForPdf }) {
  const explicitPrime =
    num(economicSnapshotForPdf?.prime_eur) ??
    num(scenarioForFinance?.finance?.prime_autoconso_eur) ??
    num(scenarioForFinance?.finance?.prime_eur) ??
    num(scenarioForFinance?.finance?.aide_eur) ??
    num(snapshot?.finance?.prime_autoconso_eur) ??
    num(snapshot?.finance?.prime_eur) ??
    num(snapshot?.finance?.aide_eur);
  if (explicitPrime != null && Number.isFinite(explicitPrime) && explicitPrime >= 0) {
    return explicitPrime;
  }

  const flows =
    scenarioForFinance?.finance?.annual_cashflows ??
    (Array.isArray(scenarioForFinance?.cashflows) ? scenarioForFinance.cashflows : null);
  if (Array.isArray(flows) && flows.length > 0) {
    const y1 = flows.find((f) => num(f?.year) === 1) ?? flows[0];
    const p = num(y1?.prime);
    if (p != null && Number.isFinite(p) && p >= 0) return p;
  }
  const kwc = Number(systemPowerKw);
  const rate = num(economicSnapshotForPdf?.prime_rate_eur_kwc);
  if (Number.isFinite(kwc) && kwc > 0 && rate != null) return kwc * rate;
  return 0;
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
    const bill = canonicalGridImportKwhForPdf(e);
    if (bill != null && Number.isFinite(bill)) return bill;
  }
  const monthSum = sumMonthlyGridImportKwh(e);
  if (monthSum != null && Number.isFinite(monthSum) && monthSum >= 0) return monthSum;
  return numOrZero(canonicalGridImportKwhForPdf(e));
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
function formatEurKwh3(v) {
  if (v == null || !Number.isFinite(Number(v))) return "\u2014";
  return `${Number(v).toFixed(3).replace(".", ",")} \u20ac/kWh`;
}
function formatPctPerYear1(v) {
  if (v == null || !Number.isFinite(Number(v))) return "\u2014";
  return `${Number(v).toFixed(1).replace(".", ",")} %/an`;
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

function safeRatio(numerator, denominator) {
  const n = num(numerator);
  const d = num(denominator);
  if (n == null || d == null || d <= 0) return null;
  return n / d;
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
function annualGainsEurFromCashflows(flows, horizonYears = 25) {
  if (!Array.isArray(flows) || flows.length === 0) return null;
  const n = Math.max(1, Math.min(50, Math.floor(Number(horizonYears)) || 25));
  const out = [];
  let any = false;
  for (let i = 0; i < n; i++) {
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
  horizonYears = 25,
}) {
  const fin = normalizeQuoteFinancing(economicConfigJson, capex);
  const monthly = fin.enabled ? loanMonthlyPaymentEur(fin.amount, fin.interest_rate_annual, fin.duration_months) : null;
  const totalPaid =
    monthly != null && fin.duration_months > 0 ? Math.round(monthly * fin.duration_months) : null;

  const fromFlows = annualGainsEurFromCashflows(annualCashflows, horizonYears);
  const economies25 =
    fromFlows != null ? fromFlows : Array.from({ length: horizonYears }, () => numOrZero(annualSavings));

  const paiement25 = Array.from({ length: horizonYears }, (_, i) =>
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
    economies25.length > 0 ? economies25.reduce((a, b) => a + numOrZero(b), 0) / economies25.length : numOrZero(annualSavings);
  const resteMoyenMois =
    monthly != null ? Math.round(monthly - avgAnnualEco / 12) : null;

  const factureRestante = num(
    financeActive.facture_restante ?? financeActive.residual_bill_eur ?? financeSnapshot?.facture_restante
  );
  const resteChargeMoyenPost =
    factureRestante != null && Number.isFinite(factureRestante) ? Math.round(factureRestante / 12) : null;

  const p11 = {
    meta: { client: clientName, ref, date: dateDisplay, horizon_years_pdf: horizonYears },
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
        credit_cost_eur:
          totalPaid != null && fin.amount != null && Number.isFinite(Number(fin.amount))
            ? Math.max(0, Math.round(totalPaid - fin.amount))
            : null,
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
        credit_cost_eur:
          totalPaid != null && fin.amount != null && Number.isFinite(Number(fin.amount))
            ? Math.max(0, Math.round(totalPaid - fin.amount))
            : null,
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
function normalizeMonthlyConsumptionReference(input) {
  if (!input) return null;

  const direct = Array.isArray(input)
    ? input
    : Array.isArray(input.monthly_kwh)
      ? input.monthly_kwh
      : Array.isArray(input.monthly)
        ? input.monthly
        : Array.isArray(input.consumption_monthly)
          ? input.consumption_monthly
          : null;

  if (!Array.isArray(direct) || direct.length < MONTHS_COUNT) return null;

  const out = Array(MONTHS_COUNT).fill(0);
  const hasExplicitMonth = direct.some((row) => row && typeof row === "object" && num(row.month) != null);

  if (hasExplicitMonth) {
    for (const row of direct) {
      if (!row || typeof row !== "object") continue;
      const month = Math.floor(num(row.month) ?? 0);
      if (month < 1 || month > MONTHS_COUNT) continue;
      out[month - 1] = numOrZero(row.kwh ?? row.conso_kwh ?? row.conso ?? row.value);
    }
  } else {
    for (let i = 0; i < MONTHS_COUNT; i++) {
      const row = direct[i];
      out[i] =
        row && typeof row === "object"
          ? numOrZero(row.kwh ?? row.conso_kwh ?? row.conso ?? row.value)
          : numOrZero(row);
    }
  }

  return out.some((v) => v > 0) ? out : null;
}

function sumMonthly(monthly) {
  return Array.isArray(monthly)
    ? monthly.slice(0, MONTHS_COUNT).reduce((a, b) => a + numOrZero(b), 0)
    : 0;
}

function monthlySumsFrom8760(values) {
  if (!Array.isArray(values) || values.length < 8760) return null;
  const daysPerMonth = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  const out = [];
  let index = 0;
  for (const days of daysPerMonth) {
    let sum = 0;
    for (let h = 0; h < days * 24; h++, index++) {
      sum += Number(values[index]) || 0;
    }
    out.push(Math.round(sum));
  }
  return out.some((v) => v > 0) ? out : null;
}

function monthlyShapeSpread(monthly) {
  if (!Array.isArray(monthly) || monthly.length < MONTHS_COUNT) return 0;
  const values = monthly.slice(0, MONTHS_COUNT).map((v) => numOrZero(v)).filter((v) => v > 0);
  if (values.length === 0) return 0;
  const avg = values.reduce((a, b) => a + b, 0) / values.length;
  if (avg <= 0) return 0;
  return (Math.max(...values) - Math.min(...values)) / avg;
}

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
  const annualKwhFallbackSnapshot =
    num(production.annual_kwh) ?? num(installation.production_annuelle_kwh) ?? 0;

  const rootEconomicSnapshot =
    snapshot.economic_snapshot && typeof snapshot.economic_snapshot === "object"
      ? snapshot.economic_snapshot
      : null;
  let economicSnapshotForPdf = rootEconomicSnapshot;
  let econDisplay = frozenEconomicsForPdf(economicSnapshotForPdf);

  const scenariosArr = options.scenarios_v2 ?? [];
  const selectedKey = options.selected_scenario_id ?? snapshot.scenario_type ?? "BASE";
  const scenariosByKey = Object.fromEntries(
    (Array.isArray(scenariosArr) ? scenariosArr : []).map((s) => [s.id ?? s.name ?? "BASE", s])
  );
  const baseFromV2 = scenariosByKey.BASE || null;
  const batteryPhysicalGlobal = scenariosByKey.BATTERY_PHYSICAL || null;
  const batteryVirtualGlobal = scenariosByKey.BATTERY_VIRTUAL || null;
  const selectedScenarioFromV2 = scenariosByKey[selectedKey] ?? null;
  const snapshotScenarioKey = str(snapshot.scenario_type ?? snapshot.id ?? snapshot.name);
  const useSnapshotAsSelected = !snapshotScenarioKey || snapshotScenarioKey === selectedKey;
  const selectedSnapshotEnergy = useSnapshotAsSelected ? energy : {};
  const selectedSnapshotFinance = useSnapshotAsSelected ? finance : {};
  const selectedSnapshotProduction = useSnapshotAsSelected ? production : {};
  const selectedSnapshotHardware = useSnapshotAsSelected ? hardware : {};
  const selectedScenario = {
    ...(selectedScenarioFromV2 && typeof selectedScenarioFromV2 === "object" ? selectedScenarioFromV2 : {}),
    id: selectedKey,
    name: selectedKey,
    scenario_type: selectedKey,
    energy: {
      ...(selectedScenarioFromV2?.energy && typeof selectedScenarioFromV2.energy === "object"
        ? selectedScenarioFromV2.energy
        : {}),
      ...selectedSnapshotEnergy,
    },
    finance: {
      ...(selectedScenarioFromV2?.finance && typeof selectedScenarioFromV2.finance === "object"
        ? selectedScenarioFromV2.finance
        : {}),
      ...selectedSnapshotFinance,
      annual_cashflows:
        useSnapshotAsSelected && Array.isArray(finance.annual_cashflows)
          ? finance.annual_cashflows
          : useSnapshotAsSelected && Array.isArray(snapshot.cashflows)
            ? snapshot.cashflows
            : Array.isArray(selectedScenarioFromV2?.finance?.annual_cashflows)
              ? selectedScenarioFromV2.finance.annual_cashflows
              : [],
    },
    production: {
      ...(selectedScenarioFromV2?.production && typeof selectedScenarioFromV2.production === "object"
        ? selectedScenarioFromV2.production
        : {}),
      ...selectedSnapshotProduction,
    },
    hardware: {
      ...(selectedScenarioFromV2?.hardware && typeof selectedScenarioFromV2.hardware === "object"
        ? selectedScenarioFromV2.hardware
        : {}),
      ...selectedSnapshotHardware,
    },
    cashflows: useSnapshotAsSelected && Array.isArray(snapshot.cashflows)
      ? snapshot.cashflows
      : Array.isArray(selectedScenarioFromV2?.cashflows)
        ? selectedScenarioFromV2.cashflows
        : [],
  };

  const batteryHybridGlobal = scenariosByKey.BATTERY_HYBRID || null;

  let pdfBatteryScenario = null;
  let pdfBatteryType = null;
  if (selectedKey === "BATTERY_VIRTUAL" && batteryVirtualGlobal) {
    pdfBatteryScenario = batteryVirtualGlobal;
    pdfBatteryType = "VIRTUAL";
  } else if (selectedKey === "BATTERY_PHYSICAL" && batteryPhysicalGlobal) {
    pdfBatteryScenario = batteryPhysicalGlobal;
    pdfBatteryType = "PHYSICAL";
  } else if (selectedKey === "BATTERY_HYBRID" && batteryHybridGlobal) {
    // HYBRID : utilise ses propres données — pas de fallback silencieux vers BATTERY_VIRTUAL
    pdfBatteryScenario = batteryHybridGlobal;
    pdfBatteryType = "HYBRID";
  } else if (selectedKey === "BASE") {
    pdfBatteryScenario = null;
    pdfBatteryType = null;
  }
  const isVehicleV2hSelected = isVehicleV2hScenarioId(selectedKey);

  const canonicalAnnualProductionKwh =
    num(selectedScenario?.production?.annual_kwh) ??
    num(selectedScenario?.energy?.production_kwh) ??
    num(energy.production_kwh) ??
    annualKwhFallbackSnapshot;

  let annualKwh = canonicalAnnualProductionKwh;
  let monthly = normalizeMonthlyProduction(
    Array.isArray(selectedScenario?.production?.monthly_kwh)
      ? selectedScenario.production.monthly_kwh
      : production.monthly_kwh
  );
  const monthlyProdSumInit = monthly.reduce((a, b) => a + numOrZero(b), 0);
  if (monthlyProdSumInit < 0.01 && annualKwh > 0.01) {
    monthly = uniformMonthly12FromTotal(annualKwh);
  } else if (annualKwh > 0.01 && monthlyProdSumInit > 0.01) {
    const diff = Math.abs(monthlyProdSumInit - annualKwh);
    if (diff > 1 && diff / annualKwh > 0.02) {
      const scale = annualKwh / monthlyProdSumInit;
      monthly = monthly.map((m) => Math.round(numOrZero(m) * scale));
      const s2 = monthly.reduce((a, b) => a + b, 0);
      monthly[MONTHS_COUNT - 1] = Math.round(monthly[MONTHS_COUNT - 1] + (annualKwh - s2));
    }
  }
  const specificYield = systemPowerKw > 0 && annualKwh > 0 ? annualKwh / systemPowerKw : 0;

  const scenarioForFinance = selectedScenario;
  const scenarioFinance =
    scenarioForFinance && typeof scenarioForFinance.finance === "object" && scenarioForFinance.finance !== null
      ? scenarioForFinance.finance
      : null;
  const financeActive =
    useSnapshotAsSelected && finance && typeof finance === "object"
      ? finance
      : (scenarioFinance ?? {});
  const snapshotElecGrowth =
    num(financeActive?.finance_meta?.elec_growth_pct) ??
    num(scenarioFinance?.finance_meta?.elec_growth_pct) ??
    num(snapshot.assumptions?.elec_growth_pct);
  if (!economicSnapshotForPdf && financeActive?.finance_meta?.economic_snapshot) {
    economicSnapshotForPdf = financeActive.finance_meta.economic_snapshot;
    econDisplay = frozenEconomicsForPdf(economicSnapshotForPdf);
  } else if (!economicSnapshotForPdf && scenarioFinance?.finance_meta?.economic_snapshot) {
    economicSnapshotForPdf = scenarioFinance.finance_meta.economic_snapshot;
    econDisplay = frozenEconomicsForPdf(economicSnapshotForPdf);
  }
  if (econDisplay.elec_growth_pct == null && snapshotElecGrowth != null) {
    econDisplay = { ...econDisplay, elec_growth_pct: snapshotElecGrowth };
  }

  const clientName =
    str(client.full_name) ||
    [str(client.prenom), str(client.nom)].filter(Boolean).join(" ") ||
    str(meta.client_nom) ||
    "";
  const ref = options.studyNumber || "—";
  const dateDisplay = formatDateFr(snapshot.computed_at) || formatDateFr(snapshot.created_at) || "";
  const energyForKpis =
    scenarioForFinance?.energy && typeof scenarioForFinance.energy === "object"
      ? { ...energy, ...scenarioForFinance.energy }
      : energy;
  const autonomyPct =
    num(energyForKpis.site_autonomy_pct) ??
    num(energyForKpis.energy_independence_pct) ??
    num(energyForKpis.independence_pct) ??
    resolveSiteAutonomyPct(energyForKpis);
  const solarCoveragePctForSummary =
    resolveSiteCoverageFromPvPct(energyForKpis) ??
    autonomyPct;
  const pvSelfConsumptionPct = resolvePvSelfConsumptionPct(energyForKpis);
  const selfConsumptionPct = pvSelfConsumptionPct;

  const puissanceKva = num(formParams.puissance_kva) ?? num(site.puissance_compteur_kva);
  const reseauType = str(formParams.reseau_type) || str(site.type_reseau) || "";
  // Conso annuelle : fallback robuste (priorité 1→4), valeur numérique ou null
  const horizonYearsPdf =
    Number(
      financeActive.economie_horizon_years ??
        financeActive.finance_meta?.horizon_years ??
        scenarioFinance?.economie_horizon_years ??
        scenarioFinance?.finance_meta?.horizon_years ??
        econDisplay.horizon_years
    ) || 25;
  const consoAnnuelle =
    num(conso.annual_kwh) ??
    num(energy.consumption_kwh) ??
    num(form.conso?.annuelle_kwh) ??
    num(meta.annual_consumption_kwh) ??
    null;
  const economieTotal =
    cumulEurEndFromScenario(scenarioForFinance) ??
    num(financeActive.gain_25a) ??
    num(financeActive.economie_25a) ??
    num(financeActive.economie_total) ??
    numOrZero(financeActive.economie_year_1) * horizonYearsPdf;
  const irrPct = num(financeActive.irr_pct);
  const capexRaw = num(econDisplay.capex_ttc) ?? num(financeActive.capex_ttc);
  const capex = numOrZero(capexRaw);

  const p1_auto = {
    p1_client: clientName || "—",
    p1_ref: ref,
    p1_date: dateDisplay || "—",
    p1_why: "Étude photovoltaïque personnalisée",
    p1_m_kwc: formatKwC(systemPowerKw) || systemPowerKw,
    p1_m_auto: solarCoveragePctForSummary != null ? roundPercent(solarCoveragePctForSummary) : null,
    p1_m_gain: formatCurrency0(economieTotal) || formatCurrency0(numOrZero(financeActive.economie_year_1) * horizonYearsPdf),
    p1_k_puissance: formatKwC(num(hardware.kwc) ?? systemPowerKw),
    p1_k_autonomie: roundPercent(solarCoveragePctForSummary ?? num(energy.energy_independence_pct)),
    p1_k_tri: oneDecimalPercent(irrPct),
    p1_k_gains: formatCurrency0(economieTotal),
    p1_k_gains_label: `Gains (${horizonYearsPdf} ans)`,
    p1_k_capex: capexRaw != null ? formatCurrency0(capexRaw) : null,
    p1_param_kva: puissanceKva != null ? `${puissanceKva} kVA` : "",
    p1_param_reseau: reseauType === "mono" ? "Monophasé" : reseauType === "tri" ? "Triphasé" : reseauType || "—",
    p1_param_conso: consoAnnuelle,
  };

  const roiYears = Math.max(0, numOrZero(financeActive.roi_years));
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
  // FIX cohérence projection 25 ans : la "facture avec solaire" doit inclure TOUS les coûts annuels
  // du scénario, pas seulement l'achat réseau. Pour la batterie virtuelle/hybride, ajouter le coût
  // de service (abonnement stockage + contribution + restitution/déstockage), sinon la facture avec
  // solaire est sous-estimée (≈212 €/an au lieu de ≈767 €/an) → gains gonflés.
  const vbAnnualServiceCostTtc = numOrZero(
    financeActive.virtual_battery_finance?.annual_total_virtual_cost_ttc ??
      finance.virtual_battery_finance?.annual_total_virtual_cost_ttc ??
      // FIX « Coût batterie virtuelle/an : 0 € » — les finances issues de scenarios_v2 ne portent
      // pas virtual_battery_finance mais exposent le total annuel du service (abonnement stockage
      // + contribution + restitution) via virtual_battery_cost_annual (scenarioV2Mapper).
      financeActive.virtual_battery_cost_annual ??
      finance.virtual_battery_cost_annual ??
      financeActive._virtualBatteryQuote?.annual_cost_ttc ??
      finance._virtualBatteryQuote?.annual_cost_ttc
  );
  const annualBillWithSolar = factureRestante + vbAnnualServiceCostTtc;
  // ── FIX BASELINE COMMUNE + JALONS RÉELS (audit Bedouelle 2026-07-03) ────────────
  // Avant : « Avec solaire » = facture an 1 × horizon (PLAT, non indexé) et « Sans
  // solaire » reconstruit algébriquement (éco nette + avec + capex) → la baseline
  // dépendait du scénario (109 620 € en 12 kWc vs 98 356 € en 9 kWc, même client !)
  // et les jalons 5/10/15/20 ans (règle de trois engine-p2) contredisaient le ROI.
  // Après :
  //   • sans_Y  = facture an 1 SANS solaire (définition moteur : economie_an1 =
  //     facture_avant − facture_après) indexée elec_growth_pct — identique pour
  //     toutes les variantes d'un même client ;
  //   • eco_Y   = cumul_gains_eur[Y] de la VRAIE série annual_cashflows (celle qui
  //     alimente déjà ROI/TRI et la page « Gains nets » → cohérence garantie) ;
  //   • avec_Y  = sans_Y − eco_Y.
  // Fallback intégral sur l'ancienne reconstruction si série/baseline absentes.
  const _p2Flows = (() => {
    const f =
      scenarioForFinance?.finance?.annual_cashflows ??
      (Array.isArray(scenarioForFinance?.cashflows) ? scenarioForFinance.cashflows : null);
    return Array.isArray(f) ? f : [];
  })();
  const _p2CumulGainsAtYear = (y) => {
    if (_p2Flows.length === 0) return null;
    const row =
      _p2Flows.find((f) => num(f?.year) === y) ??
      (_p2Flows.length >= y ? _p2Flows[y - 1] : null);
    if (!row) return null;
    // Deux formes possibles : moteur (cumul_gains_eur) ou snapshot (cumul_gains)
    return num(row.cumul_gains_eur ?? row.cumul_gains);
  };
  const _p2EcoAn1 = num(financeActive.economie_an1) ?? num(financeActive.economie_year_1);
  const _p2PriceEffConso =
    num(scenarioForFinance?.pricing?.p_eff_conso) ??
    num(econDisplay.price_eur_kwh);
  // Priorité : conso × prix effectif (source unique, strictement commune aux variantes) ;
  // sinon reconstruction par la définition moteur de l'économie an 1.
  const _p2BillBeforeY1 =
    (consoAnnuelle != null && _p2PriceEffConso != null
      ? consoAnnuelle * _p2PriceEffConso
      : null) ??
    (_p2EcoAn1 != null ? _p2EcoAn1 + annualBillWithSolar : null);
  const _p2Growth = (snapshotElecGrowth ?? 0) / 100;
  const _p2BaselineCumulAtYear = (y) => {
    if (_p2BillBeforeY1 == null || !(y > 0)) return null;
    const cumul =
      _p2Growth !== 0
        ? _p2BillBeforeY1 * ((Math.pow(1 + _p2Growth, y) - 1) / _p2Growth)
        : _p2BillBeforeY1 * y;
    return Math.round(cumul);
  };
  const _p2Baseline25 = _p2BaselineCumulAtYear(horizonYearsPdf);
  const _p2CumulGains25 = _p2CumulGainsAtYear(horizonYearsPdf);
  const _p2UseRealSeries = _p2Baseline25 != null && _p2CumulGains25 != null;

  let gridCostWithoutSolar;
  let gridCostWithSolar;
  let economieGross;
  if (_p2UseRealSeries) {
    gridCostWithoutSolar = _p2Baseline25;
    economieGross = Math.round(_p2CumulGains25);
    gridCostWithSolar = Math.max(0, gridCostWithoutSolar - economieGross);
  } else {
    gridCostWithSolar = Math.round(annualBillWithSolar * horizonYearsPdf);
    gridCostWithoutSolar = Math.round(economieTotal + gridCostWithSolar + capex);
    // Économie brute = différence pure de factures électricité (sans investissement)
    economieGross = gridCostWithoutSolar - gridCostWithSolar;
  }

  // Jalons explicites 5/10/15/20/25 ans → engine-p2 (fallback règle de trois sinon).
  const p2Milestones = {};
  if (_p2UseRealSeries) {
    for (const y of [5, 10, 15, 20, 25]) {
      const yEff = Math.min(y, horizonYearsPdf);
      const sansY = _p2BaselineCumulAtYear(yEff);
      const ecoY = _p2CumulGainsAtYear(yEff);
      if (sansY == null || ecoY == null) continue;
      p2Milestones[`p2_sans_${y}`] = formatCurrency0(sansY);
      p2Milestones[`p2_eco_${y}`] = formatCurrency0(Math.round(ecoY));
      p2Milestones[`p2_avec_${y}`] = formatCurrency0(Math.max(0, sansY - Math.round(ecoY)));
    }
  }

  const primeAmount = resolvePdfPrimeAutoconsoEur({
    systemPowerKw,
    scenarioForFinance,
    snapshot,
    economicSnapshotForPdf,
  });
  const resteACharge =
    econDisplay.reste_a_charge_eur != null
      ? Math.max(0, Math.round(econDisplay.reste_a_charge_eur))
      : Math.max(0, Math.round(capex - primeAmount));

  const lcoeVal =
    systemPowerKw > 0 && annualKwh > 0 && horizonYearsPdf > 0
      ? capex / (annualKwh * horizonYearsPdf)
      : null;

  const p2_auto = {
    p2_client: clientName,
    p2_ref: ref,
    p2_date: dateDisplay,
    p2_sans_solaire: formatCurrency0(gridCostWithoutSolar),
    p2_avec_solaire: formatCurrency0(gridCostWithSolar),
    // Jalons réels 5/10/15/20/25 ans (baseline commune indexée + série moteur).
    // L'engine-p2 les utilise s'ils sont présents ; sinon fallback règle de trois.
    ...p2Milestones,
    // p2_economie_totale = économie BRUTE (sans_solaire - avec_solaire)
    // Garantit que eco_Y = sans_Y - avec_Y pour chaque jalon de l'engine-p2.js
    p2_economie_totale: formatCurrency0(economieGross),
    // p2_economie_nette = position nette APRÈS capex (bénéfice réel de l'investissement)
    p2_economie_nette: formatCurrency0(economieTotal),
    p2_tri: num(financeActive.irr_pct) != null ? `${num(financeActive.irr_pct).toFixed(1)} %` : "—",
    p2_roi: `${roiYears} ans`,
    p2_lcoe: lcoeVal != null ? `${lcoeVal.toFixed(3).replace(".", ",")} €/kWh` : "—",
    p2_prime: formatCurrency0(primeAmount),
    p2_prime_raw_eur: Math.round(primeAmount),
    p2_reste_charge: formatCurrency0(resteACharge),
    p2_reste_charge_raw_eur: resteACharge,
    p2_investissement_ttc: formatCurrency0(capex),
    p2_investissement_ttc_raw_eur: Math.round(capex),
    p2_price_kwh: formatEurKwh3(econDisplay.price_eur_kwh),
    p2_indexation: formatPctPerYear1(econDisplay.elec_growth_pct),
    p2_horizon: `${horizonYearsPdf} ans`,
    p2_surplus_rate: formatEurKwh3(econDisplay.oa_rate_eur_kwh),
    p2_scenario_label: SCENARIO_LABELS[selectedKey] || str(selectedKey),
    // Production page 2 = production du scénario sélectionné (celle des cartes, ~9114 kWh),
    // et non annualKwh qui peut provenir d'un champ "production.annual_kwh" légèrement différent
    // (gross/théorique ~9161) → harmonisation : même chiffre partout.
    p2_production: (() => {
      const p2Prod = num(selectedScenario?.energy?.production_kwh) ?? num(energy?.production_kwh) ?? annualKwh;
      return p2Prod > 0 ? `${Math.round(p2Prod).toLocaleString("fr-FR")} kWh` : "—";
    })(),
  };

  // ── P_SHADING — Analyse d'ombrage ─────────────────────────────────────────
  const _pvgisRef    = shading.pvgisReference ?? {};
  const _horizonMask = shading.horizonMask    ?? {};
  const _far         = shading.far            ?? {};

  const _prodNoShading = Array.isArray(shading.monthlyKwhStats)
    ? Math.round(shading.monthlyKwhStats.reduce((s, m) => s + (m.productionNoShadingKwh ?? 0), 0))
    : (_pvgisRef.annualE_y != null && _pvgisRef.peakPowerKwc != null)
      ? Math.round(_pvgisRef.annualE_y * _pvgisRef.peakPowerKwc)
      : null;

  const _prodWithShading = Array.isArray(shading.monthlyKwhStats)
    ? Math.round(shading.monthlyKwhStats.reduce((s, m) => s + (m.productionWithShadingKwh ?? 0), 0))
    : null;

  const _prixKwh = econDisplay.price_eur_kwh;

  const p_shading = {
    meta: { client: clientName, ref, date: dateDisplay },
    // KPI niveau 1 — lecture client
    prodNoShadingKwh:   _prodNoShading,
    prodWithShadingKwh: _prodWithShading,
    annualLossKwh:      shading.annualLossKwh != null ? Math.round(shading.annualLossKwh) : null,
    annualLossEur:      (shading.annualLossKwh != null && _prixKwh != null)
                          ? Math.round(shading.annualLossKwh * _prixKwh) : null,
    // KPI niveau 2 — lecture technicien
    combinedLossPct:    num(shading.combinedLossPct ?? shading.combined?.totalLossPct),
    farLossPct:         shading.farLossPct != null ? num(shading.farLossPct) : null,
    nearLossPct:        num(shading.nearLossPct ?? shading.near?.totalLossPct),
    // Qualité données
    farHorizonKind:     _horizonMask.farHorizonKind ?? shading.farHorizonKind ?? "UNAVAILABLE",
    farConfidenceLevel: _far.confidenceLevel ?? null,
    farSource:          _far.source ?? null,
    // Tableau mensuel kWh
    monthlyKwhStats: Array.isArray(shading.monthlyKwhStats)
      ? shading.monthlyKwhStats.map((m) => ({
          month:             m.month,
          prodNoShadingKwh:  m.productionNoShadingKwh,
          prodWithShadingKwh: m.productionWithShadingKwh,
          kwhLoss:           m.kwhLoss,
          lossPct:           m.combinedLossFraction != null
                               ? +(m.combinedLossFraction * 100).toFixed(1) : null,
        }))
      : null,
    // Facteurs mensuels far/near (graphique barres Sprint 2)
    monthlyFactors: Array.isArray(shading.monthlyFactors)
      ? shading.monthlyFactors.map((m) => ({
          month:       m.month,
          farPct:      m.farLossFraction  != null ? +(m.farLossFraction  * 100).toFixed(1) : 0,
          nearPct:     m.nearLossFraction != null ? +(m.nearLossFraction * 100).toFixed(1) : 0,
          combinedPct: m.combinedLossFraction != null ? +(m.combinedLossFraction * 100).toFixed(1) : 0,
        }))
      : null,
    // Métadonnées PVGIS
    pvgisSource:     _pvgisRef.source     ?? null,
    pvgisTiltDeg:    _pvgisRef.tiltDeg    != null ? num(_pvgisRef.tiltDeg)    : null,
    pvgisAzimuthDeg: _pvgisRef.azimuthDeg != null ? num(_pvgisRef.azimuthDeg) : null,
    // Contexte site
    peakPowerKwc: num(installation.puissance_kwc),
    lat: site.lat != null ? num(site.lat) : null,
    lon: site.lon != null ? num(site.lon) : null,
    // Masque horizon brut (profil SVG Sprint 3)
    horizonMaskArray: Array.isArray(_horizonMask.mask) ? _horizonMask.mask : null,
  };

  const orientationMap = { S: "Sud", SE: "Sud-Est", SO: "Sud-Ouest", SW: "Sud-Ouest", E: "Est", O: "Ouest", W: "Ouest" };
  /* Orientation / inclinaison affichées au client :
     1. référence PVGIS (azimut/inclinaison réellement utilisés pour le calcul de production —
        convention 0 = Nord, 180 = Sud, cohérente avec la rose des vents du moteur p3b) ;
     2. sinon lettre cardinale saisie (S/SO/…) mappée en toutes lettres ;
     3. sinon "—" : un azimut numérique d'origine inconnue a déjà produit un cardinal faux
        (toit Sud-Ouest affiché Ouest-Nord-Ouest) — mieux vaut absent que faux. */
  const _p3bTilt = num(_pvgisRef.tiltDeg) ?? num(site.tilt_deg);
  const _p3bAzimuth =
    num(_pvgisRef.azimuthDeg) ??
    /* fallback : azimut numérique du snapshot — fiable après revalidation du calpinage
       (NORTH-FALLBACK-FIX) ; les dossiers non revalidés affichent leur valeur stockée. */
    num(site.orientation_deg);
  const _p3bOrientationLetter = orientationMap[String(site.orientation_deg || "").toUpperCase()] || null;
  /* FIX « Nord (0°) » (audit Bedouelle 2026-07-03) — sur toiture plate (tilt ≈ 0°),
     l'azimut du SUPPORT est une valeur par défaut sans signification : l'engine p3b la
     convertissait en « Nord (0°) », catastrophique à lire pour le client. Sur toit plat :
       1. si le calepinage phase 3 porte un système de pose lesté validé
          (options.flat_roof_mounting, snapshot Lot A) → orientation réelle des MODULES
          (sud simple + inclinaison imposée par le système) ;
       2. sinon → mention neutre « Toiture plate — non significative ».
     Les valeurs textuelles traversent formatOrientation() sans transformation.
     L'inclinaison reste celle du SUPPORT (libellé de la carte : « Inclinaison (support) »). */
  // LOT D — matériel de pose toit plat : lignes PDF depuis le snapshot Lot A
  // (options.flat_roof_mounting, déjà validé structurellement côté extraction ;
  // [] / "" quand absent → rien d'affiché, rétrocompat totale). Calculé ici (avant
  // p3b_auto) et réutilisé par `offer` plus bas.
  const _flatRoofMountingPdf = formatFlatRoofMountingForPdf(options.flat_roof_mounting ?? null);
  const _p3bFlatMountingList = Array.isArray(options.flat_roof_mounting)
    ? options.flat_roof_mounting
    : null;
  const _p3bFlatMounting =
    _p3bFlatMountingList && _p3bFlatMountingList.length > 0 ? _p3bFlatMountingList[0] : null;
  const _p3bIsFlat = _p3bTilt != null && Math.abs(_p3bTilt) < 1;
  const _p3bOrientationDisplay = _p3bIsFlat
    ? _p3bFlatMounting
      ? `Sud — modules inclinés ${_p3bFlatMounting.tilt_deg}° (${_p3bFlatMounting.brand})`
      : "Toiture plate — non significative"
    : _p3bAzimuth != null
      ? _p3bAzimuth
      : (_p3bOrientationLetter || "");
  // Multi-pan : si plusieurs pans portent des panneaux, afficher toutes les orientations
  // sur une seule ligne (ex. « Sud-Ouest 215° · Nord 5° ») au lieu du seul pan principal.
  const _CARDINALS_FR_16 = [
    "Nord", "Nord-Nord-Est", "Nord-Est", "Est-Nord-Est", "Est", "Est-Sud-Est", "Sud-Est", "Sud-Sud-Est",
    "Sud", "Sud-Sud-Ouest", "Sud-Ouest", "Ouest-Sud-Ouest", "Ouest", "Ouest-Nord-Ouest", "Nord-Ouest", "Nord-Nord-Ouest",
  ];
  const _azToCardinalFr = (deg) => {
    const nAz = Number(deg);
    if (!Number.isFinite(nAz)) return null;
    const aAz = ((nAz % 360) + 360) % 360;
    return `${_CARDINALS_FR_16[Math.round(aAz / 22.5) % 16]} ${Math.round(aAz)}°`;
  };
  const _installPans = Array.isArray(installation.pans) ? installation.pans : [];
  const _panOrientDisplays = _installPans
    .filter((pp) => Number(pp?.panel_count) > 0 && Number.isFinite(Number(pp?.azimuth_deg)))
    .map((pp) => _azToCardinalFr(pp.azimuth_deg))
    .filter(Boolean);
  const _p3bOrientationMulti = _panOrientDisplays.length >= 2 ? _panOrientDisplays.join(" · ") : null;
  const p3b_auto = {
    client: clientName,
    ref,
    date: dateDisplay,
    inclinaison: _p3bTilt != null ? `${_p3bTilt}°` : "",
    orientation: (!_p3bIsFlat && _p3bOrientationMulti) ? _p3bOrientationMulti : _p3bOrientationDisplay,
    surface_m2: num(installation.surface_panneaux_m2) ?? (numOrZero(installation.panneaux_nombre) * 2),
    nb_panneaux: numOrZero(installation.panneaux_nombre),
    layout_snapshot: options.calpinage_layout_snapshot ?? null,
    // LOT D bis — système de pose toit plat, affiché sur la page calepinage
    // (le devis technique le porte déjà ; le dossier PDF doit dire la même chose).
    systemes_pose: _flatRoofMountingPdf.lines,
    systeme_pose_note: _flatRoofMountingPdf.note,
    // Architecture électrique (micro-onduleurs) — data-driven, null si non applicable.
    // Répond à « le dossier affiche 12 kWc tri mais ne prouve pas l'architecture AC » :
    // nombre de micros, ratio, répartition par phase. Le détail protections/sections
    // reste à la préparation technique (mention prudente côté frontend).
    elec_architecture: (() => {
      const model = [str(onduleur.marque), str(onduleur.modele)].filter(Boolean).join(" ").trim();
      const nbPanneaux = numOrZero(installation.panneaux_nombre);
      if (!model || nbPanneaux <= 0) return null;
      const isMicro = /\bMI[\s-]?\d|micro/i.test(model);
      if (!isMicro) return null;
      // Atmoce MI1000 : 1 micro-onduleur pour 2 panneaux. Autres micros : ratio inconnu → non affiché.
      const panelsPerMicro = /MI[\s-]?1000/i.test(model) ? 2 : null;
      const microCount = panelsPerMicro ? Math.ceil(nbPanneaux / panelsPerMicro) : null;
      const isTri = reseauType === "tri";
      return {
        onduleur_label: model,
        nb_micro: microCount,
        panels_per_micro: panelsPerMicro,
        reseau: isTri ? "Triphasé" : reseauType === "mono" ? "Monophasé" : null,
        par_phase:
          isTri && microCount != null && microCount % 3 === 0 ? microCount / 3 : null,
      };
    })(),
  };

  const consumptionKwh = num(energy.consumption_kwh) ?? consoAnnuelle ?? 0;
  const economieAn1 = numOrZero(financeActive.economie_year_1);
  const annualSavingsNetFromBills =
    _p2BillBeforeY1 != null && Number.isFinite(_p2BillBeforeY1)
      ? Math.max(0, Math.round(_p2BillBeforeY1 - annualBillWithSolar))
      : null;
  const annualSavings =
    isVirtualLikeScenarioId(selectedKey) && annualSavingsNetFromBills != null
      ? annualSavingsNetFromBills
      : Math.max(0, economieAn1);

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
    economicConfigJson: frozenEconomicConfigForP11(economicSnapshotForPdf),
    annualCashflows: annualCashflowsForP11,
    horizonYears: horizonYearsPdf,
  });

  const energyP10 =
    scenarioForFinance?.energy && typeof scenarioForFinance.energy === "object"
      ? scenarioForFinance.energy
      : energy;
  const autonomyPctP10 =
    resolveSiteCoverageFromPvPct(energyP10) ??
    num(energyP10.solar_coverage_pct) ??
    num(energyP10.self_production_pct) ??
    resolveSiteAutonomyPct(energyP10);
  const selfConsumptionPctP10 = resolvePvSelfConsumptionPct(energyP10);

  // P4 mensuel : priorité energy.monthly du scénario (scenarios_v2), sinon répartition uniforme (somme = annuel)
  let consoMonthly;
  let autoMonthly;
  let surplusMonthly;
  let consumptionMonthlyMissing = false;
  const scenarioMonthly =
    (Array.isArray(selectedScenario?.energy?.monthly) ? selectedScenario.energy.monthly : null) ??
    (Array.isArray(energy?.monthly) ? energy.monthly : null) ??
    (Array.isArray(snapshot.monthly) ? snapshot.monthly : null);
  const isBatteryScenario = isStorageScenarioId(selectedKey);

  if (Array.isArray(scenarioMonthly) && scenarioMonthly.length >= 12) {
    consoMonthly = scenarioMonthly.slice(0, 12).map((m) => numOrZero(m.conso_kwh ?? m.conso));
    autoMonthly = scenarioMonthly.slice(0, 12).map((m) => numOrZero(m.auto_kwh ?? m.auto));
    surplusMonthly = scenarioMonthly.slice(0, 12).map((m) => numOrZero(m.surplus_kwh ?? m.surplus));
  } else {
    consumptionMonthlyMissing = true;
    const annualConsoForMonthly =
      num(selectedScenario?.energy?.consumption_kwh ?? selectedScenario?.energy?.conso) ??
      num(energy?.consumption_kwh ?? energy?.conso) ??
      num(consumptionKwh) ??
      0;
    const annualAutoForMonthly =
      num(selectedScenario?.energy?.total_pv_used_on_site_kwh) ??
      num(selectedScenario?.energy?.autoconsumption_kwh) ??
      num(selectedScenario?.energy?.auto) ??
      num(energy?.total_pv_used_on_site_kwh) ??
      num(energy?.autoconsumption_kwh) ??
      num(energy?.auto) ??
      0;
    const annualSurplusForMonthly =
      num(selectedScenario?.energy?.exported_kwh) ??
      num(selectedScenario?.energy?.surplus_kwh ?? selectedScenario?.energy?.surplus) ??
      Math.max(0, (num(selectedScenario?.energy?.production_kwh ?? selectedScenario?.energy?.prod) ?? annualKwh) - annualAutoForMonthly);
    const monthlyProdSum = monthly.reduce((a, b) => a + numOrZero(b), 0);
    consoMonthly = Array(MONTHS_COUNT).fill(0);
    autoMonthly =
      monthlyProdSum > 0
        ? monthly.map((m) => (numOrZero(m) / monthlyProdSum) * annualAutoForMonthly)
        : uniformMonthly12FromTotal(annualAutoForMonthly);
    surplusMonthly =
      monthlyProdSum > 0
        ? monthly.map((m) => (numOrZero(m) / monthlyProdSum) * annualSurplusForMonthly)
        : uniformMonthly12FromTotal(annualSurplusForMonthly);
  }

  const hourlyMonthlyConsumption = monthlySumsFrom8760(options.p5_conso_hourly_kw_8760);
  const referencedMonthlyConsumption =
    normalizeMonthlyConsumptionReference(options.consumption_monthly_reference) ??
    normalizeMonthlyConsumptionReference(conso.monthly_kwh_ref) ??
    normalizeMonthlyConsumptionReference(conso.mensuelle) ??
    normalizeMonthlyConsumptionReference(form.conso?.mensuelle) ??
    normalizeMonthlyConsumptionReference(form.conso?.monthly_kwh_ref) ??
    normalizeMonthlyConsumptionReference(snapshot.meta?.conso_monthly_kwh_ref) ??
    normalizeMonthlyConsumptionReference(snapshot.study_meter?.snapshot?.consumption_monthly) ??
    normalizeMonthlyConsumptionReference(snapshot.study_meter?.snapshot?.consumption_monthly_kwh);
  const officialMonthlyConsumption = hourlyMonthlyConsumption ?? referencedMonthlyConsumption;
  let p4ConsoMonthlyOverride = null;
  let p4ConsumptionMonthlySource = Array.isArray(scenarioMonthly) && scenarioMonthly.length >= 12
    ? "scenario_monthly"
    : "annual_uniform";
  if (officialMonthlyConsumption) {
    const officialSum = sumMonthly(officialMonthlyConsumption);
    const currentSum = sumMonthly(consoMonthly);
    const officialSpread = monthlyShapeSpread(officialMonthlyConsumption);
    const currentSpread = monthlyShapeSpread(consoMonthly);
    const officialIsFlatFallback = hourlyMonthlyConsumption == null && officialSpread < 0.02 && currentSpread > 0.08;
    const annualRef =
      num(selectedScenario?.energy?.consumption_kwh ?? selectedScenario?.energy?.conso) ??
      num(energy?.consumption_kwh ?? energy?.conso) ??
      num(consoAnnuelle) ??
      num(consumptionKwh) ??
      officialSum;
    if (officialSum > 0 && !officialIsFlatFallback) {
      p4ConsoMonthlyOverride = officialMonthlyConsumption.slice(0, MONTHS_COUNT);
      consoMonthly = p4ConsoMonthlyOverride.slice(0, MONTHS_COUNT);
      p4ConsumptionMonthlySource = hourlyMonthlyConsumption
        ? "enedis_hourly_monthly"
        : "official_meter_monthly_override";
    }
    console.log("PDF_P4_CONSUMPTION_MONTHLY", {
      source: p4ConsumptionMonthlySource,
      skipped_flat_reference: officialIsFlatFallback,
      annual_ref_kwh: Math.round(annualRef),
      current_sum_before_override_kwh: Math.round(currentSum),
      official_sum_kwh: Math.round(officialSum),
      current_spread_pct: Math.round(currentSpread * 100),
      official_spread_pct: Math.round(officialSpread * 100),
      july_kwh: Math.round(consoMonthly[6] ?? 0),
      august_kwh: Math.round(consoMonthly[7] ?? 0),
      official_july_kwh: Math.round(officialMonthlyConsumption[6] ?? 0),
      official_august_kwh: Math.round(officialMonthlyConsumption[7] ?? 0),
    });
  }

  const isVirtualLikeScenario = isVirtualLikeScenarioId(selectedKey);
  const officialConsoForP6 =
    isVirtualLikeScenario && selectedScenario?.energy && typeof selectedScenario.energy === "object"
      ? num(selectedScenario.energy.consumption_kwh ?? selectedScenario.energy.conso)
      : null;
  const officialGridImportForP6 =
    isVirtualLikeScenario && selectedScenario?.energy && typeof selectedScenario.energy === "object"
      ? canonicalGridImportKwhForPdf(selectedScenario.energy)
      : null;
  const billableMonthlyForP6 =
    isVirtualLikeScenario
      ? (
          Array.isArray(selectedScenario?.energy?.billable_monthly)
            ? selectedScenario.energy.billable_monthly
            : Array.isArray(selectedScenario?.billable_monthly)
              ? selectedScenario.billable_monthly
              : null
        )
      : null;

  if (isVirtualLikeScenario && officialConsoForP6 != null && officialConsoForP6 >= 0) {
    const currentConsoSum = consoMonthly.reduce((a, b) => a + numOrZero(b), 0);
    if (currentConsoSum > 0 && Math.abs(currentConsoSum - officialConsoForP6) > 1) {
      const factor = officialConsoForP6 / currentConsoSum;
      consoMonthly = consoMonthly.map((v) => numOrZero(v) * factor);
    } else if (currentConsoSum <= 0) {
      consoMonthly = uniformMonthly12FromTotal(officialConsoForP6);
    }
  }

  const p4ConsoMonthly = p4ConsoMonthlyOverride ?? consoMonthly;
  const explicitDirectMonthly =
    Array.isArray(scenarioMonthly) && scenarioMonthly.length >= 12
      ? scenarioMonthly
          .slice(0, 12)
          .map((m) => num(m.direct_self_consumption_kwh))
      : null;
  const hasExplicitDirectMonthly =
    Array.isArray(explicitDirectMonthly) && explicitDirectMonthly.some((v) => v != null && v >= 0);
  const explicitStorageMonthly =
    Array.isArray(scenarioMonthly) && scenarioMonthly.length >= 12
      ? scenarioMonthly.slice(0, 12).map((m) => {
          const physical = num(m.physical_battery_discharge_kwh);
          const vehicle = num(m.vehicle_v2h_discharge_kwh);
          const virtual = num(m.virtual_battery_discharge_kwh);
          if (physical != null || vehicle != null || virtual != null) {
            return numOrZero(physical) + numOrZero(vehicle) + numOrZero(virtual);
          }
          return null;
        })
      : null;
  const hasExplicitStorageMonthly =
    Array.isArray(explicitStorageMonthly) && explicitStorageMonthly.some((v) => v != null && v > 0);

  const restoredAnnualForMonthly = isVehicleV2hSelected
    ? (
        num(selectedScenario?.battery_discharge_kwh) ??
        num(selectedScenario?.energy?.physical_battery_discharge_kwh) ??
        num(selectedScenario?.battery?.annual_discharge_kwh) ??
        0
      ) +
      (num(selectedScenario?.vehicle_v2h?.ev_v2h_discharge_kwh) ?? 0) +
      (
        num(selectedScenario?.energy?.virtual_battery_discharge_kwh) ??
        num(selectedScenario?.energy?.used_credit_kwh) ??
        num(selectedScenario?.battery_virtual?.annual_discharge_kwh) ??
        0
      )
    : resolveBatteryRestoredKwhForPdf(selectedScenario, selectedScenario?.energy ?? energy);
  let batMonthly = isBatteryScenario
    ? (Array.isArray(scenarioMonthly) && scenarioMonthly.length >= 12
        ? scenarioMonthly.slice(0, 12).map((m) => numOrZero(m.batt_kwh ?? m.batt))
        : (autoMonthly.reduce((a, b) => a + numOrZero(b), 0) > 0
            ? autoMonthly.map((m) => (numOrZero(m) / autoMonthly.reduce((a, b) => a + numOrZero(b), 0)) * restoredAnnualForMonthly)
            : uniformMonthly12FromTotal(restoredAnnualForMonthly)))
    : Array(12).fill(0);
  const p4BatMonthly =
    isBatteryScenario && hasExplicitStorageMonthly
      ? explicitStorageMonthly.map((v) => numOrZero(v))
      : batMonthly.slice(0, 12);
  const p4DirectMonthly =
    hasExplicitDirectMonthly
      ? explicitDirectMonthly.map((v) => numOrZero(v))
      : autoMonthly.map((a, i) => Math.max(0, numOrZero(a) - numOrZero(p4BatMonthly[i])));
  const p4SolarCoveredMonthly = p4DirectMonthly.map((direct, i) =>
    Math.min(
      numOrZero(p4ConsoMonthly[i]),
      Math.max(0, numOrZero(direct) + numOrZero(p4BatMonthly[i]))
    )
  );
  let gridMonthly = consoMonthly.map((c, i) => Math.max(0, c - Math.max(0, (autoMonthly[i] ?? 0) - (batMonthly[i] ?? 0)) - batMonthly[i]));

  if (isVirtualLikeScenario) {
    if (Array.isArray(billableMonthlyForP6) && billableMonthlyForP6.length >= 12) {
      gridMonthly = billableMonthlyForP6
        .slice(0, 12)
        .map((m) => numOrZero(m.billable_import ?? m.import_kwh ?? m.import ?? m.grid_import_kwh));
      const restoredMonthly = billableMonthlyForP6
        .slice(0, 12)
        .map((m, i) => num(m.used_credit ?? m.restored_kwh ?? m.discharge_kwh ?? m.batt_kwh ?? m.batt) ?? batMonthly[i] ?? 0);
      batMonthly = restoredMonthly;
    } else if (officialGridImportForP6 != null && officialGridImportForP6 >= 0) {
      const currentGridSum = gridMonthly.reduce((a, b) => a + numOrZero(b), 0);
      if (currentGridSum > 0) {
        const factor = officialGridImportForP6 / currentGridSum;
        gridMonthly = gridMonthly.map((v) => numOrZero(v) * factor);
      } else {
        gridMonthly = uniformMonthly12FromTotal(officialGridImportForP6);
      }
    }

    const gridMonthlySum = gridMonthly.reduce((a, b) => a + numOrZero(b), 0);
    if (
      officialGridImportForP6 != null &&
      officialGridImportForP6 >= 0 &&
      gridMonthlySum > 0 &&
      Math.abs(gridMonthlySum - officialGridImportForP6) > 1
    ) {
      const factor = officialGridImportForP6 / gridMonthlySum;
      gridMonthly = gridMonthly.map((v) => numOrZero(v) * factor);
    }
  }

  // dir = PV directe. Pour la batterie virtuelle, on recalcule depuis l'import facturable
  // afin que le dessin mensuel raconte la même chose que les KPI annuels Urban Solar.
  const dirMonthly = autoMonthly.map((a, i) => {
    if (!isVirtualLikeScenario) return Math.max(0, (a ?? 0) - (batMonthly[i] ?? 0));
    const covered = Math.max(0, numOrZero(consoMonthly[i]) - numOrZero(gridMonthly[i]));
    batMonthly[i] = Math.min(Math.max(0, numOrZero(batMonthly[i])), covered);
    return Math.max(0, covered - batMonthly[i]);
  });
  const totMonthly = consoMonthly;
  const price = econDisplay.price_eur_kwh;

  // P4 — synthèse annuelle (scénario retenu scenarios_v2 en priorité)
  const energyP4 =
    scenarioForFinance?.energy && typeof scenarioForFinance.energy === "object"
      ? { ...energy, ...scenarioForFinance.energy }
      : energy;
  const prodAnnuelle = num(energyP4.production_kwh) ?? annualKwh;
  const consoAnnuelleP4 = num(energyP4.consumption_kwh) ?? consumptionKwh;
  const totalPvUsedP4 =
    num(energyP4.total_pv_used_on_site_kwh) ??
    num(energyP4.autoconsumption_kwh) ??
    autoMonthly.reduce((a, b) => a + b, 0);
  const autoAnnuelle = totalPvUsedP4;
  const surplusAnnuelle =
    num(energyP4.exported_kwh) ??
    num(energyP4.surplus_kwh) ??
    (surplusMonthly ? surplusMonthly.reduce((a, b) => a + b, 0) : Math.max(0, prodAnnuelle - autoAnnuelle));
  const importAnnuelle =
    canonicalGridImportKwhForPdf(energyP4) ?? numOrZero(energy.import_kwh);
  const couvertureResolved = resolveSiteCoverageFromPvPct(energyP4);
  const couverturePct =
    couvertureResolved != null
      ? Math.round(couvertureResolved)
      : consoAnnuelleP4 > 0
        ? Math.min(100, Math.round((autoAnnuelle / consoAnnuelleP4) * 100))
        : null;
  const pvSelfResolvedP4 = resolvePvSelfConsumptionPct(energyP4);
  const tauxAutoPct =
    pvSelfResolvedP4 != null
      ? Math.round(pvSelfResolvedP4)
      : prodAnnuelle > 0
        ? Math.min(100, Math.round((autoAnnuelle / prodAnnuelle) * 100))
        : selfConsumptionPct != null
          ? Math.round(selfConsumptionPct)
          : null;

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

  const primeAmountRounded = Math.round(primeAmount);
  const totalTtcOffer = Math.round(capex);
  const offer = {
    materiel_ht: null,
    batterie_ht: null,
    shelly_ht: null,
    pose_ht: null,
    gestion_ht: null,
    sous_total_ht: null,
    tva_mat: null,
    tva_pose: null,
    tva_materiel_eur: null,
    tva_pose_eur: null,
    total_ttc: totalTtcOffer,
    prime: primeAmountRounded,
    reste: resteACharge,
    puissance: systemPowerKw,
    batterie_label: "",
    onduleurs: str(onduleur.modele) || str(onduleur.marque) || "",
    garantie: "25 ans",
    echelon: "À définir",
    validite: "30 jours",
    delai: "À définir",
    // LOT D — matériel de pose toit plat ([] = aucune ligne affichée)
    systemes_pose: _flatRoofMountingPdf.lines,
    systeme_pose_note: _flatRoofMountingPdf.note,
  };

  const autoKwhCo2 =
    num(energyForKpis.total_pv_used_on_site_kwh) ??
    num(energyForKpis.autoconsumption_kwh) ??
    num(energyForKpis.auto) ??
    0;
  const surplusKwhCo2 =
    num(energyForKpis.exported_kwh) ??
    num(energyForKpis.surplus_kwh) ??
    num(energyForKpis.surplus) ??
    0;
  const co2Evite = Math.round(
    autoKwhCo2 * IMPACT_FACTOR_CO2_AUTO_KG_PER_KWH + surplusKwhCo2 * IMPACT_FACTOR_CO2_SURPLUS_KG_PER_KWH
  );
  const treesEquiv = Math.round(co2Evite / IMPACT_TREE_CO2_KG_PER_YEAR);
  const carsEquiv = Math.round(co2Evite / IMPACT_CAR_CO2_KG_PER_KM);

  const generatedAt = str(snapshot.computed_at) || str(snapshot.created_at) || new Date().toISOString();
  /* Totaux annuels officiels partagés P6/P7/P8 — source unique : énergie du scénario sélectionné.
     Évite les écarts d'1-2 kWh entre la somme des séries mensuelles (P6) et les champs annuels (P7/P8). */
  const _energyFlowsShared =
    selectedScenario?.energy && typeof selectedScenario.energy === "object"
      ? { ...energy, ...selectedScenario.energy }
      : energy;
  const _sharedConsoKwh = num(_energyFlowsShared.consumption_kwh ?? _energyFlowsShared.conso) ?? consumptionKwh;
  const _sharedAutoKwh =
    num(_energyFlowsShared.total_pv_used_on_site_kwh) ??
    num(_energyFlowsShared.autoconsumption_kwh) ??
    num(_energyFlowsShared.auto) ??
    null;
  const _sharedRestoredKwh = resolveBatteryRestoredKwhForPdf(selectedScenario, _energyFlowsShared);
  const _sharedGridImportKwh = canonicalGridImportKwhForPdf(_energyFlowsShared);
  const _sharedSolarUsedKwh =
    (isVirtualLikeScenario
      ? num(_energyFlowsShared.site_solar_or_credit_used_kwh) ?? coveredFromCanonicalImportKwh(_energyFlowsShared)
      : null) ??
    resolvePvUsedOnSiteKwhForPdf(_energyFlowsShared) ??
    (_sharedAutoKwh != null
      ? Math.max(0, (num(_energyFlowsShared.direct_self_consumption_kwh) ?? Math.max(0, _sharedAutoKwh - _sharedRestoredKwh)) + _sharedRestoredKwh)
      : null);

  // P4 — chiffres energie additionnels, dependants du scenario selectionne (page synthese production).
  const _p4DirectKwh = num(_energyFlowsShared.direct_self_consumption_kwh) ?? Math.max(0, (autoAnnuelle ?? 0) - (_sharedRestoredKwh ?? 0));
  const _p4SurplusBrutKwh = Math.max(0, (prodAnnuelle ?? 0) - _p4DirectKwh);
  const _p4ChargeKwh = isVehicleV2hSelected
    ? null
    : (
        num(selectedScenario?.battery_charge_kwh) ??
        num(selectedScenario?.energy?.battery_charge_kwh) ??
        num(selectedScenario?.battery?.annual_charge_kwh)
      );
  const _p4RestitutionKwh = _sharedRestoredKwh ?? 0;
  const _p4PertesKwh = (_p4ChargeKwh != null) ? Math.max(0, _p4ChargeKwh - _p4RestitutionKwh) : null;
  const _p4RevenuReventeEur = numOrZero(financeActive.revenu_surplus ?? finance.revenu_surplus);

  return {
    meta: {
      studyId: options.studyId ?? null,
      versionId: options.versionId ?? null,
      generatedAt,
      scenarioType: str(selectedKey),
    },
    study_number: options.studyNumber ?? null,
    generated_at: generatedAt,
    consumption_trace: snapshot.consumption_trace ?? null,
    consumption_monthly_missing: consumptionMonthlyMissing,
    consumption_profile_notice:
      snapshot.consumption_trace?.scenario_uses_piloted_profile === true
        ? "Profil de consommation : optimisation solaire des usages activée."
        : "Profil de consommation : consommation actuelle non optimisée.",
    consumption_source_label: (() => {
      const _s = snapshot.consumption_trace?.consumption_source ?? null;
      if (_s === "ENEDIS_HOURLY") return "Source : courbe Enedis réelle";
      if (_s === "ENEDIS_DAILY") return "Source : courbe Enedis (journalier)";
      if (_s === "MONTHLY_SYNTHETIC") return "Source : profil synthétique mensuel";
      if (_s === "ANNUAL_SYNTHETIC") return "Source : profil synthétique annuel";
      if (_s === "FALLBACK") return "Source : profil national par défaut";
      return "Source : non précisée";
    })(),
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
      gridImportBefore: num(energyForKpis.consumption_kwh ?? energyForKpis.conso),
      gridImportAfter: num(
        energyForKpis.import_kwh ?? energyForKpis.import ?? energyForKpis.grid_import_kwh
      ),
      selfConsumptionRate: pvSelfConsumptionPct,
      autonomyRate: autonomyPct,
      annualElectricityBillBefore: null,
      // Facture annuelle après solaire = facture complète (achat réseau + coûts batterie virtuelle),
      // cohérente avec la projection 25 ans et le détail restitution/abonnement. annualBillWithSolar
      // = factureRestante + coût service VB (0 si pas de batterie virtuelle).
      annualElectricityBillAfter: annualBillWithSolar > 0 ? Math.round(annualBillWithSolar) : num(financeActive.facture_restante ?? finance.facture_restante),
      residual_bill_virtual_breakdown:
        finance.residual_bill_virtual_breakdown ??
        buildResidualBillVirtualVmFromScenario(selectedScenario),
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
        energy_summary: {
          production_kwh: prodAnnuelle,
          consumption_kwh: consoAnnuelleP4,
          solar_used_kwh: autoAnnuelle,
          exported_kwh: isVirtualLikeScenario ? _p4SurplusBrutKwh : surplusAnnuelle,
          grid_import_kwh: importAnnuelle,
          coverage_pct: couverturePct,
          pv_self_consumption_pct: tauxAutoPct,
        },
      },
      p3b: { p3b_auto },
      p_shading,
      p4: {
        meta: { client: clientName, ref, date: dateDisplay, date_display: dateDisplay },
        production_kwh: monthly,
        consommation_kwh: p4ConsoMonthly,
        consommation_kwh_source: p4ConsumptionMonthlySource,
        consommation_kwh_reference: officialMonthlyConsumption,
        autoconso_kwh: p4SolarCoveredMonthly,
        direct_pv_kwh: p4DirectMonthly,
        surplus_kwh: surplusMonthly,
        batterie_kwh: p4BatMonthly,
        // Synthèse annuelle (données réelles)
        production_annuelle: prodAnnuelle,
        consommation_annuelle: consoAnnuelleP4,
        energie_consommee_directement: _p4DirectKwh,
        energie_solaire_valorisee: autoAnnuelle,
        energie_solaire_utilisee_avec_credit_kwh: _sharedSolarUsedKwh,
        reste_reseau_kwh: importAnnuelle,
        energie_injectee: isVirtualLikeScenario ? _p4SurplusBrutKwh : surplusAnnuelle,
        taux_autoconsommation_pct: tauxAutoPct,
        couverture_besoins_pct: couverturePct,
        autonomie_pct: autonomyPct,
        economie_annee_1: annualSavings,
        scenario_type: str(selectedKey),
        surplus_brut_kwh: Math.round(_p4SurplusBrutKwh),
        revenu_revente_eur: Math.round(_p4RevenuReventeEur),
        restitution_batterie_kwh: Math.round(_p4RestitutionKwh),
        restitution_vehicle_v2h_kwh: Math.round(
          num(selectedScenario?.vehicle_v2h?.ev_v2h_discharge_kwh) ??
          num(_energyFlowsShared.ev_v2h_discharge_kwh) ??
          0
        ),
        charge_batterie_kwh: _p4ChargeKwh != null ? Math.round(_p4ChargeKwh) : null,
        pertes_batterie_kwh: _p4PertesKwh != null ? Math.round(_p4PertesKwh) : null,
        credit_virtuel_utilise_kwh: Math.round(_p4RestitutionKwh),
        cout_batterie_virtuelle_eur: Math.round(vbAnnualServiceCostTtc),
        storage_legend_label: isVehicleV2hSelected || isVirtualLikeScenario ? "Stockage restitué" : "Énergie stockée",
        storage_legend_sublabel:
          isVehicleV2hSelected && isVirtualLikeScenario
            ? "V2H + batterie virtuelle"
            : isVehicleV2hSelected
              ? "voiture V2H"
              : isVirtualLikeScenario
                ? "batterie virtuelle"
                : "batterie",
        kpi_labels: {
          pv_self_consumption: "Autoconsommation PV",
          site_autonomy: isVirtualLikeScenario ? "Autonomie locale" : "Autonomie site",
          grid_import: "Import réseau",
          battery_restored: "Énergie restituée batterie",
        },
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
          /* Totaux officiels annuels (KPI) — le graphique reste sur les séries mensuelles. */
          totals: {
            conso_kwh: _sharedConsoKwh,
            solar_used_kwh: _sharedSolarUsedKwh,
            grid_import_kwh: _sharedGridImportKwh,
            production_kwh: num(_energyFlowsShared.production_kwh ?? _energyFlowsShared.prod) ?? null,
          },
        },
      },
      // P7 — source principale = selectedScenario.energy (scenarios_v2), fallback = snapshot.energy
      // Aligné avec P6 : réagit aux recalculs calpinage / scénario
      // Origine consommation : c_pv+c_bat = autonomie (sans réseau), c_grid = part réseau
      // Destination production : p_auto = autoconsommation, p_surplus = injecté
      p7: (() => {
        const energyP7 =
          selectedScenario?.energy && typeof selectedScenario.energy === "object"
            ? { ...energy, ...selectedScenario.energy }
            : energy;
        const prodP7 = num(energyP7.production_kwh ?? energyP7.prod) ?? annualKwh;
        const consoP7 = num(energyP7.consumption_kwh ?? energyP7.conso) ?? consumptionKwh;
        const autoP7 =
          num(energyP7.total_pv_used_on_site_kwh) ??
          num(energyP7.autoconsumption_kwh) ??
          num(energyP7.auto) ??
          autoMonthly.reduce((a, b) => a + b, 0);
        const rawSurplusP7 =
          num(energyP7.exported_kwh) ??
          num(energyP7.surplus_kwh ?? energyP7.surplus) ??
          Math.max(0, prodP7 - autoP7);
        const directForSurplusP7 = num(energyP7.direct_self_consumption_kwh);
        const surplusP7 =
          (isVirtualLikeScenario || isVehicleV2hSelected) && directForSurplusP7 != null
            ? Math.max(0, prodP7 - directForSurplusP7)
            : Math.min(Math.max(0, rawSurplusP7), Math.max(0, prodP7));
        const importP7 =
          canonicalGridImportKwhForPdf(energyP7) ??
          Math.max(0, consoP7 - autoP7);
        const selfConsP7 = resolvePvSelfConsumptionPct(energyP7);
        const energyP7ForPvCoverage =
          isVirtualLikeScenario || isVehicleV2hSelected
            ? { ...energyP7, used_credit_kwh: num(energyP7.used_credit_kwh) ?? num(energyP7.restored_kwh) ?? num(energyP7.virtual_battery_discharge_kwh) }
            : energyP7;
        const autonomyP7 =
          (isVirtualLikeScenario || isVehicleV2hSelected
            ? resolveSiteCoverageFromPvPct(energyP7ForPvCoverage)
            : null) ??
          num(energyP7.site_autonomy_pct) ??
          num(energyP7.energy_independence_pct) ??
          num(energyP7.independence_pct) ??
          resolveSiteAutonomyPct(energyP7);
        const partReseauP7 = autonomyP7 != null ? Math.round(100 - autonomyP7) : (consoP7 > 0 && importP7 != null ? Math.round((importP7 / consoP7) * 100) : 0);
        const surplusPctP7 = prodP7 > 0 && surplusP7 != null ? Math.min(100, (surplusP7 / prodP7) * 100) : (selfConsP7 != null ? 100 - selfConsP7 : 0);
        const autonomiePct = autonomyP7 != null ? Math.round(autonomyP7) : (partReseauP7 > 0 ? Math.max(0, 100 - partReseauP7) : 0);

        const isBatScen =
          selectedKey === "BATTERY_PHYSICAL" ||
          selectedKey === "BATTERY_VIRTUAL" ||
          selectedKey === "BATTERY_HYBRID" ||
          isVehicleV2hSelected;
        const v2hForP7 =
          selectedScenario?.vehicle_v2h && typeof selectedScenario.vehicle_v2h === "object"
            ? selectedScenario.vehicle_v2h
            : {};
        const physicalForP7 =
          num(selectedScenario?.battery_discharge_kwh) ??
          num(energyP7.physical_battery_discharge_kwh) ??
          num(selectedScenario?.battery?.annual_discharge_kwh) ??
          0;
        const vehicleForP7 = isVehicleV2hSelected ? (num(v2hForP7.ev_v2h_discharge_kwh) ?? 0) : 0;
        const virtualForP7 =
          num(energyP7.virtual_battery_discharge_kwh) ??
          num(energyP7.used_credit_kwh) ??
          num(selectedScenario?.battery_virtual?.annual_discharge_kwh) ??
          0;
        const restoredP7 =
          isVehicleV2hSelected
            ? physicalForP7 + vehicleForP7 + virtualForP7
            : (
                num(energyP7.restored_kwh) ??
                num(energyP7.used_credit_kwh) ??
                0
              );
        const creditedP7 =
          num(energyP7.credited_kwh) ??
          (isVehicleV2hSelected ? num(v2hForP7.ev_solar_charge_kwh) : null) ??
          0;
        const directP7 =
          num(energyP7.direct_self_consumption_kwh) ??
          Math.max(0, autoP7 - restoredP7);
        const gridImportCanonicalP7 = importP7;
        const solarUsedP7 =
          (isVirtualLikeScenario || isVehicleV2hSelected
            ? num(energyP7ForPvCoverage.site_solar_or_credit_used_kwh) ?? coveredFromCanonicalImportKwh(energyP7ForPvCoverage)
            : null) ??
          resolvePvUsedOnSiteKwhForPdf(energyP7ForPvCoverage) ??
          (isBatScen ? Math.max(0, directP7 + restoredP7) : directP7 + restoredP7);
        const solarCoverageP7 =
          consoP7 > 0 ? Math.max(0, Math.min(100, (solarUsedP7 / consoP7) * 100)) : null;
        const estimatedAnnualBillP7 =
          (isVirtualLikeScenario && annualBillWithSolar > 0 ? annualBillWithSolar : null) ??
          num(scenarioForFinance?.finance?.estimated_annual_bill_eur) ??
          num(scenarioForFinance?.finance?.residual_bill_eur) ??
          num(financeActive?.residual_bill_eur);
        let cBat = consoP7 > 0 && isBatScen ? Math.min(100, (restoredP7 / consoP7) * 100) : 0;
        let cGrid = consoP7 > 0 ? Math.min(100, (gridImportCanonicalP7 / consoP7) * 100) : 0;
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
        let pBat = prodP7 > 0 && isBatScen ? Math.round(Math.min(100, (creditedP7 / prodP7) * 100)) : 0;
        let pSurplusRounded = Math.round(surplusPctP7);
        /* pBat arrondi AVANT la soustraction : p_auto_pct doit être un entier (affiché tel quel). */
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
            p_auto_pct: Math.round(pAuto),
            p_bat_pct: Math.round(pBat),
            p_surplus_pct: pSurplusRounded,
          },
          c_grid: numOrZero(gridImportCanonicalP7),
          p_surplus: numOrZero(surplusP7),
          // FIX « 0 kWh injectés » vs « surplus injecté et valorisé » (audit 2026-07-03) :
          // en scénario stockage le surplus part en batterie/crédit (exported_kwh = 0) ;
          // le frontend affiche alors le surplus VALORISÉ et adapte le vocabulaire.
          is_storage_scenario: isBatScen,
          is_vehicle_v2h_scenario: isVehicleV2hSelected,
          storage_label: isVehicleV2hSelected ? "Stockage" : "Batterie",
          storage_long_label: isVehicleV2hSelected ? "stockage V2H" : "batterie",
          p_surplus_valorise: Math.min(numOrZero(prodP7), Math.max(0, numOrZero(surplusP7))),
          credited_kwh: numOrZero(creditedP7),
          consumption_kwh: numOrZero(consoP7),
          autoconsumption_kwh: numOrZero(autoP7),
          production_kwh: numOrZero(prodP7),
          energy_solar_used_kwh: numOrZero(solarUsedP7),
          energy_solar_used_direct_kwh: numOrZero(directP7),
          energy_grid_import_kwh: numOrZero(gridImportCanonicalP7),
          estimated_annual_bill_eur: estimatedAnnualBillP7,
          solar_coverage_pct: solarCoverageP7,
        };
      })(),
      p7_virtual_battery: (() => {
        // Affichage strictement réservé au scénario sélectionné BATTERY_VIRTUAL.
        // On utilise selectedKey (déjà résolu) plutôt que selectedScenario?.scenario_type / .id
        // qui peuvent être undefined si l'objet scénario n'expose pas ces champs explicitement.
        if (!isVirtualLikeScenarioId(selectedKey)) return null;
        if (!selectedScenario || typeof selectedScenario !== "object") return null;

        const baseScenario = baseFromV2 && typeof baseFromV2 === "object" ? baseFromV2 : null;
        const vbEnergy =
          selectedScenario.energy && typeof selectedScenario.energy === "object"
            ? selectedScenario.energy
            : {};
        const baseEnergy =
          baseScenario?.energy && typeof baseScenario.energy === "object"
            ? baseScenario.energy
            : {
                direct_self_consumption_kwh: vbEnergy.direct_self_consumption_kwh,
                autoconsumption_kwh: vbEnergy.direct_self_consumption_kwh,
                import_kwh: null,
              };

        const consumptionKwh = num(vbEnergy.consumption_kwh);
        const productionKwh = num(vbEnergy.production_kwh);
        const baseDirectSelfKwh =
          num(baseEnergy.direct_self_consumption_kwh) ??
          num(baseEnergy.autoconsumption_kwh) ??
          num(baseEnergy.auto);
        const baseGridImportKwh =
          canonicalGridImportKwh(baseEnergy);
        const vbDirectSelfKwh = num(vbEnergy.direct_self_consumption_kwh);
        const vbBatteryDischargeKwh = num(vbEnergy.battery_discharge_kwh);
        const vbGridImportKwh = canonicalGridImportKwhForPdf(vbEnergy);
        const vbTotalPvUsedKwh =
          num(vbEnergy.site_solar_or_credit_used_kwh) ??
          coveredFromCanonicalImportKwh(vbEnergy) ??
          resolvePvUsedOnSiteKwhForPdf({
            ...vbEnergy,
            used_credit_kwh: num(vbEnergy.used_credit_kwh) ?? num(vbEnergy.restored_kwh) ?? vbBatteryDischargeKwh,
          });
        const vbExportedKwh =
          num(vbEnergy.exported_kwh) ??
          num(vbEnergy.surplus_kwh) ??
          num(vbEnergy.surplus);

        const autonomyBaseRatio = safeRatio(baseDirectSelfKwh, consumptionKwh);
        const autonomyWithBatteryRatio = safeRatio(vbTotalPvUsedKwh, consumptionKwh);
        const autonomyGainRatio =
          autonomyWithBatteryRatio != null && autonomyBaseRatio != null
            ? autonomyWithBatteryRatio - autonomyBaseRatio
            : null;
        const maxTheoreticalRatio = safeRatio(productionKwh, consumptionKwh);
        const gridBoughtLessKwh =
          baseGridImportKwh != null && vbGridImportKwh != null
            ? baseGridImportKwh - vbGridImportKwh
            : null;
        const estimatedAnnualBillVb =
          (annualBillWithSolar > 0 ? annualBillWithSolar : null) ??
          num(selectedScenario?.finance?.estimated_annual_bill_eur) ??
          num(selectedScenario?.finance?.residual_bill_eur) ??
          num(financeActive?.residual_bill_eur);
        const productionVsConsumptionLimit =
          productionKwh != null && consumptionKwh != null && productionKwh >= consumptionKwh
            ? "La production annuelle couvre le besoin en bilan annuel, mais production et consommation ne sont pas alignees heure par heure."
            : "La production solaire reste inferieure a la consommation annuelle.";

        // FIX libellé hybride (audit 2026-07-03) — cette page est aussi rendue pour
        // BATTERY_HYBRID : le titre/libellés « batterie virtuelle » seuls sont incomplets
        // (la page suivante détaille physique + virtuelle → incohérence pour le client).
        const _p7vbIsHybrid = selectedKey === "BATTERY_HYBRID" || selectedKey === "VEHICLE_V2H_PHYSICAL_VIRTUAL";
        const _p7vbIsVehicle = isVehicleV2hScenarioId(selectedKey);
        return {
          meta: {
            client: clientName,
            ref,
            date: dateDisplay,
          },
          is_hybrid: _p7vbIsHybrid,
          is_vehicle_v2h: _p7vbIsVehicle,
          title: _p7vbIsHybrid
            ? "Impact stockage hybride"
            : "Impact batterie virtuelle",
          subtitle: _p7vbIsHybrid
            ? "Comprendre précisément ce que vos deux batteries changent dans votre projet solaire"
            : "Comprendre précisément ce qu’elle change dans votre projet solaire",
          source: {
            consumption_kwh: consumptionKwh,
            production_kwh: productionKwh,
            direct_self_consumption_kwh: vbDirectSelfKwh,
            battery_discharge_kwh: vbBatteryDischargeKwh,
            total_pv_used_on_site_kwh: vbTotalPvUsedKwh,
            grid_import_kwh: vbGridImportKwh,
            exported_kwh: vbExportedKwh,
            site_autonomy_pct: num(vbEnergy.site_autonomy_pct),
            pv_self_consumption_pct: num(vbEnergy.pv_self_consumption_pct),
          },
          without_battery: {
            autonomie_ratio: autonomyBaseRatio,
            pv_used_kwh: baseDirectSelfKwh,
            grid_import_kwh: baseGridImportKwh,
          },
          with_virtual_battery: {
            autonomie_ratio: autonomyWithBatteryRatio,
            pv_total_used_kwh: vbTotalPvUsedKwh,
            battery_discharged_kwh: vbBatteryDischargeKwh,
            grid_import_kwh: vbGridImportKwh,
          },
          max_theoretical: {
            production_kwh: productionKwh,
            consumption_kwh: consumptionKwh,
            autonomy_ratio: maxTheoreticalRatio,
          },
          contribution: {
            recovered_kwh: vbBatteryDischargeKwh,
            grid_bought_less_kwh: gridBoughtLessKwh,
            autonomy_gain_ratio: autonomyGainRatio,
          },
          kpis: {
            energy_solar_used_kwh: vbTotalPvUsedKwh,
            energy_grid_import_kwh: vbGridImportKwh,
            estimated_annual_bill_eur: estimatedAnnualBillVb,
            solar_coverage_pct:
              consumptionKwh != null && consumptionKwh > 0 && vbTotalPvUsedKwh != null
                ? (vbTotalPvUsedKwh / consumptionKwh) * 100
                : null,
          },
          limits: [
            productionVsConsumptionLimit,
            "La production et la consommation ne sont pas alignées en continu.",
            "Une partie du surplus reste non récupérable selon les périodes.",
          ],
        };
      })(),
      // P7 HYBRID — Page pédagogique "Physique + Virtuelle en cascade"
      // Strictement réservée au scénario sélectionné BATTERY_HYBRID.
      p7_hybrid_battery: (() => {
        if (selectedKey !== "BATTERY_HYBRID") return null;
        if (!selectedScenario || typeof selectedScenario !== "object") return null;

        const baseScenario = baseFromV2;
        if (!baseScenario || typeof baseScenario !== "object") return null;

        const hybridEnergy = selectedScenario.energy && typeof selectedScenario.energy === "object"
          ? selectedScenario.energy
          : {};
        const baseEnergy = baseScenario.energy && typeof baseScenario.energy === "object"
          ? baseScenario.energy
          : {};
        const physBattery = selectedScenario.battery && typeof selectedScenario.battery === "object"
          ? selectedScenario.battery
          : {};
        const virtBattery = selectedScenario.battery_virtual && typeof selectedScenario.battery_virtual === "object"
          ? selectedScenario.battery_virtual
          : {};

        // ── Énergie totale hybride ──────────────────────────────────────────────
        const productionKwh = num(hybridEnergy.production_kwh) ?? num(baseEnergy.production_kwh) ?? annualKwh;
        const consumptionKwh = num(hybridEnergy.consumption_kwh) ?? num(baseEnergy.consumption_kwh);
        const totalAutoKwh =
          num(hybridEnergy.site_solar_or_credit_used_kwh) ??
          coveredFromCanonicalImportKwh(hybridEnergy) ??
          resolvePvUsedOnSiteKwhForPdf(hybridEnergy) ??
          num(hybridEnergy.autoconsumption_kwh) ??
          num(selectedScenario.autoproduction_kwh);
        // En V2, batteryPhysicalMetrics est spreadé à la RACINE du scénario (pas dans hardware).
        // → selectedScenario.battery_discharge_kwh (racine) est la source fiable.
        // Fallbacks : energy.battery_discharge_kwh (si moteur le fournit), puis battery.annual_discharge_kwh (pré-V2).
        const physicalDischargeKwh =
          num(selectedScenario.battery_discharge_kwh) ??
          num(selectedScenario.hardware?.battery_discharge_kwh) ??
          num(selectedScenario.energy?.battery_discharge_kwh) ??
          num(physBattery.annual_discharge_kwh) ??
          0;
        const virtualDischargeKwh =
          num(hybridEnergy.used_credit_kwh) ??
          num(virtBattery.annual_discharge_kwh) ??
          num(virtBattery.restored_kwh) ??
          0;
        // Autoconsommation directe = total - physique - virtuel (sans double comptage)
        const directAutoKwh =
          totalAutoKwh != null
            ? Math.max(0, totalAutoKwh - physicalDischargeKwh - virtualDischargeKwh)
            : null;
        const residualImportKwh =
          canonicalGridImportKwhForPdf(hybridEnergy);
        const residualSurplusKwh =
          num(hybridEnergy.surplus_kwh) ??
          num(hybridEnergy.grid_export_kwh) ??
          null;

        // ── Finance ─────────────────────────────────────────────────────────────
        const estimatedBillEur =
          (annualBillWithSolar > 0 ? annualBillWithSolar : null) ??
          num(selectedScenario?.finance?.estimated_annual_bill_eur) ??
          num(selectedScenario?.finance?.residual_bill_eur) ??
          num(financeActive?.residual_bill_eur);

        // ── Indicateurs de comparaison ───────────────────────────────────────────
        const baseDirectAutoKwh =
          num(baseEnergy.direct_self_consumption_kwh) ??
          num(baseEnergy.autoconsumption_kwh) ??
          num(baseEnergy.auto);
        const baseImportKwh =
          canonicalGridImportKwh(baseEnergy);
        const autonomyHybridRatio = safeRatio(totalAutoKwh, consumptionKwh);
        const autonomyBaseRatio = safeRatio(baseDirectAutoKwh, consumptionKwh);
        const autonomyGainRatio =
          autonomyHybridRatio != null && autonomyBaseRatio != null
            ? autonomyHybridRatio - autonomyBaseRatio
            : null;
        const maxTheoreticalRatio = safeRatio(productionKwh, consumptionKwh);
        const gridBoughtLessKwh =
          baseImportKwh != null && residualImportKwh != null
            ? baseImportKwh - residualImportKwh
            : null;
        const solarCoveragePct =
          consumptionKwh != null && consumptionKwh > 0 && totalAutoKwh != null
            ? (totalAutoKwh / consumptionKwh) * 100
            : null;

        return {
          meta: {
            client: clientName,
            ref,
            date: dateDisplay,
          },
          title: "Configuration hybride : physique + virtuelle en cascade",
          subtitle:
            "Votre batterie physique gère les cycles journaliers. Le surplus résiduel est converti en crédits kWh pour réduire vos factures en hiver.",
          kpis: {
            energy_solar_valorised_kwh: totalAutoKwh,
            energy_grid_import_kwh: residualImportKwh,
            estimated_annual_bill_eur: estimatedBillEur,
            solar_coverage_pct: solarCoveragePct,
          },
          // Détail des 3 couches — cœur commercial de la page
          layers: {
            direct_auto_kwh: directAutoKwh,
            physical_battery_kwh: physicalDischargeKwh,
            virtual_battery_kwh: virtualDischargeKwh,
            total_valorised_kwh: totalAutoKwh,
          },
          // Données de comparaison avec le scénario BASE
          comparison: {
            base_import_kwh: baseImportKwh,
            hybrid_import_kwh: residualImportKwh,
            grid_bought_less_kwh: gridBoughtLessKwh,
            autonomy_gain_ratio: autonomyGainRatio,
            max_theoretical_ratio: maxTheoreticalRatio,
          },
          // Surplus résiduel (overflow VB)
          residual_surplus_kwh: residualSurplusKwh,
          limits: [
            "La batterie physique ne couvre que les cycles journaliers (charge le jour, décharge le soir).",
            "La batterie virtuelle absorbe le surplus saisonnier et le restitue en période froide.",
            "Une partie résiduelle du surplus peut rester non récupérable selon les saisons.",
          ],
        };
      })(),
      // P8 — source UNIQUE = scenarios_v2, JAMAIS snapshot. Conditionnel : null si pas de batterie.
      p7_vehicle_v2h: (() => {
        if (!isVehicleV2hSelected) return null;
        if (!selectedScenario || typeof selectedScenario !== "object") return null;

        const baseScenario = baseFromV2;
        const baseEnergy = baseScenario?.energy && typeof baseScenario.energy === "object" ? baseScenario.energy : {};
        const v2hEnergy = selectedScenario.energy && typeof selectedScenario.energy === "object" ? selectedScenario.energy : {};
        const v2h = selectedScenario.vehicle_v2h && typeof selectedScenario.vehicle_v2h === "object" ? selectedScenario.vehicle_v2h : {};
        const consumptionKwh = num(v2hEnergy.consumption_kwh) ?? num(baseEnergy.consumption_kwh);
        const productionKwh = num(v2hEnergy.production_kwh) ?? num(baseEnergy.production_kwh) ?? annualKwh;
        const baseImportKwh = canonicalGridImportKwh(baseEnergy);
        const finalImportKwh = canonicalGridImportKwhForPdf(v2hEnergy);
        const vehicleDischargeKwh = num(v2h.ev_v2h_discharge_kwh) ?? 0;
        const pluggedHours = num(v2h.ev_plugged_hours_year) ?? 0;
        const capacityKwh = num(v2h.capacity_kwh);
        const reservePct = num(v2h.min_reserve_pct);
        const reserveKwh = num(v2h.ev_reserve_kwh) ?? (capacityKwh != null && reservePct != null ? (capacityKwh * reservePct) / 100 : null);
        const usableForHomeKwh = capacityKwh != null && reserveKwh != null ? Math.max(0, capacityKwh - reserveKwh) : null;
        const solarChargeKwh = num(v2h.ev_solar_charge_kwh) ?? 0;
        const gridChargeKwh = num(v2h.ev_grid_charge_kwh) ?? 0;
        const tripKwh = num(v2h.ev_trip_consumption_kwh) ?? 0;
        const lossesKwh = num(v2h.ev_battery_losses_kwh) ?? 0;
        const physicalKwh =
          num(selectedScenario.battery_discharge_kwh) ??
          num(selectedScenario.energy?.physical_battery_discharge_kwh) ??
          num(selectedScenario.battery?.annual_discharge_kwh) ??
          0;
        const virtualKwh =
          num(v2hEnergy.used_credit_kwh) ??
          num(v2hEnergy.virtual_battery_discharge_kwh) ??
          num(selectedScenario.battery_virtual?.annual_discharge_kwh) ??
          0;
        const coveredKwh = coveredFromCanonicalImportKwh(v2hEnergy);
        const directAutoKwh =
          coveredKwh != null ? Math.max(0, coveredKwh - vehicleDischargeKwh - physicalKwh - virtualKwh) : null;
        const gridBoughtLessKwh =
          baseImportKwh != null && finalImportKwh != null ? baseImportKwh - finalImportKwh : null;
        const coveragePct =
          consumptionKwh != null && consumptionKwh > 0 && finalImportKwh != null
            ? Math.max(0, Math.min(100, ((consumptionKwh - finalImportKwh) / consumptionKwh) * 100))
            : null;
        const selectedLabel = SCENARIO_LABELS[selectedKey] || str(selectedKey);

        return {
          meta: { client: clientName, ref, date: dateDisplay, scenario_label: selectedLabel },
          title:
            selectedKey === "VEHICLE_V2H_PHYSICAL_VIRTUAL"
              ? "Voiture V2H + batteries : stockage en cascade"
              : selectedKey === "VEHICLE_V2H_PHYSICAL"
                ? "Voiture V2H + batterie physique"
                : selectedKey === "VEHICLE_V2H_VIRTUAL"
                  ? "Voiture V2H + batterie virtuelle"
                  : "Votre voiture comme batterie domestique",
          subtitle:
            "Quand elle est branchee, la batterie du vehicule peut restituer une partie de son energie a la maison. La reserve mobilite reste prioritaire.",
          kpis: {
            vehicle_discharge_kwh: vehicleDischargeKwh,
            grid_bought_less_kwh: gridBoughtLessKwh,
            final_grid_import_kwh: finalImportKwh,
            estimated_annual_bill_eur:
              num(selectedScenario?.finance?.estimated_annual_bill_eur) ??
              num(selectedScenario?.finance?.residual_bill_eur) ??
              num(financeActive?.residual_bill_eur),
            solar_coverage_pct: coveragePct,
          },
          vehicle: {
            capacity_kwh: capacityKwh,
            reserve_pct: reservePct,
            reserve_kwh: reserveKwh,
            usable_for_home_kwh: usableForHomeKwh,
            max_charge_kw: num(v2h.max_charge_kw),
            max_discharge_kw: num(v2h.max_discharge_kw),
            efficiency_pct: num(v2h.roundtrip_efficiency_pct),
            plugged_hours_year: pluggedHours,
            plugged_hours_week: pluggedHours > 0 ? pluggedHours / 52 : null,
          },
          energy: {
            production_kwh: productionKwh,
            consumption_kwh: consumptionKwh,
            direct_auto_kwh: directAutoKwh,
            physical_battery_kwh: physicalKwh,
            vehicle_v2h_kwh: vehicleDischargeKwh,
            virtual_battery_kwh: virtualKwh,
            solar_charge_kwh: solarChargeKwh,
            grid_charge_mobility_kwh: gridChargeKwh,
            trip_consumption_kwh: tripKwh,
            losses_kwh: lossesKwh,
            base_import_kwh: baseImportKwh,
            final_import_kwh: finalImportKwh,
          },
          cascade: {
            has_physical: selectedKey === "VEHICLE_V2H_PHYSICAL" || selectedKey === "VEHICLE_V2H_PHYSICAL_VIRTUAL",
            has_virtual: selectedKey === "VEHICLE_V2H_VIRTUAL" || selectedKey === "VEHICLE_V2H_PHYSICAL_VIRTUAL",
          },
          notes: [
            "La recharge reseau necessaire aux trajets est tracee a part : elle ne gonfle pas artificiellement les economies maison.",
            "Le vehicule ne decharge que lorsqu'il est branche et au-dessus de la reserve mobilite.",
            "Les gains dependent fortement des heures de presence a domicile.",
          ],
        };
      })(),
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

        const autonomieA =
          resolveSiteAutonomyPct(A) ?? num(A.energy_independence_pct) ?? num(A.independence_pct) ?? 0;
        const autonomieB =
          resolveSiteAutonomyPct(B) ?? num(B.energy_independence_pct) ?? num(B.independence_pct) ?? 0;
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
        } else if (batteryType === "HYBRID") {
          interpretation.ligne1 = "Votre configuration hybride valorise chaque kWh produit au maximum";
        } else {
          interpretation.ligne1 = "Votre batterie virtuelle valorise votre surplus d'énergie";
        }
        interpretation.ligne2 = `Vous gagnez ${Math.round(gainAutonomie)} points d'autonomie`;
        interpretation.ligne3 = `Vous réduisez vos achats réseau de ${Math.round(reductionAchatKwh)} kWh`;
        interpretation.texte_court =
          batteryType === "PHYSICAL"
            ? "Votre batterie stocke votre énergie produite en journée pour l'utiliser le soir, lorsque votre consommation est la plus élevée."
            : batteryType === "HYBRID"
              ? "Votre batterie physique gère les cycles journaliers (jour → soir). Le surplus résiduel est ensuite converti en crédits virtuels qui réduisent vos factures d'import en saison froide."
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
          const kwhProj = Math.round(reductionAchatKwh * horizonYearsPdf);
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
            billable_import_kwh: numOrZero(canonicalGridImportKwh(B)),
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
       * P9 — scénario final : selected_scenario_snapshot prioritaire.
       * En preview seulement, si le snapshot ne correspond pas au scénario demandé,
       * scenarios_v2 peut compléter les champs manquants.
       */
      p9: (() => {
        const p9Key = selectedKey;
        const p9HorizonMeta = Math.max(1, Math.min(50, Math.floor(Number(horizonYearsPdf)) || 25));
        const meta = { client: clientName, ref, date: dateDisplay, horizon_years_pdf: p9HorizonMeta };

        const notFound = {
          meta,
          scenario: null,
          error: "SCENARIO_NOT_FOUND",
          warnings: [],
        };

        if (p9Key == null || p9Key === "") {
          return notFound;
        }

        const scenario = selectedScenario;
        if (!scenario || typeof scenario !== "object") {
          return notFound;
        }

        const flows = Array.isArray(scenario.finance?.annual_cashflows)
          ? scenario.finance.annual_cashflows
          : Array.isArray(scenario.cashflows)
            ? scenario.cashflows
            : [];
        const p9Horizon = p9HorizonMeta;

        const buildCumul25yP9 = (sc) => {
          const f = sc.finance?.annual_cashflows ?? [];
          return Array.from({ length: p9Horizon }, (_, i) => {
            const row = f[i] ?? f.find((x) => num(x?.year) === i + 1);
            return num(row?.cumul_eur ?? row?.cumul);
          });
        };

        function yearlyNetFromFlow(row) {
          if (!row || typeof row !== "object") return null;
          const t = num(row.total_eur);
          if (t != null && Number.isFinite(t)) return t;
          const g = num(row.gain);
          if (g != null && Number.isFinite(g)) return g;
          const ga = num(row.gain_auto);
          const go = num(row.gain_oa);
          if (ga != null || go != null) return (ga ?? 0) + (go ?? 0);
          return null;
        }

        function avgSavingsFromFlowsOnly(f) {
          if (!Array.isArray(f) || f.length === 0) return null;
          let sum = 0;
          let n = 0;
          for (let i = 0; i < Math.min(p9Horizon, f.length); i++) {
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
          const yLast = num(arr[p9Horizon - 1]);
          if (yLast != null) return yLast;
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
          avg_savings_eur_year * p9Horizon < cumul_gains_end
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
          horizon_years_finance: horizonYearsPdf,
          lcoe_eur_kwh: lcoeVal,
          nb_panels: numOrZero(installation.panneaux_nombre),
          /* Source unique : même production que P3/P7 (scénario sélectionné), fallback canonique. */
          annual_production_kwh: num(selectedScenario?.energy?.production_kwh) ?? annualKwh,
        },
        hyp: {
          pv_degrad: econDisplay.pv_degradation_pct,
          elec_infl: econDisplay.elec_growth_pct,
          oa_price: econDisplay.oa_rate_eur_kwh,
          price_kwh: econDisplay.price_eur_kwh,
          horizon_years: econDisplay.horizon_years,
          prime_autoconso_eur: primeAmount,
        },
        residual_bill_virtual:
          finance.residual_bill_virtual_breakdown ??
          buildResidualBillVirtualVmFromScenario(selectedScenario),
      },
      p11: p11Section,
      p12: {
        meta: { client: clientName, ref, date: dateDisplay, horizon_years_pdf: horizonYearsPdf },
        env: { autocons_pct: pvSelfConsumptionPct ?? selfConsumptionPct ?? 0 },
        v_co2: `${co2Evite.toLocaleString("fr-FR")} kg`,
        v_trees: treesEquiv.toString(),
        v_cars: carsEquiv.toString(),
        v_co2_25: `${(co2Evite * horizonYearsPdf).toLocaleString("fr-FR")} kg`,
        v_trees_25: (treesEquiv * horizonYearsPdf).toString(),
        v_cars_25: (carsEquiv * horizonYearsPdf).toString(),
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

export function validatePdfViewModelCoherence(vm, tolerance = { kwh: 1, eur: 1 }) {
  const issues = [];
  const tKwh = tolerance?.kwh ?? 1;
  const tEur = tolerance?.eur ?? 1;
  const n = (v) => (v == null || v === "" || Number.isNaN(Number(v)) ? null : Number(v));
  const diff = (a, b) => Math.abs(Number(a) - Number(b));
  const push = (code, details = {}) => issues.push({ code, ...details });
  const fr = vm?.fullReport ?? {};
  const p4 = fr.p4 ?? {};
  const p6 = fr.p6?.p6 ?? {};
  const p7 = fr.p7 ?? {};
  const p10 = fr.p10?.best ?? {};

  const production = n(p4.production_annuelle);
  const productionRefs = [
    ["root.production.annualProductionKwh", n(vm?.production?.annualProductionKwh)],
    ["p6.totals.production_kwh", n(p6?.totals?.production_kwh)],
    ["p7.production_kwh", n(p7.production_kwh)],
    ["p10.best.annual_production_kwh", n(p10.annual_production_kwh)],
  ];
  for (const [path, value] of productionRefs) {
    if (production != null && value != null && diff(production, value) > tKwh) {
      push("PDF_PRODUCTION_ANNUAL_MISMATCH", { path, expected: production, actual: value });
    }
  }

  const autoKwh = n(p4.energie_solaire_valorisee ?? p7.autoconsumption_kwh);
  const injectedKwh = n(p4.energie_injectee ?? p7.p_surplus);
  const consoKwh = n(p4.consommation_annuelle ?? p7.consumption_kwh);
  const importKwh = n(p4.reste_reseau_kwh ?? p7.energy_grid_import_kwh);
  if (production != null && autoKwh != null && injectedKwh != null && diff(autoKwh + injectedKwh, production) > tKwh) {
    push("PDF_ENERGY_PRODUCTION_SPLIT_MISMATCH", { production, autoKwh, injectedKwh });
  }
  if (consoKwh != null && autoKwh != null && importKwh != null && diff(autoKwh + importKwh, consoKwh) > tKwh) {
    push("PDF_ENERGY_CONSUMPTION_SPLIT_MISMATCH", { consoKwh, autoKwh, importKwh });
  }

  const coverage = n(p4.couverture_besoins_pct ?? p7.solar_coverage_pct);
  const pvSelf = n(p4.taux_autoconsommation_pct ?? p7?.pct?.p_auto_pct);
  const expectedCoverage = consoKwh > 0 && autoKwh != null ? (autoKwh / consoKwh) * 100 : null;
  const expectedPvSelf = production > 0 && autoKwh != null ? (autoKwh / production) * 100 : null;
  if (coverage != null && expectedCoverage != null && Math.abs(Math.round(expectedCoverage) - Math.round(coverage)) > 1) {
    push("PDF_COVERAGE_RATIO_MISMATCH", { coverage, expected: expectedCoverage });
  }
  if (pvSelf != null && expectedPvSelf != null && Math.abs(Math.round(expectedPvSelf) - Math.round(pvSelf)) > 1) {
    push("PDF_SELF_CONSUMPTION_RATIO_MISMATCH", { pvSelf, expected: expectedPvSelf });
  }
  if (coverage != null && pvSelf != null && Math.round(coverage) === Math.round(pvSelf) && production != null && consoKwh != null && diff(production, consoKwh) > tKwh) {
    push("PDF_COVERAGE_AND_SELF_CONSUMPTION_SAME_VALUE", { coverage, pvSelf, production, consoKwh });
  }

  const p2 = fr.p2?.p2_auto ?? {};
  const capex = n(vm?.economics?.capex);
  const prime = n(p2.p2_prime_raw_eur);
  const reste = n(p2.p2_reste_charge_raw_eur);
  if (capex != null && prime != null && reste != null && diff(capex - prime, reste) > tEur) {
    push("PDF_CAPEX_PRIME_RESTE_MISMATCH", { capex, prime, reste });
  }
  return issues;
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
    p7_virtual_battery: null,
    p7_hybrid_battery: null,
    p7_vehicle_v2h: null,
    p8: null,
    p9: {
      meta: emptyMeta,
      scenario: null,
      error: null,
      warnings: [],
    },
    p10: { meta: emptyMeta, best: {}, hyp: {}, residual_bill_virtual: null },
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
    p12: {
      meta: { ...emptyMeta, horizon_years_pdf: 25 },
      env: {},
      v_co2: "",
      v_trees: "",
      v_cars: "",
      v_co2_25: "",
      v_trees_25: "",
      v_cars_25: "",
    },
    p13: { meta: emptyMeta },
    p14: { meta: emptyMeta },
  };
}
