// ======================================================================
// SMARTPITCH V5 — AUDIT ÉNERGÉTIQUE & FINANCIER ULTIME
// Version entièrement réécrite (Solarglobe, 2025)
// ======================================================================
//
// Objectif : fournir un audit complet, pro, lisible et cohérent avec :
//   - PVGIS V5
//   - Simulation physique 8760h
//   - Scénarios A/B version réaliste
//   - Pricing Soltéa
//   - Finance (ROI, TRI, LCOE)
//   - PDF SmartPitch-Solarglobe
//
// Renvoie :
//   {
//     ok: boolean,
//     issues: string[],
//     summary: {...}
//   }
//
// ======================================================================

import { round } from "./utils/helpers.js";

// ======================================================================
// 1. AUDIT PRINCIPAL
// ======================================================================
export function auditAll(ctx, conso, prod, scenarios, { fatal = false } = {}) {

  const issues = [];

  auditPV(prod, issues);
  auditConso(conso, issues);
  auditSite(ctx, issues);
  auditScenarios(scenarios, issues);
  auditFinance(scenarios, issues);

  const ok = issues.length === 0;

  if (fatal && !ok) {
    throw new Error("Audit SmartPitch — incohérences : " + issues.join(" | "));
  }

  return {
    ok,
    issues,
    summary: buildAuditSummary(ctx, conso, prod, scenarios)
  };
}

// ======================================================================
// 2. VALIDATION PRODUCTION PV
// ======================================================================
function auditPV(prod, issues) {
  if (!prod) {
    issues.push("PV: données absentes.");
    return;
  }

  if (!Array.isArray(prod.hourly) || prod.hourly.length !== 8760) {
    issues.push("PV: profil horaire invalide (8760h requis).");
  }

  if (!Array.isArray(prod.monthly) || prod.monthly.length !== 12) {
    issues.push("PV: profil mensuel invalide (12 mois requis).");
  }

  const sumMonthly = sum(prod.monthly);
  if (Math.abs(sumMonthly - (prod.total_kwh || 0)) > 5) {
    issues.push("PV: somme mensuelle ≠ total_kwh (écart > 5 kWh).");
  }

  if (prod.total_kwh < 2000 || prod.total_kwh > 22000) {
    issues.push("PV: production annuelle improbable.");
  }
}

// ======================================================================
// 3. VALIDATION CONSOMMATION
// ======================================================================
function auditConso(conso, issues) {
  if (!conso) {
    issues.push("Conso: données absentes.");
    return;
  }

  if (!Array.isArray(conso.hourly) || conso.hourly.length !== 8760) {
    issues.push("Conso: profil horaire invalide (8760h requis).");
  }

  if (!Array.isArray(conso.monthly) || conso.monthly.length !== 12) {
    issues.push("Conso: profil mensuel invalide.");
  }

  const sumMonthly = sum(conso.monthly);
  if (Math.abs(sumMonthly - (conso.annuelle_kwh || 0)) > 5) {
    issues.push("Conso: somme mensuelle ≠ annuelle_kwh (écart > 5 kWh).");
  }

  if (conso.annuelle_kwh < 500 || conso.annuelle_kwh > 50000) {
    issues.push("Conso: consommation annuelle improbable.");
  }
}

// ======================================================================
// 4. VALIDATION SITE (coords + orientation + inclinaison)
// ======================================================================
function auditSite(ctx, issues) {
  const lat = ctx.site?.lat;
  const lon = ctx.site?.lon;

  if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) {
    issues.push("Site: lat/lon absents — PVGIS en fallback.");
  }

  const inc = ctx.site?.inclinaison;
  if (!isFiniteNumber(inc) || inc < 0 || inc > 60) {
    issues.push("Site: inclinaison incohérente (0–60° recommandé).");
  }
}

// ======================================================================
// 5. VALIDATION SCÉNARIOS A/B
// ======================================================================
function auditScenarios(scenarios, issues) {
  if (!scenarios) {
    issues.push("Scénarios: aucun scénario généré.");
    return;
  }

  const keys = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL"];
  for (const key of keys) {
    const sc = scenarios[key];
    if (!sc) continue;

    // cohérence auto_kwh ≤ prod_kwh
    if (sc.auto_kwh > sc.prod_kwh) {
      issues.push(`Scénario ${key}: autoconso > production.`);
    }

    // cohérence surplus ≥ 0
    if (sc.surplus_kwh < 0) {
      issues.push(`Scénario ${key}: surplus négatif.`);
    }

    // cohérence auto_pct
    if (sc.auto_pct < 0 || sc.auto_pct > 100) {
      issues.push(`Scénario ${key}: auto_pct hors bornes.`);
    }

    // cohérence gain année 1
    if (!isFiniteNumber(sc.gainAn1) || sc.gainAn1 < 0) {
      issues.push(`Scénario ${key}: gain année 1 invalide.`);
    }

    // cohérence capex (V2 : capex injecté peut être null)
    if (sc._v2 !== true && (!isFiniteNumber(sc.capex_ttc) || sc.capex_ttc <= 0)) {
      issues.push(`Scénario ${key}: capex invalide.`);
    }
  }

}

// ======================================================================
// 6. VALIDATION FINANCIÈRE
// ======================================================================
function auditFinance(scenarios, issues) {
  if (!scenarios) return;

  const keys = ["BASE", "BATTERY_PHYSICAL", "BATTERY_VIRTUAL"];

  for (const key of keys) {
    const sc = scenarios[key];
    if (!sc) continue;
    if (sc._v2 === true || sc.capex_ttc == null) continue;

    // ROI (V2 : roi_years uniquement)
    if (!isFiniteNumber(sc.roi_years)) {
      issues.push(`Finance ${key}: ROI invalide.`);
    }

    // TRI / IRR
    if (sc.irr_pct !== null && (sc.irr_pct < -20 || sc.irr_pct > 40)) {
      issues.push(`Finance ${key}: TRI hors bornes (+/-40%).`);
    }

    // LCOE
    if (sc.lcoe_eur_kwh && sc.lcoe_eur_kwh > 0.8) {
      issues.push(`Finance ${key}: LCOE > 0.8 €/kWh — incohérent.`);
    }
  }
}

// ======================================================================
// 7. RÉSUMÉ AUDIT (affiché dans dashboard + PDF)
// ======================================================================
function buildAuditSummary(ctx, conso, prod, scenarios) {
  return {
    client: `${ctx.meta?.client_nom || "—"} (${ctx.meta?.client_ville || "—"})`,
    prod_kwh: prod?.total_kwh ?? 0,
    conso_kwh: conso?.annuelle_kwh ?? 0,
    scenarios: Object.fromEntries(
      Object.entries(scenarios || {}).map(([k, sc]) => [
        k,
        {
          kwc: sc.kwc,
          auto_pct: sc.auto_pct,
          gainAn1: round(sc.gainAn1, 0),
          capex: round(sc.capex_ttc, 0),
        }
      ])
    )
  };
}

// ======================================================================
// UTILS
// ======================================================================
function isFiniteNumber(v) {
  return typeof v === "number" && isFinite(v);
}
function sum(arr = []) {
  return arr.reduce((a, b) => a + (Number(b) || 0), 0);
}
