const KWH_KEYS = {
  production: "productionPV",
  consumption: "consommation",
  direct: "autoconsommationDirecte",
  credited: "surplusCredite",
  restored: "creditVirtuelRestitue",
  unvalued: "productionNonValorisee",
  importGrid: "importReseau",
  covered: "energieCouverte",
};

function num(v) {
  if (v == null || v === "" || Number.isNaN(Number(v))) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function numOrZero(v) {
  return num(v) ?? 0;
}

function roundTo(value, digits = 3) {
  const n = num(value);
  if (n == null) return null;
  const f = 10 ** digits;
  return Math.round(n * f) / f;
}

export function reconcileRoundedParts(totalRaw, partsRaw) {
  const total = Math.round(numOrZero(totalRaw));
  const parts = (partsRaw || []).map((value, index) => {
    const raw = numOrZero(value);
    const floor = Math.floor(raw);
    return { index, raw, floor, remainder: raw - floor };
  });
  let remaining = total - parts.reduce((sum, part) => sum + part.floor, 0);
  const sorted = parts.slice().sort((a, b) => b.remainder - a.remainder || a.index - b.index);
  const out = parts.map((part) => part.floor);

  if (remaining > 0) {
    while (remaining > 0 && sorted.length > 0) {
      for (const part of sorted) {
        if (remaining <= 0) break;
        out[part.index] += 1;
        remaining -= 1;
      }
    }
  } else if (remaining < 0) {
    while (remaining < 0 && sorted.length > 0) {
      let moved = false;
      for (const part of sorted.slice().reverse()) {
        if (remaining >= 0) break;
        if (out[part.index] <= 0) continue;
        out[part.index] -= 1;
        remaining += 1;
        moved = true;
      }
      if (!moved) break;
    }
  }

  return { total, parts: out };
}

export function reconcilePercentParts(partsRaw) {
  const totalRaw = (partsRaw || []).reduce((sum, value) => sum + numOrZero(value), 0);
  if (totalRaw <= 0) return (partsRaw || []).map(() => 0);
  const normalized = (partsRaw || []).map((value) => (numOrZero(value) / totalRaw) * 100);
  return reconcileRoundedParts(100, normalized).parts;
}

function monthlyArray(source, key) {
  const arr = Array.isArray(source) ? source : [];
  return arr.slice(0, 12).map((m) => numOrZero(m?.[key]));
}

export function buildPdfEnergyCanonical({ scenario, baseScenario } = {}) {
  const energy = scenario?.energy && typeof scenario.energy === "object" ? scenario.energy : {};
  const baseEnergy = baseScenario?.energy && typeof baseScenario.energy === "object" ? baseScenario.energy : {};
  const id = scenario?.id ?? scenario?.name ?? null;
  const isVirtual =
    id === "BATTERY_VIRTUAL" ||
    id === "BATTERY_HYBRID" ||
    String(id || "").includes("VIRTUAL");

  const consumption = num(energy.consumption_kwh ?? energy.conso) ?? 0;
  const direct =
    num(energy.direct_self_consumption_kwh) ??
    num(energy.total_pv_used_on_site_kwh) ??
    num(energy.autoconsumption_kwh) ??
    0;
  const overflow =
    num(energy.overflow_export_kwh) ??
    num(energy.virtual_battery_overflow_export_kwh) ??
    num(energy.grid_export_kwh) ??
    num(energy.exported_kwh) ??
    0;
  const fullVirtualValuation = isVirtual && Math.abs(overflow) <= 1;

  const restoredRaw =
    num(energy.virtual_battery_discharge_kwh) ??
    num(energy.used_credit_kwh) ??
    num(energy.restored_kwh) ??
    num(energy.battery_discharge_kwh) ??
    num(scenario?.battery_virtual?.annual_discharge_kwh) ??
    num(scenario?.battery_virtual?.restored_kwh);
  const creditedRaw =
    num(energy.surplus_used_by_virtual_battery_kwh) ??
    num(energy.credited_kwh) ??
    num(scenario?.battery_virtual?.annual_charge_kwh) ??
    num(scenario?.battery_virtual?.credited_kwh) ??
    (isVirtual ? restoredRaw : null);

  let production =
    num(energy.production_kwh ?? energy.prod) ??
    num(scenario?.prod_kwh) ??
    Math.max(0, direct + numOrZero(creditedRaw) + Math.max(0, overflow));
  let unvalued = Math.max(0, overflow);
  let credited = numOrZero(creditedRaw);
  let restored = numOrZero(restoredRaw);
  const explicitImportGrid =
    num(energy.billable_import_kwh) ??
    num(energy.energy_grid_import_kwh) ??
    num(energy.grid_import_kwh) ??
    num(energy.import_kwh) ??
    num(energy.import);
  let importGrid =
    explicitImportGrid ??
    Math.max(0, consumption - direct - restored);

  if (fullVirtualValuation) {
    unvalued = 0;
    production = Math.max(production, direct + credited);
    credited = Math.max(0, production - direct);
    importGrid = explicitImportGrid ?? Math.max(0, consumption - production);
    restored = Math.max(0, consumption - direct - importGrid);
  }

  const covered = Math.min(consumption, Math.max(0, direct + restored));
  const productionRounded = reconcileRoundedParts(production, [direct, credited, unvalued]);
  const consumptionRounded = reconcileRoundedParts(consumption, [direct, restored, importGrid]);
  const consumptionPct = reconcilePercentParts([direct, restored, importGrid]);
  const productionPct = reconcilePercentParts([direct, credited, unvalued]);

  return {
    keys: KWH_KEYS,
    scenario_id: id,
    is_virtual_credit_scenario: isVirtual,
    full_virtual_valuation: fullVirtualValuation,
    raw: {
      productionPV: roundTo(production),
      consommation: roundTo(consumption),
      autoconsommationDirecte: roundTo(direct),
      surplusCredite: roundTo(credited),
      creditVirtuelRestitue: roundTo(restored),
      productionNonValorisee: roundTo(unvalued),
      importReseau: roundTo(importGrid),
      energieCouverte: roundTo(covered),
      tauxCouverture: consumption > 0 ? roundTo(covered / consumption, 6) : null,
    },
    display: {
      productionPV: productionRounded.total,
      autoconsommationDirecte: productionRounded.parts[0],
      surplusCredite: productionRounded.parts[1],
      productionNonValorisee: productionRounded.parts[2],
      consommation: consumptionRounded.total,
      creditVirtuelRestitue: consumptionRounded.parts[1],
      importReseau: consumptionRounded.parts[2],
      energieCouverte: consumptionRounded.parts[0] + consumptionRounded.parts[1],
      tauxCouverturePct: consumption > 0 ? Math.round((covered / consumption) * 100) : 0,
      tauxCouverturePctRaw: consumption > 0 ? (covered / consumption) * 100 : 0,
      repartitionConsommationPct: {
        pvDirect: consumptionPct[0],
        creditVirtuel: consumptionPct[1],
        reseau: consumptionPct[2],
      },
      repartitionProductionPct: {
        pvDirect: productionPct[0],
        creditVirtuel: productionPct[1],
        nonValorisee: productionPct[2],
      },
    },
    monthly: {
      consommation: monthlyArray(energy.monthly, "conso"),
      autoconsommationDirecte: monthlyArray(energy.monthly, "direct_self_consumption_kwh"),
      creditVirtuelRestitue: monthlyArray(energy.billable_monthly, "used_credit"),
      importReseau: monthlyArray(energy.billable_monthly, "billable_import"),
      productionPV: monthlyArray(energy.monthly, "prod"),
      surplusCredite: monthlyArray(energy.monthly, "virtual_battery_charge_kwh"),
    },
    base: {
      autonomieSansCreditPct:
        consumption > 0
          ? ((num(baseEnergy.direct_self_consumption_kwh) ?? num(baseEnergy.autoconsumption_kwh) ?? num(baseEnergy.auto) ?? direct) / consumption) * 100
          : 0,
    },
  };
}
