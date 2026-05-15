/**
 * Configurateur batterie virtuelle — grilles Paramètres PV.
 * Le commercial choisit : fournisseur, type de contrat, capacité (si MySmartBattery).
 * Le reste est calculé automatiquement depuis les grilles.
 */

import { useMemo } from "react";
import type { PvVirtualBatterySettings, VirtualBatteryConfig } from "../../types/pvVirtualBatterySettings";
import { resolveVirtualBatteryPricing } from "../../services/virtualBatteryPricing";
import { getVirtualBatteryTariffs2026 } from "../../data/virtualBatteryTariffs2026";

const PROVIDER_OPTIONS: { value: VirtualBatteryConfig["provider"]; label: string }[] = [
  { value: "MYLIGHT_MYBATTERY", label: "MyLight MyBattery" },
  { value: "MYLIGHT_MYSMARTBATTERY", label: "MyLight MySmartBattery" },
  { value: "URBAN_SOLAR", label: "Urban Solar" },
];

const CONTRACT_OPTIONS: { value: VirtualBatteryConfig["contractType"]; label: string }[] = [
  { value: "BASE", label: "Base" },
  { value: "HPHC", label: "HP/HC" },
];

const SMART_BATTERY_CAPACITIES = [100, 300, 600, 900, 1200, 1800, 3000];

export interface VirtualBatteryConfiguratorProps {
  /** Grilles depuis organization.settings_json.pv.virtual_battery (ou défaut 2026) */
  orgSettings?: PvVirtualBatterySettings | null;
  /** Puissance compteur (kVA) — depuis lead / étude */
  meterPowerKva: number;
  /** Puissance PV (kWc) — depuis calpinage */
  pvPowerKwc: number;
  /** Config actuelle (stockée dans config_json.virtualBattery) */
  value: VirtualBatteryConfig | null;
  onChange: (config: VirtualBatteryConfig | null) => void;
  locked?: boolean;
}

export default function VirtualBatteryConfigurator({
  orgSettings,
  meterPowerKva,
  pvPowerKwc,
  value,
  onChange,
  locked = false,
}: VirtualBatteryConfiguratorProps) {
  const grids = orgSettings ?? getVirtualBatteryTariffs2026();
  const providerLabels = useMemo(() => {
    const out: Record<string, string> = {};
    for (const [code, config] of Object.entries(grids.providers ?? {})) {
      out[code] = (config as { label?: string }).label ?? code;
    }
    return out;
  }, [grids]);

  const pricing = useMemo(() => {
    if (!value?.provider) return null;
    return resolveVirtualBatteryPricing(orgSettings ?? null, {
      provider: value.provider,
      contractType: value.contractType ?? "BASE",
      meterPowerKva,
      pvPowerKwc,
      capacityKwh: value.capacityKwh,
    });
  }, [orgSettings, value?.provider, value?.contractType, value?.capacityKwh, meterPowerKva, pvPowerKwc]);

  const isSmartBattery = value?.provider === "MYLIGHT_MYSMARTBATTERY";

  const handleProviderChange = (provider: VirtualBatteryConfig["provider"]) => {
    if (locked) return;
    onChange({
      provider,
      contractType: value?.contractType ?? "BASE",
      capacityKwh: provider === "MYLIGHT_MYSMARTBATTERY" ? (value?.capacityKwh ?? 300) : undefined,
    });
  };

  const handleContractChange = (contractType: VirtualBatteryConfig["contractType"]) => {
    if (locked) return;
    if (!value) return;
    onChange({ ...value, contractType });
  };

  const handleCapacityChange = (capacityKwh: number) => {
    if (locked) return;
    if (!value) return;
    onChange({ ...value, capacityKwh });
  };

  return (
    <div className="sqb-vb sqb-vb--compact">
      <h3 className="sqb-h3 sqb-scenario-subtitle">Batterie virtuelle</h3>

      <div className="sqb-vb-grid">
        <label className="sqb-label sqb-label--compact">
          Fournisseur
          <select
            className="sn-input"
            value={value?.provider ?? ""}
            onChange={(e) => {
              const v = e.target.value as VirtualBatteryConfig["provider"];
              if (v) handleProviderChange(v);
              else onChange(null);
            }}
            disabled={locked}
          >
            <option value="">— Choisir —</option>
            {PROVIDER_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {providerLabels[o.value] ?? o.label}
              </option>
            ))}
          </select>
        </label>

        <label className="sqb-label sqb-label--compact">
          Type de contrat
          <select
            className="sn-input"
            value={value?.contractType ?? "BASE"}
            onChange={(e) => handleContractChange(e.target.value as VirtualBatteryConfig["contractType"])}
            disabled={locked || !value?.provider}
          >
            {CONTRACT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        </label>

        {isSmartBattery && (
          <label className="sqb-label">
            Capacité (kWh)
            <select
              className="sn-input"
              value={value?.capacityKwh ?? 300}
              onChange={(e) => handleCapacityChange(Number(e.target.value))}
              disabled={locked}
            >
              {SMART_BATTERY_CAPACITIES.map((kwh) => (
                <option key={kwh} value={kwh}>
                  {kwh} kWh
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      {value?.provider && pricing && (
        <div className="sqb-vb-estimate sqb-vb-estimate--compact">
          <div className="sqb-vb-estimate-head">Abonnement mensuel (estim.)</div>
          <div className="sqb-vb-rows sqb-vb-rows--compact">
            <div className="sqb-vb-row">
              <span className="sqb-text sqb-muted sqb-text--small">Stockage</span>
              <span className="sqb-text sqb-text--small">{pricing.aboStockageMonthly.toFixed(2)} €</span>
            </div>
            <div className="sqb-vb-row">
              <span className="sqb-text sqb-muted sqb-text--small">Fournisseur</span>
              <span className="sqb-text sqb-text--small">{pricing.aboFournisseurMonthly.toFixed(2)} €</span>
            </div>
            <div className="sqb-vb-row">
              <span className="sqb-text sqb-muted sqb-text--small">Autoproducteur</span>
              <span className="sqb-text sqb-text--small">{pricing.contributionMonthly.toFixed(2)} €</span>
            </div>
            <div className="sqb-vb-total sqb-vb-total--compact">
              <span className="sqb-text sqb-text--small">Total</span>
              <span className="sqb-text sqb-text--small sqb-vb-total-val">{pricing.totalMonthly.toFixed(2)} €/mois</span>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
