/**
 * Paramètres PV — Batterie virtuelle (tarifs 2026).
 * Structure pv.virtual_battery dans org settings. UI : sections par fournisseur,
 * accordéons par segment, tableaux kVA avec colonnes HP/HC pour segments HP/HC.
 * Aucun import depuis components/ui (pas de Card).
 */

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "../../components/Button";
import { adminGetOrgSettings, adminPostOrgSettings } from "../../services/admin.api";
import type { OrgPvSettings } from "../../services/admin.api";
import {
  type PvVirtualBatterySettings,
  type VirtualBatteryRow,
  type SegmentKey,
  type ProviderConfig,
  SEGMENT_KEYS,
  KVA_KEYS,
  SEGMENT_LABELS,
  isMySmartBatteryConfig,
  type CapacityTier,
  type MySmartBatteryConfig,
} from "../../types/pvVirtualBatterySettings";
import { getVirtualBatteryTariffs2026 } from "../../data/virtualBatteryTariffs2026";
import "../../pages/pv-settings-page.css";

function showToast(message: string, type: "success" | "error" = "success") {
  const toast = document.createElement("div");
  toast.setAttribute("role", "alert");
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    background: ${type === "success" ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"};
    color: #fff;
  `;
  toast.textContent = message;
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3000);
}

const alertErrorStyle: React.CSSProperties = {
  padding: "var(--spacing-12) var(--spacing-16)",
  borderRadius: "var(--radius-btn)",
  background: "rgba(239, 68, 68, 0.12)",
  color: "var(--danger, #ef4444)",
  fontSize: "var(--font-size-body-sm)",
  marginBottom: "var(--spacing-16)",
  border: "1px solid rgba(239, 68, 68, 0.3)",
};

const DEFAULT_2026 = getVirtualBatteryTariffs2026();
const PROVIDER_ORDER = ["MYLIGHT_MYBATTERY", "MYLIGHT_MYSMARTBATTERY", "URBAN_SOLAR"] as const;

function isHphcSegment(segmentKey: SegmentKey): boolean {
  return segmentKey === "PARTICULIER_HPHC" || segmentKey === "PRO_HPHC_MU";
}

export default function VirtualBatterySettings() {
  const [settings, setSettings] = useState<OrgPvSettings | null>(null);
  const [data, setData] = useState<PvVirtualBatterySettings>(() => ({ providers: {} }));
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setSaveError(null);
    try {
      const s = await adminGetOrgSettings();
      setSettings(s);
      const vb = s?.pv?.virtual_battery;
      if (vb?.providers && Object.keys(vb.providers).length > 0) {
        setData(vb);
      } else {
        setData(JSON.parse(JSON.stringify(DEFAULT_2026)));
      }
    } catch {
      setData(JSON.parse(JSON.stringify(DEFAULT_2026)));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleSave = async () => {
    setSaveError(null);
    setSaving(true);
    try {
      await adminPostOrgSettings({ pv: { virtual_battery: data } });
      showToast("Grille enregistrée");
      const s = await adminGetOrgSettings();
      setSettings(s);
    } catch (e) {
      const msg = (e as Error).message;
      setSaveError(msg);
      showToast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const handleFill2026 = () => {
    if (!confirmReset) {
      setConfirmReset(true);
      showToast("Cliquez à nouveau sur « Remplir valeurs 2026 » pour confirmer", "error");
      return;
    }
    setData(JSON.parse(JSON.stringify(DEFAULT_2026)));
    setConfirmReset(false);
    showToast("Valeurs 2026 chargées (réinitialisation)");
  };

  const updateRow = (providerCode: string, segmentKey: SegmentKey, kva: string, field: keyof VirtualBatteryRow, value: number | boolean) => {
    setData((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const prov = next.providers[providerCode];
      if (!prov?.segments?.[segmentKey]?.rowsByKva?.[kva]) return prev;
      (next.providers[providerCode].segments[segmentKey].rowsByKva[kva] as Record<string, unknown>)[field] = value;
      return next;
    });
  };

  const updateCapacityTier = (providerCode: string, index: number, field: "kwh" | "abonnement_month_ht", value: number) => {
    if (!isMySmartBatteryConfig(data.providers[providerCode])) return;
    setData((prev) => {
      const next = JSON.parse(JSON.stringify(prev));
      const prov = next.providers[providerCode];
      if (!prov?.capacityTiers?.[index]) return prev;
      prov.capacityTiers[index][field] = value;
      return next;
    });
  };

  if (loading) {
    return <div className="pv-cat-empty">Chargement…</div>;
  }

  const providers = data.providers || {};
  const orderedProviders = PROVIDER_ORDER.filter((code) => providers[code]);

  return (
    <div className="pv-virtual-root">
      <div className="pv-virtual-head">
        <div className="sn-saas-tab-inner-header" style={{ marginBottom: 0 }}>
          <h2 className="sn-saas-tab-inner-header__title">Batterie virtuelle — Tarifs 2026</h2>
          <p className="sn-saas-tab-inner-header__lead">Grilles par fournisseur et segment (accordéons). Une action primaire : enregistrer.</p>
        </div>
        <div style={{ display: "flex", gap: 8, alignItems: "center", flexShrink: 0 }}>
          <Button
            variant={confirmReset ? "danger" : "secondary"}
            size="sm"
            onClick={handleFill2026}
          >
            {confirmReset ? "Confirmer : réinitialiser sur 2026" : "Remplir valeurs 2026"}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer"}
          </Button>
        </div>
      </div>

      {saveError && (
        <div style={alertErrorStyle} role="alert">
          {saveError}
        </div>
      )}

      {orderedProviders.length === 0 ? (
        <section className="sn-saas-form-section">
          <p className="pv-cat-empty" style={{ padding: "20px 12px" }}>
            Aucune grille. Utilisez « Remplir valeurs 2026 » pour charger les tarifs par défaut.
          </p>
        </section>
      ) : (
        orderedProviders.map((providerCode) => {
          const provider = providers[providerCode] as ProviderConfig;
          if (!provider) return null;
          const isMySmart = isMySmartBatteryConfig(provider);

          return (
            <div key={providerCode} className="pv-virtual-provider-card">
              <h3>{provider.label}</h3>

              {isMySmart && (
                <CapacityTiersBlock
                  tiers={(provider as MySmartBatteryConfig).capacityTiers}
                  contributionRule={(provider as MySmartBatteryConfig).contributionRule}
                  onUpdate={(index, field, value) => updateCapacityTier(providerCode, index, field, value)}
                />
              )}

              {SEGMENT_KEYS.map((segmentKey) => (
                <SegmentAccordion
                  key={segmentKey}
                  segmentKey={segmentKey}
                  rowsByKva={provider.segments[segmentKey]?.rowsByKva ?? {}}
                  providerCode={providerCode}
                  onUpdateRow={updateRow}
                />
              ))}
            </div>
          );
        })
      )}
    </div>
  );
}

function CapacityTiersBlock({
  tiers,
  contributionRule,
  onUpdate,
}: {
  tiers: CapacityTier[];
  contributionRule: { type: string; a: number; b: number };
  onUpdate: (index: number, field: "kwh" | "abonnement_month_ht", value: number) => void;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div className="pv-vb-accordion" style={{ marginBottom: 16 }}>
      <button type="button" className="pv-vb-accordion__btn" onClick={() => setOpen(!open)}>
        <span>Capacité batterie (kWh) → Abonnement mensuel HT</span>
        <span aria-hidden>{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        <div className="pv-vb-accordion__body">
          <table className="pv-vb-table">
            <thead>
              <tr>
                <th>kWh</th>
                <th style={{ textAlign: "right" }}>Abonnement €/mois HT</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, i) => (
                <tr key={i}>
                  <td>
                    <input
                      type="number"
                      min={0}
                      value={tier.kwh}
                      onChange={(e) => onUpdate(i, "kwh", Number(e.target.value) || 0)}
                      className="pv-vb-input pv-vb-input--w100"
                    />
                  </td>
                  <td style={{ textAlign: "right" }}>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={tier.abonnement_month_ht}
                      onChange={(e) => onUpdate(i, "abonnement_month_ht", Number(e.target.value) || 0)}
                      className="pv-vb-input pv-vb-input--w120"
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p className="pv-eco-hint" style={{ margin: "10px 0 0" }}>
            Contribution autoproducteur 2026 : {contributionRule.a} × kVA €/an HT
          </p>
        </div>
      ) : null}
    </div>
  );
}

function SegmentAccordion({
  segmentKey,
  rowsByKva,
  providerCode,
  onUpdateRow,
}: {
  segmentKey: SegmentKey;
  rowsByKva: Record<string, VirtualBatteryRow>;
  providerCode: string;
  onUpdateRow: (providerCode: string, segmentKey: SegmentKey, kva: string, field: keyof VirtualBatteryRow, value: number | boolean) => void;
}) {
  const [open, setOpen] = useState(segmentKey === "PARTICULIER_BASE");
  const isHphc = isHphcSegment(segmentKey);

  return (
    <div className="pv-vb-accordion">
      <button type="button" className="pv-vb-accordion__btn" onClick={() => setOpen(!open)}>
        <span>{SEGMENT_LABELS[segmentKey]}</span>
        <span aria-hidden>{open ? "▼" : "▶"}</span>
      </button>
      {open ? (
        <div className="pv-vb-accordion__body">
          <table className="pv-vb-table">
            <thead>
              <tr>
                <th>kVA</th>
                <th style={{ textAlign: "right" }}>Abo €/kWc/mois</th>
                <th style={{ textAlign: "right" }}>Abo fixe €/mois</th>
                {isHphc ? (
                  <>
                    <th style={{ textAlign: "right" }}>Restit. HP</th>
                    <th style={{ textAlign: "right" }}>Restit. HC</th>
                    <th style={{ textAlign: "right" }}>Réseau HP</th>
                    <th style={{ textAlign: "right" }}>Réseau HC</th>
                  </>
                ) : (
                  <>
                    <th style={{ textAlign: "right" }}>Restit. €/kWh</th>
                    <th style={{ textAlign: "right" }}>Réseau €/kWh</th>
                  </>
                )}
                <th style={{ textAlign: "right" }}>Contrib. €/an</th>
                <th style={{ textAlign: "center" }}>Actif</th>
              </tr>
            </thead>
            <tbody>
              {KVA_KEYS.map((kva) => {
                const row = rowsByKva[kva] || {
                  abonnement_per_kwc_month: 0,
                  abonnement_fixed_month: 0,
                  contribution_eur_per_year: 0,
                  enabled: true,
                };
                return (
                  <tr key={kva}>
                    <td>{kva}</td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.abonnement_per_kwc_month || ""}
                        onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "abonnement_per_kwc_month", Number(e.target.value) || 0)}
                        className="pv-vb-input pv-vb-input--w90"
                      />
                    </td>
                    <td style={{ textAlign: "right" }}>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.abonnement_fixed_month || ""}
                        onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "abonnement_fixed_month", Number(e.target.value) || 0)}
                        className="pv-vb-input pv-vb-input--w90"
                      />
                    </td>
                    {isHphc ? (
                      <>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.restitution_hp_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "restitution_hp_eur_per_kwh", Number(e.target.value) || 0)}
                            className="pv-vb-input pv-vb-input--w90"
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.restitution_hc_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "restitution_hc_eur_per_kwh", Number(e.target.value) || 0)}
                            className="pv-vb-input pv-vb-input--w90"
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.reseau_hp_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "reseau_hp_eur_per_kwh", Number(e.target.value) || 0)}
                            className="pv-vb-input pv-vb-input--w90"
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.reseau_hc_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "reseau_hc_eur_per_kwh", Number(e.target.value) || 0)}
                            className="pv-vb-input pv-vb-input--w90"
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.restitution_energy_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "restitution_energy_eur_per_kwh", Number(e.target.value) || 0)}
                            className="pv-vb-input pv-vb-input--w90"
                          />
                        </td>
                        <td style={{ textAlign: "right" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.reseau_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "reseau_eur_per_kwh", Number(e.target.value) || 0)}
                            className="pv-vb-input pv-vb-input--w90"
                          />
                        </td>
                      </>
                    )}
                    <td style={{ textAlign: "right" }}>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.contribution_eur_per_year ?? ""}
                        onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "contribution_eur_per_year", Number(e.target.value) || 0)}
                        className="pv-vb-input pv-vb-input--w90"
                      />
                    </td>
                    <td style={{ textAlign: "center" }}>
                      <input
                        type="checkbox"
                        checked={row.enabled !== false}
                        onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "enabled", e.target.checked)}
                      />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      ) : null}
    </div>
  );
}
