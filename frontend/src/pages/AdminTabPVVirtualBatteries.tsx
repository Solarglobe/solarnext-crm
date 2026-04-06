/**
 * Paramètres PV — Onglet Batteries virtuelles
 * Liste + modal création/édition. Configuration uniquement (pas de calcul).
 */

import React, { useEffect, useState, useCallback } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ModalShell } from "../components/ui/ModalShell";
import {
  listVirtualBatteries,
  createVirtualBattery,
  updateVirtualBattery,
  type PvVirtualBattery,
  type PricingModel,
  type CapacityTableRow,
} from "../api/virtualBatteriesApi";
import {
  DEFAULT_VB_MYLIGHT_MYBATT_RESEAU_HT,
  DEFAULT_VB_MYLIGHT_MYBATT_RESTITUTION_HT,
} from "../data/virtualBatteryTariffs2026";

const inputStyle: React.CSSProperties = {
  width: "100%",
  padding: "var(--spacing-8) var(--spacing-12)",
  borderRadius: "var(--radius-btn)",
  border: "1px solid var(--sn-border-soft)",
  background: "var(--bg-surface)",
  color: "var(--text-primary)",
  fontSize: "var(--font-size-body)",
};

const labelStyle: React.CSSProperties = {
  display: "block",
  fontSize: "var(--font-size-body-sm)",
  color: "var(--text-secondary)",
  marginBottom: "var(--spacing-4)",
  fontWeight: 500,
};

const PRICING_LABELS: Record<PricingModel, string> = {
  per_kwc: "Par kWc",
  per_capacity: "Par capacité",
  per_kwc_with_variable: "Par kWc + variable",
  custom: "Custom",
};

function Field({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <label style={labelStyle}>{label}</label>
      {children}
    </div>
  );
}

function showToast(message: string, type: "success" | "error" = "success") {
  const toast = document.createElement("div");
  toast.className = `planning-toast planning-toast-${type}`;
  toast.textContent = message;
  toast.setAttribute("role", "alert");
  toast.style.cssText = `
    position: fixed; bottom: 24px; right: 24px; z-index: 9999;
    padding: 12px 20px; border-radius: 8px; font-size: 14px; font-weight: 500;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
    background: ${type === "success" ? "var(--success, #22c55e)" : "var(--danger, #ef4444)"};
    color: #fff;
  `;
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

export default function AdminTabPVVirtualBatteries() {
  const [list, setList] = useState<PvVirtualBattery[]>([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editing, setEditing] = useState<PvVirtualBattery | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await listVirtualBatteries();
      setList(data);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const handleAdd = () => {
    setEditing(null);
    setSaveError(null);
    setModalOpen(true);
  };

  const handleEdit = (row: PvVirtualBattery) => {
    setEditing(row);
    setSaveError(null);
    setModalOpen(true);
  };

  const handleToggleActive = async (row: PvVirtualBattery) => {
    try {
      await updateVirtualBattery(row.id, { is_active: !row.is_active });
      showToast(row.is_active ? "Batterie virtuelle désactivée" : "Batterie virtuelle activée");
      load();
    } catch (e) {
      showToast((e as Error).message, "error");
    }
  };

  const handleCloseModal = () => {
    setModalOpen(false);
    setEditing(null);
    setSaveError(null);
    load();
  };

  if (loading) {
    return (
      <div style={{ padding: "var(--spacing-24)", color: "var(--text-muted)" }}>
        Chargement…
      </div>
    );
  }

  return (
    <>
      <Card variant="premium" padding="lg">
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--spacing-16)" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Batteries virtuelles</h2>
          <Button variant="primary" size="sm" onClick={handleAdd}>
            + Nouvelle batterie virtuelle
          </Button>
        </div>
        <div style={{ overflowX: "auto" }}>
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
            <thead>
              <tr>
                <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Nom</th>
                <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Modèle</th>
                <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Abonnement</th>
                <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Coût kWh</th>
                <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Tarifs</th>
                <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Actif</th>
                <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.length === 0 ? (
                <tr>
                  <td colSpan={7} style={{ padding: "var(--spacing-24)", color: "var(--text-muted)", textAlign: "center" }}>
                    Aucune batterie virtuelle.
                  </td>
                </tr>
              ) : (
                list.map((row) => {
                  const segments = (row.tariff_grid_json as { segments?: unknown[] } | null)?.segments;
                  const segmentCount = Array.isArray(segments) ? segments.length : 0;
                  const tarifsLabel =
                    row.provider_code === "MYLIGHT_MYSMARTBATTERY" && segmentCount > 0
                      ? "Tarifs chargés (capacité + règles)"
                      : row.provider_code === "MYLIGHT_MYBATTERY" && segmentCount > 0
                        ? "Tarifs chargés (segments: Base + HPHC)"
                        : segmentCount > 0
                          ? `Tarifs chargés (segments: ${segmentCount})`
                          : "—";
                  return (
                  <tr key={row.id} style={{ borderBottom: "1px solid var(--sn-border-soft)" }}>
                    <td style={{ padding: "var(--spacing-8)" }}>{row.name}</td>
                    <td style={{ padding: "var(--spacing-8)" }}>{row.provider_code}</td>
                    <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>
                      {row.monthly_subscription_ht != null ? `${Number(row.monthly_subscription_ht)} €` : "—"}
                    </td>
                    <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>
                      {row.cost_per_kwh_ht != null ? `${Number(row.cost_per_kwh_ht)} €` : "—"}
                    </td>
                    <td style={{ padding: "var(--spacing-8)", fontSize: 12, color: "var(--text-secondary)" }}>{tarifsLabel}</td>
                    <td style={{ padding: "var(--spacing-8)" }}>
                      <span
                        style={{
                          padding: "2px 8px",
                          borderRadius: "var(--radius-pill)",
                          fontSize: 12,
                          background: row.is_active ? "rgba(22,163,74,0.2)" : "rgba(107,114,128,0.2)",
                          color: row.is_active ? "var(--success)" : "var(--text-muted)",
                        }}
                      >
                        {row.is_active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>
                      <Button variant="ghost" size="sm" onClick={() => handleToggleActive(row)}>
                        {row.is_active ? "Désactiver" : "Activer"}
                      </Button>
                      <Button variant="ghost" size="sm" onClick={() => handleEdit(row)}>
                        Éditer
                      </Button>
                    </td>
                  </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>
      </Card>

      {modalOpen && (
        <VirtualBatteryModal
          initial={editing}
          onSave={async (payload) => {
            setSaveError(null);
            try {
              if (editing) {
                await updateVirtualBattery(editing.id, payload);
                showToast("Batterie virtuelle mise à jour");
              } else {
                await createVirtualBattery(payload);
                showToast("Batterie virtuelle créée");
              }
              handleCloseModal();
            } catch (e) {
              setSaveError((e as Error).message);
            }
          }}
          onClose={handleCloseModal}
          saveError={saveError}
          setSaveError={setSaveError}
        />
      )}
    </>
  );
}

interface FormState {
  name: string;
  provider_code: string;
  pricing_model: PricingModel;
  monthly_subscription_ht: string;
  cost_per_kwh_ht: string;
  activation_fee_ht: string;
  contribution_autoproducteur_ht: string;
  includes_network_fees: boolean;
  indexed_on_trv: boolean;
  capacity_table: CapacityTableRow[];
  tariff_source_label: string;
  tariff_effective_date: string;
  tariff_grid_json: string;
  is_active: boolean;
}

const defaultForm: FormState = {
  name: "",
  provider_code: "",
  pricing_model: "per_kwc",
  monthly_subscription_ht: "",
  cost_per_kwh_ht: "",
  activation_fee_ht: "",
  contribution_autoproducteur_ht: "",
  includes_network_fees: false,
  indexed_on_trv: false,
  capacity_table: [],
  tariff_source_label: "",
  tariff_effective_date: "",
  tariff_grid_json: "",
  is_active: true,
};

/** Template JSON grille tarifaire (schemaVersion 1) selon provider_code */
function getTariffGridTemplate(providerCode: string): Record<string, unknown> {
  const base = {
    schemaVersion: 1,
    country: "FR",
    currency: "EUR",
  };
  if (providerCode === "URBAN_SOLAR") {
    return {
      ...base,
      provider: "URBAN_SOLAR",
      segments: [
        {
          segmentCode: "PART_BASE",
          label: "Particulier Base",
          eligibility: { isPro: false, maxKva: 36, grd: ["ENEDIS"], requiresOption: "BASE" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: 1.0 },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 9.6 },
            kvaRows: [
              {
                kva: 3,
                subscriptionFixed: { unit: "EUR_PER_MONTH", ht: null, ttc: 9.96 },
                virtualEnergy: { unit: "EUR_PER_KWH", htt: 0.07925, ttc: 0.1297, hp_htt: null, hc_htt: null, hp_ttc: null, hc_ttc: null },
                virtualNetworkFee: { unit: "EUR_PER_KWH", htt: 0.0484, ttc: 0.0951, hp_htt: null, hc_htt: null, hp_ttc: null, hc_ttc: null },
                proComponents: null,
              },
            ],
          },
        },
      ],
    };
  }
  if (providerCode === "MYLIGHT_MYBATTERY") {
    return {
      ...base,
      provider: "MYLIGHT_MYBATTERY",
      segments: [
        {
          segmentCode: "PART_BASE",
          label: "Particulier Base",
          eligibility: { isPro: false, maxKva: 36, grd: ["ENEDIS"], requiresOption: "BASE" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: 1.0 },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 3.96 },
            kvaRows: [
              {
                kva: 3,
                subscriptionFixed: { unit: "EUR_PER_MONTH", ht: null, ttc: 9.96 },
                virtualEnergy: {
                  unit: "EUR_PER_KWH",
                  htt: DEFAULT_VB_MYLIGHT_MYBATT_RESTITUTION_HT,
                  ttc: 0.1297,
                  hp_htt: null,
                  hc_htt: null,
                  hp_ttc: null,
                  hc_ttc: null,
                },
                virtualNetworkFee: {
                  unit: "EUR_PER_KWH",
                  htt: DEFAULT_VB_MYLIGHT_MYBATT_RESEAU_HT,
                  ttc: 0.0951,
                  hp_htt: null,
                  hc_htt: null,
                  hp_ttc: null,
                  hc_ttc: null,
                },
                proComponents: null,
              },
            ],
          },
        },
        {
          segmentCode: "PART_HPHC",
          label: "Particulier HPHC",
          eligibility: { isPro: false, maxKva: 36, grd: ["ENEDIS"], requiresOption: "HPHC" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: 1.0 },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 3.96 },
            kvaRows: [{ kva: 6, subscriptionFixed: { unit: "EUR_PER_MONTH", ht: null, ttc: 12.96 }, virtualEnergy: { unit: "EUR_PER_KWH", htt: null, ttc: null, hp_htt: 0.08, hc_htt: 0.06, hp_ttc: 0.12, hc_ttc: 0.09 }, virtualNetworkFee: { unit: "EUR_PER_KWH", htt: null, ttc: null, hp_htt: 0.03, hc_htt: 0.02, hp_ttc: null, hc_ttc: null }, proComponents: null }],
          },
        },
      ],
    };
  }
  if (providerCode === "MYLIGHT_MYSMARTBATTERY") {
    return {
      ...base,
      provider: "MYLIGHT_MYSMARTBATTERY",
      segments: [
        {
          segmentCode: "PART_CAPACITY",
          label: "Particulier par capacité",
          eligibility: { isPro: false, maxKva: 36, grd: ["ENEDIS"], requiresOption: "BASE" },
          pricing: {
            virtualSubscription: { unit: "EUR_PER_KWC_PER_MONTH_HT", value: null },
            annualAutoproducerContribution: { unit: "EUR_PER_YEAR_HT", value: 3.96 },
            kvaRows: [],
          },
        },
      ],
    };
  }
  return { ...base, provider: providerCode || "CUSTOM", segments: [] };
}

const PV_VIRTUAL_BATTERY_FORM_ID = "pv-virtual-battery-modal-form";

function VirtualBatteryModal({
  initial,
  onSave,
  onClose,
  saveError,
  setSaveError,
}: {
  initial: PvVirtualBattery | null;
  onSave: (payload: Partial<PvVirtualBattery>) => Promise<void>;
  onClose: () => void;
  saveError: string | null;
  setSaveError: (msg: string | null) => void;
}) {
  const [form, setForm] = useState<FormState>(() => {
    if (initial) {
      const ct = Array.isArray(initial.capacity_table) ? initial.capacity_table : [];
      const tg = initial.tariff_grid_json;
      return {
        name: initial.name ?? "",
        provider_code: initial.provider_code ?? "",
        pricing_model: initial.pricing_model ?? "per_kwc",
        monthly_subscription_ht: initial.monthly_subscription_ht != null ? String(initial.monthly_subscription_ht) : "",
        cost_per_kwh_ht: initial.cost_per_kwh_ht != null ? String(initial.cost_per_kwh_ht) : "",
        activation_fee_ht: initial.activation_fee_ht != null ? String(initial.activation_fee_ht) : "",
        contribution_autoproducteur_ht:
          initial.contribution_autoproducteur_ht != null ? String(initial.contribution_autoproducteur_ht) : "",
        includes_network_fees: initial.includes_network_fees ?? false,
        indexed_on_trv: initial.indexed_on_trv ?? false,
        capacity_table: ct.map((r) => ({
          capacity_kwh: Number(r.capacity_kwh) || 0,
          monthly_subscription_ht: Number((r as unknown as Record<string, unknown>).monthly_subscription_ht) || 0,
        })),
        tariff_source_label: initial.tariff_source_label ?? "",
        tariff_effective_date: initial.tariff_effective_date ?? "",
        tariff_grid_json:
          tg != null && typeof tg === "object" ? JSON.stringify(tg, null, 2) : "",
        is_active: initial.is_active !== false,
      };
    }
    return { ...defaultForm };
  });

  useEffect(() => {
    if (initial) {
      const ct = Array.isArray(initial.capacity_table) ? initial.capacity_table : [];
      const tg = initial.tariff_grid_json;
      setForm({
        name: initial.name ?? "",
        provider_code: initial.provider_code ?? "",
        pricing_model: initial.pricing_model ?? "per_kwc",
        monthly_subscription_ht: initial.monthly_subscription_ht != null ? String(initial.monthly_subscription_ht) : "",
        cost_per_kwh_ht: initial.cost_per_kwh_ht != null ? String(initial.cost_per_kwh_ht) : "",
        activation_fee_ht: initial.activation_fee_ht != null ? String(initial.activation_fee_ht) : "",
        contribution_autoproducteur_ht:
          initial.contribution_autoproducteur_ht != null ? String(initial.contribution_autoproducteur_ht) : "",
        includes_network_fees: initial.includes_network_fees ?? false,
        indexed_on_trv: initial.indexed_on_trv ?? false,
        capacity_table: ct.map((r) => ({
          capacity_kwh: Number((r as unknown as Record<string, unknown>).capacity_kwh) || 0,
          monthly_subscription_ht: Number((r as unknown as Record<string, unknown>).monthly_subscription_ht) || 0,
        })),
        tariff_source_label: initial.tariff_source_label ?? "",
        tariff_effective_date: initial.tariff_effective_date ?? "",
        tariff_grid_json: tg != null && typeof tg === "object" ? JSON.stringify(tg, null, 2) : "",
        is_active: initial.is_active !== false,
      });
    } else {
      setForm({ ...defaultForm });
    }
  }, [initial]);

  const addCapacityRow = () => {
    setForm((f) => ({
      ...f,
      capacity_table: [...f.capacity_table, { capacity_kwh: 0, monthly_subscription_ht: 0 }],
    }));
  };

  const updateCapacityRow = (index: number, field: "capacity_kwh" | "monthly_subscription_ht", value: number) => {
    setForm((f) => ({
      ...f,
      capacity_table: f.capacity_table.map((r, i) =>
        i === index ? { ...r, [field]: value } : r
      ),
    }));
  };

  const removeCapacityRow = (index: number) => {
    setForm((f) => ({
      ...f,
      capacity_table: f.capacity_table.filter((_, i) => i !== index),
    }));
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    let tariff_grid_json: Record<string, unknown> | null = null;
    if (form.tariff_grid_json.trim()) {
      try {
        tariff_grid_json = JSON.parse(form.tariff_grid_json) as Record<string, unknown>;
      } catch {
        setSaveError("Grille tarifaire : JSON invalide");
        return;
      }
    }
    const payload: Partial<PvVirtualBattery> = {
      name: form.name.trim(),
      provider_code: form.provider_code.trim(),
      pricing_model: form.pricing_model,
      monthly_subscription_ht: form.monthly_subscription_ht ? Number(form.monthly_subscription_ht) : null,
      cost_per_kwh_ht: form.cost_per_kwh_ht ? Number(form.cost_per_kwh_ht) : null,
      activation_fee_ht: form.activation_fee_ht ? Number(form.activation_fee_ht) : null,
      contribution_autoproducteur_ht: form.contribution_autoproducteur_ht
        ? Number(form.contribution_autoproducteur_ht)
        : null,
      includes_network_fees: form.includes_network_fees,
      indexed_on_trv: form.indexed_on_trv,
      capacity_table:
        form.pricing_model === "per_capacity" && form.capacity_table.length > 0
          ? form.capacity_table
          : null,
      tariff_source_label: form.tariff_source_label.trim() || null,
      tariff_effective_date: form.tariff_effective_date.trim() || null,
      tariff_grid_json,
      is_active: form.is_active,
    };
    onSave(payload);
  };

  const handlePreFillTariff = () => {
    const template = getTariffGridTemplate(form.provider_code);
    setForm((f) => ({
      ...f,
      tariff_grid_json: JSON.stringify(template, null, 2),
      tariff_source_label: f.tariff_source_label || `Tarifs au ${new Date().toLocaleDateString("fr-FR")} — ${form.provider_code}`,
      tariff_effective_date: f.tariff_effective_date || new Date().toISOString().slice(0, 10),
    }));
    showToast("Grille tarifaire pré-remplie");
  };

  const isPerKwc = form.pricing_model === "per_kwc";
  const isPerKwcWithVariable = form.pricing_model === "per_kwc_with_variable";
  const isPerCapacity = form.pricing_model === "per_capacity";

  return (
    <ModalShell
      open
      onClose={onClose}
      size="xl"
      title={initial ? "Modifier la batterie virtuelle" : "Nouvelle batterie virtuelle"}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" form={PV_VIRTUAL_BATTERY_FORM_ID}>
            Enregistrer
          </Button>
        </>
      }
    >
        {saveError && (
          <div style={alertErrorStyle} role="alert">
            {saveError}
          </div>
        )}
        <form id={PV_VIRTUAL_BATTERY_FORM_ID} onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-12)" }}>
            <h4 style={{ margin: "0 0 var(--spacing-8)", fontSize: 14, color: "var(--text-secondary)" }}>
              Informations générales
            </h4>
            <Field label="Nom fournisseur">
              <input
                type="text"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                style={inputStyle}
                required
              />
            </Field>
            <Field label="Code interne fournisseur">
              <input
                type="text"
                value={form.provider_code}
                onChange={(e) => setForm((f) => ({ ...f, provider_code: e.target.value }))}
                style={inputStyle}
                required
              />
            </Field>
            <Field label="Modèle tarifaire">
              <select
                value={form.pricing_model}
                onChange={(e) =>
                  setForm((f) => ({ ...f, pricing_model: e.target.value as PricingModel }))
                }
                style={inputStyle}
              >
                {(Object.keys(PRICING_LABELS) as PricingModel[]).map((k) => (
                  <option key={k} value={k}>
                    {PRICING_LABELS[k]}
                  </option>
                ))}
              </select>
            </Field>

            {isPerKwc && (
              <>
                <Field label="Abonnement mensuel HT (€)">
                  <input
                    type="number"
                    step="0.0001"
                    value={form.monthly_subscription_ht}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, monthly_subscription_ht: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Contribution autoproducteur HT (€)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.contribution_autoproducteur_ht}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, contribution_autoproducteur_ht: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Frais activation HT (€)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.activation_fee_ht}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, activation_fee_ht: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
              </>
            )}

            {isPerKwcWithVariable && (
              <>
                <Field label="Abonnement mensuel HT (€)">
                  <input
                    type="number"
                    step="0.0001"
                    value={form.monthly_subscription_ht}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, monthly_subscription_ht: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Coût variable €/kWh HT">
                  <input
                    type="number"
                    step="0.000001"
                    value={form.cost_per_kwh_ht}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, cost_per_kwh_ht: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
                <Field label="Frais activation HT (€)">
                  <input
                    type="number"
                    step="0.01"
                    value={form.activation_fee_ht}
                    onChange={(e) =>
                      setForm((f) => ({ ...f, activation_fee_ht: e.target.value }))
                    }
                    style={inputStyle}
                  />
                </Field>
              </>
            )}

            {isPerCapacity && (
              <>
                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
                  <span style={labelStyle}>Table capacité / abonnement</span>
                  <Button type="button" variant="ghost" size="sm" onClick={addCapacityRow}>
                    + Ajouter capacité
                  </Button>
                </div>
                {form.capacity_table.length > 0 && (
                  <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
                    <thead>
                      <tr>
                        <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>
                          Capacité kWh
                        </th>
                        <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>
                          Abonnement mensuel HT (€)
                        </th>
                        <th style={{ width: 80 }} />
                      </tr>
                    </thead>
                    <tbody>
                      {form.capacity_table.map((row, i) => (
                        <tr key={i} style={{ borderBottom: "1px solid var(--sn-border-soft)" }}>
                          <td style={{ padding: "var(--spacing-8)" }}>
                            <input
                              type="number"
                              step="0.01"
                              value={row.capacity_kwh || ""}
                              onChange={(e) =>
                                updateCapacityRow(i, "capacity_kwh", Number(e.target.value) || 0)
                              }
                              style={{ ...inputStyle, padding: "var(--spacing-4)" }}
                            />
                          </td>
                          <td style={{ padding: "var(--spacing-8)" }}>
                            <input
                              type="number"
                              step="0.0001"
                              value={row.monthly_subscription_ht || ""}
                              onChange={(e) =>
                                updateCapacityRow(i, "monthly_subscription_ht", Number(e.target.value) || 0)
                              }
                              style={{ ...inputStyle, padding: "var(--spacing-4)" }}
                            />
                          </td>
                          <td style={{ padding: "var(--spacing-8)" }}>
                            <Button
                              type="button"
                              variant="ghost"
                              size="sm"
                              onClick={() => removeCapacityRow(i)}
                            >
                              Suppr.
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </>
            )}

            <h4 style={{ margin: "var(--spacing-16) 0 var(--spacing-8)", fontSize: 14, color: "var(--text-secondary)" }}>
              Tarifs
            </h4>
            <Field label="Source (ex. PDF, date)">
              <input
                type="text"
                value={form.tariff_source_label}
                onChange={(e) => setForm((f) => ({ ...f, tariff_source_label: e.target.value }))}
                style={inputStyle}
                placeholder="Tarifs au 01/02/2026 — PDF UrbanSolar Particulier Base"
              />
            </Field>
            <Field label="Date d'effet">
              <input
                type="date"
                value={form.tariff_effective_date}
                onChange={(e) => setForm((f) => ({ ...f, tariff_effective_date: e.target.value }))}
                style={inputStyle}
              />
            </Field>
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "var(--spacing-8)" }}>
              <span style={labelStyle}>Grille tarifaire (JSON)</span>
              <Button type="button" variant="ghost" size="sm" onClick={handlePreFillTariff}>
                Pré-remplir (UrbanSolar / MyLight)
              </Button>
            </div>
            <textarea
              value={form.tariff_grid_json}
              onChange={(e) => setForm((f) => ({ ...f, tariff_grid_json: e.target.value }))}
              placeholder='{"schemaVersion": 1, "provider": "URBAN_SOLAR", "segments": [...]}'
              rows={12}
              style={{
                ...inputStyle,
                fontFamily: "monospace",
                fontSize: 12,
                minHeight: 200,
              }}
              spellCheck={false}
            />

            <h4 style={{ margin: "var(--spacing-16) 0 var(--spacing-8)", fontSize: 14, color: "var(--text-secondary)" }}>
              Paramètres avancés
            </h4>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-8)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.includes_network_fees}
                onChange={(e) =>
                  setForm((f) => ({ ...f, includes_network_fees: e.target.checked }))
                }
              />
              Inclut frais réseau
            </label>
            <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-8)", cursor: "pointer" }}>
              <input
                type="checkbox"
                checked={form.indexed_on_trv}
                onChange={(e) =>
                  setForm((f) => ({ ...f, indexed_on_trv: e.target.checked }))
                }
              />
              Indexé TRV
            </label>
            <Field label="Actif">
              <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-8)", cursor: "pointer" }}>
                <input
                  type="checkbox"
                  checked={form.is_active}
                  onChange={(e) => setForm((f) => ({ ...f, is_active: e.target.checked }))}
                />
                Oui
              </label>
            </Field>
          </div>
        </form>
    </ModalShell>
  );
}
