export type InstallationType = "ROOF_SUPERIMPOSED" | "FLAT_ROOF" | "GROUND";
export type ElectricalType = "MONO" | "TRI";
export type TariffVersionStatus = "DRAFT" | "ACTIVE" | "ARCHIVED";

export interface InstallerListRow {
  id: string;
  name: string;
  legal_name?: string | null;
  is_active: boolean;
  updated_at?: string | null;
  active_tariff_version_id?: string | null;
  active_tariff_version_label?: string | null;
  active_tariff_effective_from?: string | null;
  zones?: InstallerZone[];
}

export interface InstallerZone {
  id?: string;
  zone_type: "DEPARTMENT" | "POSTAL_CODE" | "CUSTOM";
  zone_code: string;
  label?: string | null;
}

export interface Installer {
  id: string;
  name: string;
  legal_name?: string | null;
  siret?: string | null;
  contact_name?: string | null;
  contact_email?: string | null;
  contact_phone?: string | null;
  address_json?: Record<string, unknown> | null;
  qualifications_json?: Record<string, unknown> | null;
  notes?: string | null;
  is_active: boolean;
  created_at?: string | null;
  updated_at?: string | null;
  zones?: InstallerZone[];
  tariff_versions?: InstallerTariffVersion[];
  active_tariff?: InstallerTariffCatalog | null;
}

export interface InstallerTariffVersion {
  id: string;
  installer_id: string;
  version_label: string;
  status: TariffVersionStatus;
  effective_from?: string | null;
  effective_to?: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

export interface InstallerPricingGrid {
  id: string;
  code: string;
  label: string;
}

export interface InstallerTypeMapping {
  installation_type: InstallationType;
  pricing_grid_id: string;
}

export interface InstallerTariffRow {
  id?: string;
  pricing_grid_id: string;
  power_wc: number;
  panel_count_hint?: number | null;
  amount_ht_cents: number;
  sort_order?: number;
}

export interface InstallerElectricalRule {
  id?: string;
  electrical_type: ElectricalType;
  rule_type: "NONE" | "FIXED_SURCHARGE" | "SEPARATE_GRID" | "POWER_BASED";
  amount_ht_cents: number;
  pricing_grid_id?: string | null;
  config_json?: Record<string, unknown>;
}

export interface InstallerOption {
  id?: string;
  code: string;
  label: string;
  category: string;
  amount_ht_cents: number;
  is_selectable_for_installation: boolean;
  is_amount_overridable: boolean;
  incompatible_group?: string | null;
  is_active: boolean;
  sort_order?: number;
}

export interface InstallerAncillaryService {
  id?: string;
  code: string;
  label: string;
  category: string;
  amount_ht_cents: number;
  is_active: boolean;
  sort_order?: number;
}

export interface InstallerTariffCatalog {
  installer: Installer;
  zones: InstallerZone[];
  tariff_version: InstallerTariffVersion;
  grids: InstallerPricingGrid[];
  installation_type_mappings: InstallerTypeMapping[];
  tariff_rows: InstallerTariffRow[];
  electrical_rules: InstallerElectricalRule[];
  options: InstallerOption[];
  ancillary_services: InstallerAncillaryService[];
}

export interface InstallerCostOptionInput {
  code: string;
  amount_ht_cents_override?: number;
}

export interface InstallerCostResult {
  installer: { id: string; name: string };
  tariff_version: InstallerTariffVersion;
  requested_power_wc: number;
  matched_power_wc: number;
  panel_count_hint?: number | null;
  installation_type: InstallationType;
  electrical_type: ElectricalType;
  pricing_grid?: { id: string; code: string; label: string } | null;
  base_amount_ht_cents: number;
  electrical_adjustments: Array<{ code: string; label: string; rule_type: string; amount_ht_cents: number }>;
  options: Array<{
    code: string;
    label: string;
    category: string;
    catalog_amount_ht_cents: number;
    final_amount_ht_cents: number;
    override?: {
      code: string;
      catalog_amount_ht_cents: number;
      override_amount_ht_cents: number;
    };
  }>;
  catalog_total_ht_cents: number;
  option_overrides: Array<{
    code: string;
    catalog_amount_ht_cents: number;
    override_amount_ht_cents: number;
  }>;
  manual_override?: { amount_ht_cents: number; reason: string } | null;
  vat_rate_percent?: number;
  vat_rate_bps?: number;
  final_total_ht_cents: number;
  final_total_vat_cents?: number;
  final_total_ttc_cents?: number;
  warnings: string[];
  calculated_at: string;
  calculation_version: string;
}

export interface InstallerComputePayload {
  requested_power_wc: number;
  installation_type: InstallationType;
  electrical_type: ElectricalType;
  options?: InstallerCostOptionInput[];
  manual_override_ht_cents?: number;
  manual_override_reason?: string;
  study_id?: string;
  study_version_id?: string;
  save_to_quote_prep?: boolean;
}
