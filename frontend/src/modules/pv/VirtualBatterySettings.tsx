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

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "var(--spacing-6) var(--spacing-8)",
  borderRadius: "var(--radius-btn)",
  border: "1px solid var(--sn-border-soft)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  fontSize: "var(--font-size-body-sm)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--font-size-body-sm)",
  color: "var(--text-secondary)",
  marginBottom: "var(--spacing-4)",
  fontWeight: 500,
};

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
    return (
      <div className="panel" style={{ padding: "var(--spacing-24)", color: "var(--text-muted)" }}>
        Chargement…
      </div>
    );
  }

  const providers = data.providers || {};
  const orderedProviders = PROVIDER_ORDER.filter((code) => providers[code]);

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-24)" }}>
      <div style={{ display: "flex", flexWrap: "wrap", justifyContent: "space-between", alignItems: "center", gap: "var(--spacing-12)" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Batterie virtuelle — Tarifs 2026</h2>
        <div style={{ display: "flex", gap: "var(--spacing-8)", alignItems: "center" }}>
          <Button
            variant="ghost"
            size="sm"
            onClick={handleFill2026}
            style={confirmReset ? { outline: "2px solid var(--danger)" } : undefined}
          >
            {confirmReset ? "Confirmer : Remplir valeurs 2026" : "Remplir valeurs 2026 (reset)"}
          </Button>
          <Button variant="primary" size="sm" onClick={handleSave} disabled={saving}>
            {saving ? "Enregistrement…" : "Enregistrer la grille"}
          </Button>
        </div>
      </div>

      {saveError && (
        <div style={alertErrorStyle} role="alert">
          {saveError}
        </div>
      )}

      {orderedProviders.length === 0 ? (
        <div className="panel sg-card" style={{ padding: "var(--spacing-24)" }}>
          <p style={{ margin: 0, color: "var(--text-muted)" }}>
            Aucune grille. Cliquez sur « Remplir valeurs 2026 » pour charger les tarifs par défaut.
          </p>
        </div>
      ) : (
        orderedProviders.map((providerCode) => {
          const provider = providers[providerCode] as ProviderConfig;
          if (!provider) return null;
          const isMySmart = isMySmartBatteryConfig(provider);

          return (
            <div key={providerCode} className="panel sg-card" style={{ padding: "var(--spacing-24)" }}>
              <h3 style={{ margin: "0 0 var(--spacing-16)", fontSize: 16 }}>{provider.label}</h3>

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
    <div style={{ marginBottom: "var(--spacing-16)", border: "1px solid var(--sn-border-soft)", borderRadius: "var(--radius-btn)", overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "var(--spacing-12) var(--spacing-16)",
          background: "var(--bg-muted)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontSize: "var(--font-size-body)",
          fontWeight: 500,
          color: "var(--text-primary)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>Capacité batterie (kWh) → Abonnement mensuel HT</span>
        <span style={{ fontSize: 18 }}>{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div style={{ padding: "var(--spacing-12)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>kWh</th>
                <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Abonnement €/mois HT</th>
              </tr>
            </thead>
            <tbody>
              {tiers.map((tier, i) => (
                <tr key={i} style={{ borderBottom: "1px solid var(--sn-border-soft)" }}>
                  <td style={{ padding: "var(--spacing-4)" }}>
                    <input
                      type="number"
                      min={0}
                      value={tier.kwh}
                      onChange={(e) => onUpdate(i, "kwh", Number(e.target.value) || 0)}
                      style={{ ...inputStyle, padding: "var(--spacing-4)", width: 100, textAlign: "right" }}
                    />
                  </td>
                  <td style={{ padding: "var(--spacing-4)" }}>
                    <input
                      type="number"
                      min={0}
                      step={0.01}
                      value={tier.abonnement_month_ht}
                      onChange={(e) => onUpdate(i, "abonnement_month_ht", Number(e.target.value) || 0)}
                      style={{ ...inputStyle, padding: "var(--spacing-4)", width: 120, textAlign: "right" }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ margin: "var(--spacing-8) 0 0", fontSize: 12, color: "var(--text-muted)" }}>
            Contribution autoproducteur 2026 : {contributionRule.a} × kVA €/an HT
          </p>
        </div>
      )}
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
    <div style={{ marginBottom: "var(--spacing-12)", border: "1px solid var(--sn-border-soft)", borderRadius: "var(--radius-btn)", overflow: "hidden" }}>
      <button
        type="button"
        onClick={() => setOpen(!open)}
        style={{
          width: "100%",
          padding: "var(--spacing-12) var(--spacing-16)",
          background: "var(--bg-muted)",
          border: "none",
          cursor: "pointer",
          textAlign: "left",
          fontSize: "var(--font-size-body)",
          fontWeight: 500,
          color: "var(--text-primary)",
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
        }}
      >
        <span>{SEGMENT_LABELS[segmentKey]}</span>
        <span style={{ fontSize: 18 }}>{open ? "▼" : "▶"}</span>
      </button>
      {open && (
        <div style={{ padding: "var(--spacing-12)", overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>kVA</th>
                <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Abo €/kWc/mois</th>
                <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Abo fixe €/mois</th>
                {isHphc ? (
                  <>
                    <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Restitution HP €/kWh</th>
                    <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Restitution HC €/kWh</th>
                    <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Réseau HP €/kWh</th>
                    <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Réseau HC €/kWh</th>
                  </>
                ) : (
                  <>
                    <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Restitution €/kWh</th>
                    <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Réseau €/kWh</th>
                  </>
                )}
                <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Contribution €/an</th>
                <th style={{ textAlign: "center", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Activation</th>
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
                  <tr key={kva} style={{ borderBottom: "1px solid var(--sn-border-soft)" }}>
                    <td style={{ padding: "var(--spacing-8)" }}>{kva}</td>
                    <td style={{ padding: "var(--spacing-4)" }}>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.abonnement_per_kwc_month || ""}
                        onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "abonnement_per_kwc_month", Number(e.target.value) || 0)}
                        style={{ ...inputStyle, padding: "var(--spacing-4)", width: 90, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: "var(--spacing-4)" }}>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.abonnement_fixed_month || ""}
                        onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "abonnement_fixed_month", Number(e.target.value) || 0)}
                        style={{ ...inputStyle, padding: "var(--spacing-4)", width: 90, textAlign: "right" }}
                      />
                    </td>
                    {isHphc ? (
                      <>
                        <td style={{ padding: "var(--spacing-4)" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.restitution_hp_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "restitution_hp_eur_per_kwh", Number(e.target.value) || 0)}
                            style={{ ...inputStyle, padding: "var(--spacing-4)", width: 90, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ padding: "var(--spacing-4)" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.restitution_hc_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "restitution_hc_eur_per_kwh", Number(e.target.value) || 0)}
                            style={{ ...inputStyle, padding: "var(--spacing-4)", width: 90, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ padding: "var(--spacing-4)" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.reseau_hp_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "reseau_hp_eur_per_kwh", Number(e.target.value) || 0)}
                            style={{ ...inputStyle, padding: "var(--spacing-4)", width: 90, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ padding: "var(--spacing-4)" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.reseau_hc_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "reseau_hc_eur_per_kwh", Number(e.target.value) || 0)}
                            style={{ ...inputStyle, padding: "var(--spacing-4)", width: 90, textAlign: "right" }}
                          />
                        </td>
                      </>
                    ) : (
                      <>
                        <td style={{ padding: "var(--spacing-4)" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.restitution_energy_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "restitution_energy_eur_per_kwh", Number(e.target.value) || 0)}
                            style={{ ...inputStyle, padding: "var(--spacing-4)", width: 90, textAlign: "right" }}
                          />
                        </td>
                        <td style={{ padding: "var(--spacing-4)" }}>
                          <input
                            type="number"
                            min={0}
                            step={0.0001}
                            value={row.reseau_eur_per_kwh ?? ""}
                            onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "reseau_eur_per_kwh", Number(e.target.value) || 0)}
                            style={{ ...inputStyle, padding: "var(--spacing-4)", width: 90, textAlign: "right" }}
                          />
                        </td>
                      </>
                    )}
                    <td style={{ padding: "var(--spacing-4)" }}>
                      <input
                        type="number"
                        min={0}
                        step={0.01}
                        value={row.contribution_eur_per_year ?? ""}
                        onChange={(e) => onUpdateRow(providerCode, segmentKey, kva, "contribution_eur_per_year", Number(e.target.value) || 0)}
                        style={{ ...inputStyle, padding: "var(--spacing-4)", width: 90, textAlign: "right" }}
                      />
                    </td>
                    <td style={{ padding: "var(--spacing-4)", textAlign: "center" }}>
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
      )}
    </div>
  );
}
