import { installerError } from "./installers.errors.js";

export const INSTALLATION_TYPES = Object.freeze(["ROOF_SUPERIMPOSED", "FLAT_ROOF", "GROUND"]);
export const ELECTRICAL_TYPES = Object.freeze(["MONO", "TRI"]);
export const CALCULATION_VERSION = "installer-pricing-v1";

const BATTERY_OPTION_CODES = Object.freeze(["BATTERY_UP_TO_5_KWH", "BATTERY_OVER_5_KWH"]);

const CONDITIONAL_OPTION_AMOUNTS_HT_CENTS = Object.freeze({
  GRID_CONNECTION_CONSUEL: Object.freeze({
    withoutBattery: 35000,
    withBattery: 40000,
  }),
});

function asPositiveInt(value, code, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n <= 0) {
    throw installerError(code, `${label} invalide`, 400, { value });
  }
  return n;
}

function asNonNegativeInt(value, code, label) {
  const n = Number(value);
  if (!Number.isInteger(n) || n < 0) {
    throw installerError(code, `${label} invalide`, 400, { value });
  }
  return n;
}

function normalizeCode(value) {
  return String(value ?? "").trim().toUpperCase();
}

function normalizeCatalog(catalog) {
  const grids = new Map((catalog?.grids || []).map((grid) => [String(grid.id), grid]));
  const rowsByGrid = new Map();
  for (const row of catalog?.tariff_rows || []) {
    const key = String(row.pricing_grid_id);
    if (!rowsByGrid.has(key)) rowsByGrid.set(key, []);
    rowsByGrid.get(key).push(row);
  }
  for (const rows of rowsByGrid.values()) {
    rows.sort((a, b) => Number(a.power_wc) - Number(b.power_wc));
  }

  return {
    installer: catalog?.installer,
    tariff_version: catalog?.tariff_version,
    grids,
    rowsByGrid,
    mappingsByType: new Map((catalog?.installation_type_mappings || []).map((m) => [m.installation_type, m])),
    electricalByType: new Map((catalog?.electrical_rules || []).map((rule) => [rule.electrical_type, rule])),
    optionsByCode: new Map((catalog?.options || []).map((option) => [normalizeCode(option.code), option])),
  };
}

function buildElectricalAdjustment(rule, electricalType) {
  if (!rule) {
    throw installerError("ELECTRICAL_RULE_NOT_FOUND", "Règle électrique introuvable", 400, { electrical_type: electricalType });
  }

  if (rule.rule_type === "NONE") return null;
  if (rule.rule_type === "FIXED_SURCHARGE") {
    return {
      code: `${electricalType}_SURCHARGE`,
      label: rule.label || `Supplément ${electricalType}`,
      rule_type: rule.rule_type,
      amount_ht_cents: asNonNegativeInt(rule.amount_ht_cents, "INVALID_ELECTRICAL_AMOUNT", "Montant électrique"),
    };
  }

  throw installerError("UNSUPPORTED_ELECTRICAL_RULE", "Type de règle électrique non supporté", 400, {
    electrical_type: electricalType,
    rule_type: rule.rule_type,
  });
}

function resolveCatalogOptionAmount(option, context = {}) {
  const code = normalizeCode(option?.code);
  const conditionalAmounts = CONDITIONAL_OPTION_AMOUNTS_HT_CENTS[code];
  if (conditionalAmounts) {
    return context.hasBatteryOption ? conditionalAmounts.withBattery : conditionalAmounts.withoutBattery;
  }
  return asNonNegativeInt(option.amount_ht_cents, "INVALID_OPTION_AMOUNT", "Montant option");
}

function normalizeSelectedOptions(selectedOptions, optionsByCode) {
  const selected = Array.isArray(selectedOptions) ? selectedOptions : [];
  const seen = new Set();
  const groups = new Map();
  const normalized = [];
  const selectedCodes = selected.map((raw) => normalizeCode(typeof raw === "string" ? raw : raw?.code));
  const hasBatteryOption = selectedCodes.some((code) => BATTERY_OPTION_CODES.includes(code));

  for (const raw of selected) {
    const code = normalizeCode(typeof raw === "string" ? raw : raw?.code);
    if (!code) {
      throw installerError("INVALID_OPTION", "Option installateur invalide", 400, { option: raw });
    }
    if (seen.has(code)) continue;
    seen.add(code);

    const option = optionsByCode.get(code);
    if (!option) throw installerError("UNKNOWN_OPTION", "Option inconnue", 400, { code });
    if (option.is_active === false || option.is_selectable_for_installation === false) {
      throw installerError("OPTION_NOT_SELECTABLE", "Option non sélectionnable pour une installation", 400, { code });
    }

    const catalogAmount = resolveCatalogOptionAmount(option, { hasBatteryOption });
    let finalAmount = catalogAmount;
    let override = null;
    if (typeof raw === "object" && raw?.amount_ht_cents_override != null) {
      if (!option.is_amount_overridable) {
        throw installerError("OPTION_OVERRIDE_NOT_ALLOWED", "Override non autorisé pour cette option", 400, { code });
      }
      finalAmount = asNonNegativeInt(raw.amount_ht_cents_override, "INVALID_OPTION_OVERRIDE", "Override option");
      override = {
        code,
        catalog_amount_ht_cents: catalogAmount,
        override_amount_ht_cents: finalAmount,
      };
    }

    const group = option.incompatible_group ? String(option.incompatible_group) : "";
    if (group) {
      if (!groups.has(group)) groups.set(group, []);
      groups.get(group).push(code);
    }

    normalized.push({
      code,
      label: option.label,
      category: option.category,
      catalog_amount_ht_cents: catalogAmount,
      final_amount_ht_cents: finalAmount,
      ...(override ? { override } : {}),
    });
  }

  for (const [group, codes] of groups.entries()) {
    if (codes.length > 1) {
      throw installerError("INCOMPATIBLE_OPTIONS", "Options incompatibles sélectionnées ensemble", 400, { group, codes });
    }
  }

  return normalized;
}

export function computeInstallationCostFromCatalog(catalog, input = {}) {
  const normalized = normalizeCatalog(catalog);
  const requestedPowerWc = asPositiveInt(input.requested_power_wc ?? input.power_wc, "INVALID_POWER", "Puissance demandée");
  const installationType = normalizeCode(input.installation_type);
  const electricalType = normalizeCode(input.electrical_type);

  if (!INSTALLATION_TYPES.includes(installationType)) {
    throw installerError("INVALID_INSTALLATION_TYPE", "Type d'installation invalide", 400, { installation_type: input.installation_type });
  }
  if (!ELECTRICAL_TYPES.includes(electricalType)) {
    throw installerError("INVALID_ELECTRICAL_TYPE", "Type électrique invalide", 400, { electrical_type: input.electrical_type });
  }

  const mapping = normalized.mappingsByType.get(installationType);
  if (!mapping) {
    throw installerError("UNSUPPORTED_INSTALLATION_TYPE", "Aucune grille pour ce type d'installation", 400, { installation_type: installationType });
  }

  const gridId = String(mapping.pricing_grid_id);
  const grid = normalized.grids.get(gridId);
  const rows = normalized.rowsByGrid.get(gridId) || [];
  const matchedRow = rows.find((row) => Number(row.power_wc) >= requestedPowerWc);
  if (!matchedRow) {
    throw installerError("NO_TARIFF_FOR_POWER", "Aucun tarif pour cette puissance", 422, {
      requested_power_wc: requestedPowerWc,
      max_power_wc: rows.length ? Number(rows[rows.length - 1].power_wc) : null,
    });
  }

  const baseAmount = asNonNegativeInt(matchedRow.amount_ht_cents, "INVALID_BASE_AMOUNT", "Montant de base");
  const electricalAdjustment = buildElectricalAdjustment(normalized.electricalByType.get(electricalType), electricalType);
  const electricalAdjustments = electricalAdjustment ? [electricalAdjustment] : [];
  const options = normalizeSelectedOptions(input.options, normalized.optionsByCode);
  const optionOverrides = options.filter((option) => option.override).map((option) => option.override);

  const electricalCatalogTotal = electricalAdjustments.reduce((sum, item) => sum + item.amount_ht_cents, 0);
  const optionsCatalogTotal = options.reduce((sum, item) => sum + item.catalog_amount_ht_cents, 0);
  const optionsFinalTotal = options.reduce((sum, item) => sum + item.final_amount_ht_cents, 0);
  const catalogTotal = baseAmount + electricalCatalogTotal + optionsCatalogTotal;
  let finalTotal = baseAmount + electricalCatalogTotal + optionsFinalTotal;

  let manualOverride = null;
  if (input.manual_override_ht_cents != null || input.global_override_ht_cents != null) {
    const overrideAmount = asNonNegativeInt(
      input.manual_override_ht_cents ?? input.global_override_ht_cents,
      "INVALID_MANUAL_OVERRIDE",
      "Override global"
    );
    const reason = String(input.manual_override_reason ?? input.global_override_reason ?? "").trim();
    if (!reason) {
      throw installerError("MANUAL_OVERRIDE_REASON_REQUIRED", "La raison est obligatoire pour un override global", 400);
    }
    manualOverride = {
      amount_ht_cents: overrideAmount,
      reason,
    };
    finalTotal = overrideAmount;
  }

  return {
    installer: normalized.installer,
    tariff_version: normalized.tariff_version,
    requested_power_wc: requestedPowerWc,
    matched_power_wc: Number(matchedRow.power_wc),
    panel_count_hint: matchedRow.panel_count_hint == null ? null : Number(matchedRow.panel_count_hint),
    installation_type: installationType,
    electrical_type: electricalType,
    pricing_grid: grid
      ? {
          id: grid.id,
          code: grid.code,
          label: grid.label,
        }
      : null,
    base_amount_ht_cents: baseAmount,
    electrical_adjustments: electricalAdjustments,
    options,
    catalog_total_ht_cents: catalogTotal,
    option_overrides: optionOverrides,
    manual_override: manualOverride,
    final_total_ht_cents: finalTotal,
    warnings: [],
    calculated_at: new Date().toISOString(),
    calculation_version: CALCULATION_VERSION,
  };
}
