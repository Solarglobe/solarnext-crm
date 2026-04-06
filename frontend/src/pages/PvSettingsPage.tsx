/**
 * CP-002 — Paramètres PV — 5 onglets : Économie, Panneaux, Micro/Onduleurs, Batteries, Batteries virtuelles
 * CP-002-FIX : Onglet Économie simplifié (Économie nationale uniquement), filtres marque/recherche/actifs sur catalogues
 * Route: /admin/settings/pv
 * Accès: SUPER_ADMIN, ADMIN (via AdminRoute / org.settings.manage)
 */

import React, { useEffect, useState, useCallback } from "react";
import { Card } from "../components/ui/Card";
import { Button } from "../components/ui/Button";
import { ModalShell } from "../components/ui/ModalShell";
import VirtualBatterySettings from "../modules/pv/VirtualBatterySettings";
import {
  adminGetOrgSettings,
  adminPostOrgSettings,
  type OrgPvSettings,
} from "../services/admin.api";
import {
  listPanels,
  createPanel,
  updatePanel,
  togglePanelActive,
  listInverters,
  createInverter,
  updateInverter,
  toggleInverterActive,
  listBatteries,
  createBattery,
  updateBattery,
  toggleBatteryActive,
  type PvPanel,
  type PvInverter,
  type PvBattery,
} from "../api/pvCatalogApi";

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

const gridStyle: React.CSSProperties = {
  display: "grid",
  gridTemplateColumns: "repeat(auto-fill, minmax(180px, 1fr))",
  gap: "var(--spacing-16)",
};

function Field({
  label,
  sublabel,
  children,
  style,
  variant = "default",
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
  variant?: "default" | "premium";
}) {
  const isPremium = variant === "premium";
  const effectiveLabelStyle: React.CSSProperties = isPremium
    ? {
        display: "block",
        fontSize: "var(--font-size-body)",
        fontWeight: 500,
        color: "var(--text-primary)",
        letterSpacing: "0.025em",
        marginBottom: "var(--spacing-4)",
      }
    : labelStyle;
  return (
    <div style={style}>
      <label style={effectiveLabelStyle}>{label}</label>
      {sublabel && (
        <div
          style={{
            fontSize: "var(--font-size-label)",
            color: "var(--text-muted)",
            marginTop: "var(--spacing-4)",
            marginBottom: "var(--spacing-4)",
          }}
        >
          {sublabel}
        </div>
      )}
      {children}
    </div>
  );
}

const TABS = ["Économie", "Panneaux", "Micro/Onduleurs", "Batteries", "Batteries virtuelles"] as const;

/** Aligné sur financeService.pickEconomics + impactService (horizon) + calc (prix / OA). */
const ECONOMICS_KEYS = [
  "price_eur_kwh",
  "elec_growth_pct",
  "pv_degradation_pct",
  "horizon_years",
  "oa_rate_lt_9",
  "oa_rate_gte_9",
  "prime_lt9",
  "prime_gte9",
  "maintenance_pct",
  "onduleur_year",
  "onduleur_cost_pct",
  /** Dégradation annuelle de l’énergie « utile » batterie physique (cashflows) — moteur finance uniquement */
  "battery_degradation_pct",
] as const;

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

function validateEconomics(e: Record<string, unknown>): boolean {
  for (const k of ECONOMICS_KEYS) {
    const v = e[k];
    if (k === "battery_degradation_pct" && (v === undefined || v === null || v === "")) continue;
    if (typeof v !== "number" || Number.isNaN(v) || v < 0) return false;
  }
  return true;
}

export default function PvSettingsPage() {
  const [activeTab, setActiveTab] = useState<(typeof TABS)[number]>("Économie");
  const [data, setData] = useState<OrgPvSettings | null>(null);
  const [initialEconomics, setInitialEconomics] = useState<Record<string, unknown>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Catalogues DB
  const [panels, setPanels] = useState<PvPanel[]>([]);
  const [invertersCentral, setInvertersCentral] = useState<PvInverter[]>([]);
  const [invertersMicro, setInvertersMicro] = useState<PvInverter[]>([]);
  const [batteries, setBatteries] = useState<PvBattery[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(false);
  const [editingPanel, setEditingPanel] = useState<PvPanel | null>(null);
  const [panelModalOpen, setPanelModalOpen] = useState(false);
  const [editingInverter, setEditingInverter] = useState<PvInverter | null>(null);
  const [inverterDefaultFamily, setInverterDefaultFamily] = useState<"CENTRAL" | "MICRO">("CENTRAL");
  const [inverterModalOpen, setInverterModalOpen] = useState(false);
  const [editingBattery, setEditingBattery] = useState<PvBattery | null>(null);
  const [batteryModalOpen, setBatteryModalOpen] = useState(false);
  const [catalogSaveError, setCatalogSaveError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const r = await adminGetOrgSettings();
      setData(r);
      setInitialEconomics(r.economics ?? {});
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadCatalogs = useCallback(async () => {
    setCatalogLoading(true);
    try {
      const [p, iCentral, iMicro, b] = await Promise.all([
        listPanels(),
        listInverters("CENTRAL"),
        listInverters("MICRO"),
        listBatteries(),
      ]);
      setPanels(p);
      setInvertersCentral(iCentral);
      setInvertersMicro(iMicro);
      setBatteries(b);
    } catch {
      // ignore
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (activeTab !== "Économie") loadCatalogs();
  }, [activeTab, loadCatalogs]);

  const saveEconomics = async () => {
    if (!data?.economics) return;
    const e = data.economics;
    if (!validateEconomics(e)) {
      showToast("Valeurs invalides (NaN ou négatives). Corrigez avant d'enregistrer.", "error");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      await adminPostOrgSettings({ economics: e });
      showToast("Paramètres économie enregistrés");
      await load();
    } catch (err) {
      const msg = (err as Error).message;
      setError(msg);
      showToast(msg, "error");
    } finally {
      setSaving(false);
    }
  };

  const resetEconomics = () => {
    if (!data) return;
    setData({ ...data, economics: { ...initialEconomics } });
  };

  const updateEconomics = (values: Record<string, unknown>) => {
    if (!data) return;
    setData({ ...data, economics: { ...(data.economics ?? {}), ...values } });
  };

  const isEconomicsDirty = (() => {
    const cur = data?.economics ?? {};
    for (const k of ECONOMICS_KEYS) {
      const a = cur[k];
      const b = initialEconomics[k];
      if (Number(a) !== Number(b)) return true;
    }
    return false;
  })();

  const handlePanelSave = async (panel: Partial<PvPanel>) => {
    setCatalogSaveError(null);
    try {
      if (editingPanel) {
        await updatePanel(editingPanel.id, panel);
      } else {
        await createPanel(panel);
      }
      setPanelModalOpen(false);
      setEditingPanel(null);
      loadCatalogs();
    } catch (e) {
      setCatalogSaveError((e as Error).message);
      showToast((e as Error).message, "error");
    }
  };

  const handleInverterSave = async (inv: Partial<PvInverter>) => {
    setCatalogSaveError(null);
    try {
      if (editingInverter) {
        await updateInverter(editingInverter.id, inv);
      } else {
        await createInverter(inv);
      }
      setInverterModalOpen(false);
      setEditingInverter(null);
      loadCatalogs();
    } catch (e) {
      setCatalogSaveError((e as Error).message);
      showToast((e as Error).message, "error");
    }
  };

  const handleBatterySave = async (bat: Partial<PvBattery>) => {
    setCatalogSaveError(null);
    try {
      if (editingBattery) {
        await updateBattery(editingBattery.id, bat);
      } else {
        await createBattery(bat);
      }
      setBatteryModalOpen(false);
      setEditingBattery(null);
      loadCatalogs();
    } catch (e) {
      setCatalogSaveError((e as Error).message);
      showToast((e as Error).message, "error");
    }
  };

  if (loading) {
    return (
      <div style={{ padding: "var(--spacing-24)", color: "var(--text-muted)" }}>
        Chargement…
      </div>
    );
  }

  if (error || !data) {
    return (
      <div style={{ padding: "var(--spacing-24)", color: "var(--danger)" }}>
        {error || "Données non disponibles"}
      </div>
    );
  }

  const e = data.economics ?? {};

  return (
    /* ── Wrapper flex-column : remplit sn-main (height:100%) sans déborder ──
       Le header + onglets occupent leur hauteur naturelle (flex-shrink:0).
       La zone de contenu (flex:1 + overflow:auto) scrolle en interne.
       Résultat : body.scrollHeight = viewport, aucun fond artificiel.           */
    <div className="pv-settings-page" style={{
      display: "flex",
      flexDirection: "column",
      flex: "1 1 auto",
      minHeight: 0,
      padding: "var(--spacing-24)",
      width: "100%",
      margin: 0,
      boxSizing: "border-box",
    }}>

      {/* ─── En-tête + barre d'onglets : ne scrollent jamais ─── */}
      <div style={{ flexShrink: 0, marginBottom: "var(--spacing-16)" }}>
        <header style={{ marginBottom: "var(--spacing-16)" }}>
          <h1 className="sg-title">Paramètres PV</h1>
          <p style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)", marginTop: "var(--spacing-8)" }}>
            Paramètres économiques, catalogues panneaux, micro-onduleurs et batteries
          </p>
        </header>

        <div
          role="tablist"
          aria-label="Sections paramètres PV"
          style={{ display: "flex", borderBottom: "1px solid var(--sn-border-soft)", paddingBottom: "var(--spacing-4)" }}
        >
          {TABS.map((tab) => (
            <button
              key={tab}
              type="button"
              role="tab"
              aria-selected={activeTab === tab}
              onClick={() => setActiveTab(tab)}
              style={{
                flex: 1,
                padding: "var(--spacing-8) var(--spacing-8)",
                borderRadius: "var(--radius-btn) var(--radius-btn) 0 0",
                border: "none",
                borderBottom: activeTab === tab ? "2px solid var(--primary)" : "2px solid transparent",
                background: "transparent",
                color: activeTab === tab ? "var(--primary)" : "var(--text-secondary)",
                cursor: "pointer",
                fontSize: "var(--font-size-body)",
                fontWeight: activeTab === tab ? 600 : 400,
                textAlign: "center",
                whiteSpace: "nowrap",
                transition: "color 0.15s, border-color 0.15s",
              }}
            >
              {tab}
            </button>
          ))}
        </div>
      </div>

      {/* ─── Zone de contenu : scroll interne uniquement ─── */}
      <div style={{ flex: 1, minHeight: 0, overflowY: "auto", paddingTop: "var(--spacing-8)" }}>

      {activeTab === "Économie" && (
        <>
      {/* Économie nationale — champs autorisés uniquement */}
      <Card variant="premium" padding="lg" style={{ marginBottom: "var(--spacing-24)" }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--spacing-16)", flexWrap: "wrap", gap: "var(--spacing-12)" }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>Économie nationale</h2>
          <div style={{ display: "flex", gap: "var(--spacing-8)", alignItems: "center" }}>
            <Button variant="ghost" size="sm" onClick={resetEconomics} disabled={!isEconomicsDirty}>
              Réinitialiser
            </Button>
            <Button variant="primary" size="sm" onClick={saveEconomics} disabled={!isEconomicsDirty || saving}>
              {saving ? "Enregistrement…" : "Enregistrer"}
            </Button>
          </div>
        </div>
        <h3 style={{ margin: "0 0 var(--spacing-12)", fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Prix &amp; tarifs</h3>
        <div className="sn-economics-grid-4">
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Prix du kWh (€)</label>
            <span className="sn-helper">Prix de référence de l&apos;électricité (hors taxes)</span>
            <input
              type="number"
              step={0.0001}
              min={0}
              value={e.price_eur_kwh ?? ""}
              onChange={(ev) => updateEconomics({ price_eur_kwh: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
        </div>
        <h3 style={{ margin: "var(--spacing-20) 0 var(--spacing-12)", fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Simulation</h3>
        <div className="sn-economics-grid-4">
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Croissance du prix de l'électricité</label>
            <span className="sn-helper">Évolution annuelle moyenne estimée</span>
            <input
              type="number"
              step={0.1}
              value={e.elec_growth_pct ?? ""}
              onChange={(ev) => updateEconomics({ elec_growth_pct: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Dégradation annuelle des modules</label>
            <span className="sn-helper">Perte moyenne de production par an</span>
            <input
              type="number"
              step={0.1}
              value={e.pv_degradation_pct ?? ""}
              onChange={(ev) => updateEconomics({ pv_degradation_pct: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Dégradation batterie physique (%/an)</label>
            <span className="sn-helper">Hypothèse moteur finance (scénario avec batterie) — priorité fiche panneau inchangée pour le PV</span>
            <input
              type="number"
              step={0.1}
              min={0}
              value={e.battery_degradation_pct ?? ""}
              onChange={(ev) => updateEconomics({ battery_degradation_pct: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Durée d'analyse financière</label>
            <span className="sn-helper">Nombre d'années simulées</span>
            <input
              type="number"
              value={e.horizon_years ?? ""}
              onChange={(ev) => updateEconomics({ horizon_years: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Tarif de rachat — installation &lt; 9 kWc</label>
            <span className="sn-helper">Tarif réglementé de revente du surplus</span>
            <input
              type="number"
              step={0.0001}
              value={e.oa_rate_lt_9 ?? ""}
              onChange={(ev) => updateEconomics({ oa_rate_lt_9: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
        </div>
        <h3 style={{ margin: "var(--spacing-20) 0 var(--spacing-12)", fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Rachat du surplus</h3>
        <div className="sn-economics-grid-3">
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Tarif de rachat — installation ≥ 9 kWc</label>
            <span className="sn-helper">Applicable aux puissances supérieures ou égales à 9 kWc</span>
            <input
              type="number"
              step={0.0001}
              value={e.oa_rate_gte_9 ?? ""}
              onChange={(ev) => updateEconomics({ oa_rate_gte_9: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Prime à l'autoconsommation &lt; 9 kWc</label>
            <span className="sn-helper">Montant versé par kWc installé</span>
            <input
              type="number"
              value={e.prime_lt9 ?? ""}
              onChange={(ev) => updateEconomics({ prime_lt9: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Prime à l'autoconsommation ≥ 9 kWc</label>
            <span className="sn-helper">Applicable aux puissances ≥ 9 kWc</span>
            <input
              type="number"
              value={e.prime_gte9 ?? ""}
              onChange={(ev) => updateEconomics({ prime_gte9: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
        </div>
        <h3 style={{ margin: "var(--spacing-20) 0 var(--spacing-12)", fontSize: "11px", fontWeight: 600, color: "var(--text-secondary)", textTransform: "uppercase", letterSpacing: "0.06em" }}>Coûts d'exploitation</h3>
        <div className="sn-economics-grid-3">
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Maintenance annuelle (%)</label>
            <span className="sn-helper">Part du CAPEX TTC par an</span>
            <input
              type="number"
              step={0.1}
              min={0}
              value={e.maintenance_pct ?? ""}
              onChange={(ev) => updateEconomics({ maintenance_pct: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Remplacement onduleur (année)</label>
            <span className="sn-helper">Année de simulation (1 à N) où appliquer le coût</span>
            <input
              type="number"
              step={1}
              min={0}
              value={e.onduleur_year ?? ""}
              onChange={(ev) => updateEconomics({ onduleur_year: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
          <div className="flex flex-col" style={{ display: "flex", flexDirection: "column" }}>
            <label style={{ display: "block", fontSize: "var(--font-size-body)", fontWeight: 500, color: "var(--text-primary)", letterSpacing: "0.025em", marginBottom: "var(--spacing-4)" }}>Coût remplacement onduleur (%)</label>
            <span className="sn-helper">Pourcentage du CAPEX TTC</span>
            <input
              type="number"
              step={0.1}
              min={0}
              value={e.onduleur_cost_pct ?? ""}
              onChange={(ev) => updateEconomics({ onduleur_cost_pct: Number(ev.target.value) || 0 })}
              style={inputStyle}
            />
          </div>
        </div>
      </Card>
        </>
      )}

      {activeTab === "Panneaux" && (
        <CatalogPanelsTab
          panels={panels}
          loading={catalogLoading}
          onAdd={() => { setEditingPanel(null); setPanelModalOpen(true); }}
          onEdit={(p) => { setEditingPanel(p); setPanelModalOpen(true); }}
          onToggle={async (p) => { await togglePanelActive(p); loadCatalogs(); }}
          onBulkActiveChange={async (ids, active) => {
            const results = await Promise.allSettled(ids.map((id) => updatePanel(id, { active })));
            const ok = results.filter((r) => r.status === "fulfilled").length;
            const fail = results.filter((r) => r.status === "rejected").length;
            loadCatalogs();
            if (fail > 0) showToast(`${ok} mis à jour, ${fail} échec(s)`, "error");
            else showToast(`${ok} panneau(x) ${active ? "activé(s)" : "désactivé(s)"}`);
          }}
        />
      )}
      {activeTab === "Micro/Onduleurs" && (
        <CatalogInvertersTab
          invertersCentral={invertersCentral}
          invertersMicro={invertersMicro}
          loading={catalogLoading}
          onAddCentral={() => { setEditingInverter(null); setInverterDefaultFamily("CENTRAL"); setInverterModalOpen(true); }}
          onAddMicro={() => { setEditingInverter(null); setInverterDefaultFamily("MICRO"); setInverterModalOpen(true); }}
          onEdit={(i) => { setEditingInverter(i); setInverterModalOpen(true); }}
          onToggle={async (i) => { await toggleInverterActive(i); loadCatalogs(); }}
          onBulkActiveChange={async (ids, active) => {
            const results = await Promise.allSettled(ids.map((id) => updateInverter(id, { active })));
            const ok = results.filter((r) => r.status === "fulfilled").length;
            const fail = results.filter((r) => r.status === "rejected").length;
            loadCatalogs();
            if (fail > 0) showToast(`${ok} mis à jour, ${fail} échec(s)`, "error");
            else showToast(`${ok} onduleur(s) ${active ? "activé(s)" : "désactivé(s)"}`);
          }}
        />
      )}
      {activeTab === "Batteries" && (
        <CatalogBatteriesTab
          batteries={batteries}
          loading={catalogLoading}
          onAdd={() => { setEditingBattery(null); setBatteryModalOpen(true); }}
          onEdit={(b) => { setEditingBattery(b); setBatteryModalOpen(true); }}
          onToggle={async (b) => { await toggleBatteryActive(b); loadCatalogs(); }}
          onBulkActiveChange={async (ids, active) => {
            const results = await Promise.allSettled(ids.map((id) => updateBattery(id, { active })));
            const ok = results.filter((r) => r.status === "fulfilled").length;
            const fail = results.filter((r) => r.status === "rejected").length;
            loadCatalogs();
            if (fail > 0) showToast(`${ok} mis à jour, ${fail} échec(s)`, "error");
            else showToast(`${ok} batterie(s) ${active ? "activée(s)" : "désactivée(s)"}`);
          }}
        />
      )}

      {activeTab === "Batteries virtuelles" && <VirtualBatterySettings />}

      </div>{/* ── fin zone scrollable ── */}

      {/* Modales : position:fixed → hors du flux, indépendantes du scroll */}
      {panelModalOpen && (
        <PvPanelModal
          panel={editingPanel}
          onSave={handlePanelSave}
          onClose={() => { setPanelModalOpen(false); setEditingPanel(null); setCatalogSaveError(null); }}
          saveError={catalogSaveError}
        />
      )}
      {inverterModalOpen && (
        <PvInverterModal
          inverter={editingInverter}
          defaultFamily={inverterDefaultFamily}
          onSave={handleInverterSave}
          onClose={() => { setInverterModalOpen(false); setEditingInverter(null); setCatalogSaveError(null); }}
          saveError={catalogSaveError}
        />
      )}
      {batteryModalOpen && (
        <PvBatteryModal
          battery={editingBattery}
          onSave={handleBatterySave}
          onClose={() => { setBatteryModalOpen(false); setEditingBattery(null); setCatalogSaveError(null); }}
          saveError={catalogSaveError}
        />
      )}
      <style>{`
        .pv-settings-page .sn-btn {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          line-height: 1.2;
        }
      `}</style>
    </div>
  );
}

const filtersRowStyle: React.CSSProperties = {
  display: "flex",
  flexWrap: "wrap",
  gap: "var(--spacing-12)",
  alignItems: "center",
  marginBottom: "var(--spacing-16)",
};

function CatalogPanelsTab({
  panels,
  loading,
  onAdd,
  onEdit,
  onToggle,
  onBulkActiveChange,
}: {
  panels: PvPanel[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (p: PvPanel) => void;
  onToggle: (p: PvPanel) => void;
  onBulkActiveChange: (ids: string[], active: boolean) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const brands = [...new Set(panels.map((p) => p.brand).filter(Boolean))].sort();
  const filtered = panels.filter((p) => {
    const matchSearch = !search || [p.brand, p.model_ref, p.name].some((v) => (v ?? "").toLowerCase().includes(search.toLowerCase()));
    const matchBrand = !brandFilter || p.brand === brandFilter;
    const matchActive = !activeOnly || p.active;
    return matchSearch && matchBrand && matchActive;
  });

  const visibleIds = new Set(filtered.map((p) => p.id));
  const selectedOnPage = [...selectedIds].filter((id) => visibleIds.has(id));
  const allSelected = filtered.length > 0 && selectedOnPage.length === filtered.length;

  const handleFilterChange = (updater: () => void) => {
    updater();
    setSelectedIds(new Set());
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((p) => p.id)));
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulk = async (active: boolean) => {
    const ids = selectedOnPage;
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      await onBulkActiveChange(ids, active);
      setSelectedIds(new Set());
    } finally {
      setBulkLoading(false);
    }
  };

  if (loading) return <div style={{ padding: "var(--spacing-24)", color: "var(--text-muted)" }}>Chargement…</div>;
  return (
    <Card variant="premium" padding="lg">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--spacing-16)" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Catalogue panneaux</h2>
        <Button variant="primary" size="sm" onClick={onAdd}>+ Ajouter</Button>
      </div>
      <div style={filtersRowStyle}>
        <input
          type="text"
          placeholder="Recherche…"
          value={search}
          onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
          style={{ ...inputStyle, width: 180 }}
        />
        <select
          value={brandFilter}
          onChange={(e) => handleFilterChange(() => setBrandFilter(e.target.value))}
          style={{ ...inputStyle, width: 160 }}
        >
          <option value="">Toutes les marques</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-8)", cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => handleFilterChange(() => setActiveOnly(e.target.checked))} />
          Actifs seulement
        </label>
      </div>
      {selectedOnPage.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-12)", marginBottom: "var(--spacing-12)", padding: "var(--spacing-8)", background: "var(--bg-muted)", borderRadius: "var(--radius-btn)" }}>
          <span style={{ fontSize: 13 }}>{selectedOnPage.length} sélectionné(s)</span>
          <Button variant="danger" size="sm" onClick={() => handleBulk(false)} disabled={bulkLoading}>Désactiver ({selectedOnPage.length})</Button>
          <Button variant="ghost" size="sm" onClick={() => handleBulk(true)} disabled={bulkLoading}>Activer ({selectedOnPage.length})</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} disabled={bulkLoading}>Annuler sélection</Button>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 40, padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={filtered.length === 0} />
              </th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Marque</th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Modèle</th>
              <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Wc</th>
              <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>L×H (mm)</th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Statut</th>
              <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: "var(--spacing-24)", color: "var(--text-muted)", textAlign: "center" }}>Aucun panneau.</td></tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id} style={{ borderBottom: "1px solid var(--sn-border-soft)" }}>
                  <td style={{ padding: "var(--spacing-8)" }}>
                    <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} />
                  </td>
                  <td style={{ padding: "var(--spacing-8)" }}>{p.brand}</td>
                  <td style={{ padding: "var(--spacing-8)" }}>{p.model_ref}</td>
                  <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>{p.power_wc}</td>
                  <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>{p.width_mm}×{p.height_mm}</td>
                  <td style={{ padding: "var(--spacing-8)" }}>
                    <span style={{ padding: "2px 8px", borderRadius: "var(--radius-pill)", fontSize: 12, background: p.active ? "rgba(22,163,74,0.2)" : "rgba(107,114,128,0.2)", color: p.active ? "var(--success)" : "var(--text-muted)" }}>{p.active ? "Actif" : "Inactif"}</span>
                  </td>
                  <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>
                    <Button variant="ghost" size="sm" onClick={() => onToggle(p)}>{p.active ? "Désactiver" : "Activer"}</Button>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(p)}>Modifier</Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function InverterBlock({
  title,
  inverters,
  onAdd,
  onEdit,
  onToggle,
  onBulkActiveChange,
}: {
  title: string;
  inverters: PvInverter[];
  onAdd: () => void;
  onEdit: (i: PvInverter) => void;
  onToggle: (i: PvInverter) => void;
  onBulkActiveChange: (ids: string[], active: boolean) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const brands = [...new Set(inverters.map((i) => i.brand).filter(Boolean))].sort();
  const filtered = inverters.filter((i) => {
    const matchSearch = !search || [i.brand, i.model_ref, i.name].some((v) => (v ?? "").toLowerCase().includes(search.toLowerCase()));
    const matchBrand = !brandFilter || i.brand === brandFilter;
    const matchActive = !activeOnly || i.active;
    return matchSearch && matchBrand && matchActive;
  });

  const visibleIds = new Set(filtered.map((i) => i.id));
  const selectedOnPage = [...selectedIds].filter((id) => visibleIds.has(id));
  const allSelected = filtered.length > 0 && selectedOnPage.length === filtered.length;

  const handleFilterChange = (updater: () => void) => {
    updater();
    setSelectedIds(new Set());
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((i) => i.id)));
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulk = async (active: boolean) => {
    const ids = selectedOnPage;
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      await onBulkActiveChange(ids, active);
      setSelectedIds(new Set());
    } finally {
      setBulkLoading(false);
    }
  };

  return (
    <Card variant="premium" padding="lg" style={{ marginBottom: "var(--spacing-24)" }}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--spacing-16)" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>{title}</h2>
        <Button variant="primary" size="sm" onClick={onAdd}>+ Ajouter</Button>
      </div>
      <div style={filtersRowStyle}>
        <input
          type="text"
          placeholder="Recherche…"
          value={search}
          onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
          style={{ ...inputStyle, width: 180 }}
        />
        <select
          value={brandFilter}
          onChange={(e) => handleFilterChange(() => setBrandFilter(e.target.value))}
          style={{ ...inputStyle, width: 160 }}
        >
          <option value="">Toutes les marques</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-8)", cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => handleFilterChange(() => setActiveOnly(e.target.checked))} />
          Actifs seulement
        </label>
      </div>
      {selectedOnPage.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-12)", marginBottom: "var(--spacing-12)", padding: "var(--spacing-8)", background: "var(--bg-muted)", borderRadius: "var(--radius-btn)" }}>
          <span style={{ fontSize: 13 }}>{selectedOnPage.length} sélectionné(s)</span>
          <Button variant="danger" size="sm" onClick={() => handleBulk(false)} disabled={bulkLoading}>Désactiver ({selectedOnPage.length})</Button>
          <Button variant="ghost" size="sm" onClick={() => handleBulk(true)} disabled={bulkLoading}>Activer ({selectedOnPage.length})</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} disabled={bulkLoading}>Annuler sélection</Button>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 40, padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={filtered.length === 0} />
              </th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Marque</th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Modèle</th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Type</th>
              <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Puissance</th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Statut</th>
              <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: "var(--spacing-24)", color: "var(--text-muted)", textAlign: "center" }}>Aucun onduleur.</td></tr>
            ) : (
              filtered.map((i) => (
                <tr key={i.id} style={{ borderBottom: "1px solid var(--sn-border-soft)" }}>
                  <td style={{ padding: "var(--spacing-8)" }}>
                    <input type="checkbox" checked={selectedIds.has(i.id)} onChange={() => toggleSelect(i.id)} />
                  </td>
                  <td style={{ padding: "var(--spacing-8)" }}>{i.brand}</td>
                  <td style={{ padding: "var(--spacing-8)" }}>{i.model_ref}</td>
                  <td style={{ padding: "var(--spacing-8)" }}>{i.inverter_type}</td>
                  <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>{i.nominal_va ? `${i.nominal_va} VA` : i.nominal_power_kw ? `${i.nominal_power_kw} kW` : "—"}</td>
                  <td style={{ padding: "var(--spacing-8)" }}>
                    <span style={{ padding: "2px 8px", borderRadius: "var(--radius-pill)", fontSize: 12, background: i.active ? "rgba(22,163,74,0.2)" : "rgba(107,114,128,0.2)", color: i.active ? "var(--success)" : "var(--text-muted)" }}>{i.active ? "Actif" : "Inactif"}</span>
                  </td>
                  <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>
                    <Button variant="ghost" size="sm" onClick={() => onToggle(i)}>{i.active ? "Désactiver" : "Activer"}</Button>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(i)}>Modifier</Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

function CatalogInvertersTab({
  invertersCentral,
  invertersMicro,
  loading,
  onAddCentral,
  onAddMicro,
  onEdit,
  onToggle,
  onBulkActiveChange,
}: {
  invertersCentral: PvInverter[];
  invertersMicro: PvInverter[];
  loading: boolean;
  onAddCentral: () => void;
  onAddMicro: () => void;
  onEdit: (i: PvInverter) => void;
  onToggle: (i: PvInverter) => void;
  onBulkActiveChange: (ids: string[], active: boolean) => Promise<void>;
}) {
  if (loading) return <div style={{ padding: "var(--spacing-24)", color: "var(--text-muted)" }}>Chargement…</div>;
  return (
    <>
      <InverterBlock
        title="Micro-onduleurs"
        inverters={invertersMicro}
        onAdd={onAddMicro}
        onEdit={onEdit}
        onToggle={onToggle}
        onBulkActiveChange={onBulkActiveChange}
      />
      {/* Séparateur visuel entre les deux catalogues */}
      <div style={{ marginTop: "var(--spacing-32)" }}>
        <InverterBlock
          title="Onduleurs centraux"
          inverters={invertersCentral}
          onAdd={onAddCentral}
          onEdit={onEdit}
          onToggle={onToggle}
          onBulkActiveChange={onBulkActiveChange}
        />
      </div>
    </>
  );
}

function CatalogBatteriesTab({
  batteries,
  loading,
  onAdd,
  onEdit,
  onToggle,
  onBulkActiveChange,
}: {
  batteries: PvBattery[];
  loading: boolean;
  onAdd: () => void;
  onEdit: (b: PvBattery) => void;
  onToggle: (b: PvBattery) => void;
  onBulkActiveChange: (ids: string[], active: boolean) => Promise<void>;
}) {
  const [search, setSearch] = useState("");
  const [brandFilter, setBrandFilter] = useState<string>("");
  const [activeOnly, setActiveOnly] = useState(false);
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [bulkLoading, setBulkLoading] = useState(false);

  const brands = [...new Set(batteries.map((b) => b.brand).filter(Boolean))].sort();
  const filtered = batteries.filter((b) => {
    const matchSearch = !search || [b.brand, b.model_ref, b.name].some((v) => (v ?? "").toLowerCase().includes(search.toLowerCase()));
    const matchBrand = !brandFilter || b.brand === brandFilter;
    const matchActive = !activeOnly || b.active;
    return matchSearch && matchBrand && matchActive;
  });

  const visibleIds = new Set(filtered.map((b) => b.id));
  const selectedOnPage = [...selectedIds].filter((id) => visibleIds.has(id));
  const allSelected = filtered.length > 0 && selectedOnPage.length === filtered.length;

  const handleFilterChange = (updater: () => void) => {
    updater();
    setSelectedIds(new Set());
  };

  const toggleSelectAll = () => {
    if (allSelected) setSelectedIds(new Set());
    else setSelectedIds(new Set(filtered.map((b) => b.id)));
  };

  const toggleSelect = (id: string) => {
    const next = new Set(selectedIds);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setSelectedIds(next);
  };

  const handleBulk = async (active: boolean) => {
    const ids = selectedOnPage;
    if (ids.length === 0) return;
    setBulkLoading(true);
    try {
      await onBulkActiveChange(ids, active);
      setSelectedIds(new Set());
    } finally {
      setBulkLoading(false);
    }
  };

  if (loading) return <div style={{ padding: "var(--spacing-24)", color: "var(--text-muted)" }}>Chargement…</div>;
  return (
    <Card variant="premium" padding="lg">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "var(--spacing-16)" }}>
        <h2 style={{ margin: 0, fontSize: 18 }}>Catalogue batteries</h2>
        <Button variant="primary" size="sm" onClick={onAdd}>+ Ajouter</Button>
      </div>
      <div style={filtersRowStyle}>
        <input
          type="text"
          placeholder="Recherche…"
          value={search}
          onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
          style={{ ...inputStyle, width: 180 }}
        />
        <select
          value={brandFilter}
          onChange={(e) => handleFilterChange(() => setBrandFilter(e.target.value))}
          style={{ ...inputStyle, width: 160 }}
        >
          <option value="">Toutes les marques</option>
          {brands.map((br) => (
            <option key={br} value={br}>{br}</option>
          ))}
        </select>
        <label style={{ display: "flex", alignItems: "center", gap: "var(--spacing-8)", cursor: "pointer", fontSize: 13 }}>
          <input type="checkbox" checked={activeOnly} onChange={(e) => handleFilterChange(() => setActiveOnly(e.target.checked))} />
          Actifs seulement
        </label>
      </div>
      {selectedOnPage.length > 0 && (
        <div style={{ display: "flex", alignItems: "center", gap: "var(--spacing-12)", marginBottom: "var(--spacing-12)", padding: "var(--spacing-8)", background: "var(--bg-muted)", borderRadius: "var(--radius-btn)" }}>
          <span style={{ fontSize: 13 }}>{selectedOnPage.length} sélectionné(s)</span>
          <Button variant="danger" size="sm" onClick={() => handleBulk(false)} disabled={bulkLoading}>Désactiver ({selectedOnPage.length})</Button>
          <Button variant="ghost" size="sm" onClick={() => handleBulk(true)} disabled={bulkLoading}>Activer ({selectedOnPage.length})</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} disabled={bulkLoading}>Annuler sélection</Button>
        </div>
      )}
      <div style={{ overflowX: "auto" }}>
        <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 13 }}>
          <thead>
            <tr>
              <th style={{ width: 40, padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={filtered.length === 0} />
              </th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Marque</th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Modèle</th>
              <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>kWh</th>
              <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Prix HT</th>
              <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Achat HT</th>
              <th style={{ textAlign: "left", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Statut</th>
              <th style={{ textAlign: "right", padding: "var(--spacing-8)", borderBottom: "1px solid var(--sn-border-soft)" }}>Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr><td colSpan={8} style={{ padding: "var(--spacing-24)", color: "var(--text-muted)", textAlign: "center" }}>Aucune batterie.</td></tr>
            ) : (
              filtered.map((b) => (
                <tr key={b.id} style={{ borderBottom: "1px solid var(--sn-border-soft)" }}>
                  <td style={{ padding: "var(--spacing-8)" }}>
                    <input type="checkbox" checked={selectedIds.has(b.id)} onChange={() => toggleSelect(b.id)} />
                  </td>
                  <td style={{ padding: "var(--spacing-8)" }}>{b.brand}</td>
                  <td style={{ padding: "var(--spacing-8)" }}>{b.model_ref}</td>
                  <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>{b.usable_kwh}</td>
                  <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>{b.default_price_ht != null ? `${Number(b.default_price_ht).toLocaleString("fr-FR")} €` : "—"}</td>
                  <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>{b.purchase_price_ht != null ? `${Number(b.purchase_price_ht).toLocaleString("fr-FR")} €` : "—"}</td>
                  <td style={{ padding: "var(--spacing-8)" }}>
                    <span style={{ padding: "2px 8px", borderRadius: "var(--radius-pill)", fontSize: 12, background: b.active ? "rgba(22,163,74,0.2)" : "rgba(107,114,128,0.2)", color: b.active ? "var(--success)" : "var(--text-muted)" }}>{b.active ? "Actif" : "Inactif"}</span>
                  </td>
                  <td style={{ padding: "var(--spacing-8)", textAlign: "right" }}>
                    <Button variant="ghost" size="sm" onClick={() => onToggle(b)}>{b.active ? "Désactiver" : "Activer"}</Button>
                    <Button variant="ghost" size="sm" onClick={() => onEdit(b)}>Modifier</Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
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

const PV_PANEL_FORM_ID = "pv-catalog-panel-form";

function PvPanelModal({ panel, onSave, onClose, saveError }: { panel: PvPanel | null; onSave: (p: Partial<PvPanel>) => void; onClose: () => void; saveError?: string | null }) {
  const [form, setForm] = useState<Partial<PvPanel>>(() => panel ?? { name: "", brand: "", model_ref: "", technology: "", bifacial: false, power_wc: 0, efficiency_pct: 0, degradation_first_year_pct: 1, degradation_annual_pct: 0.4, width_mm: 0, height_mm: 0, active: true });
  useEffect(() => { setForm(panel ?? { name: "", brand: "", model_ref: "", technology: "", bifacial: false, power_wc: 0, efficiency_pct: 0, degradation_first_year_pct: 1, degradation_annual_pct: 0.4, width_mm: 0, height_mm: 0, active: true }); }, [panel]);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = { ...form, name: (form.name ?? "").trim() || form.brand + " " + form.model_ref, brand: (form.brand ?? "").trim(), model_ref: (form.model_ref ?? "").trim(), power_wc: Number(form.power_wc) || 0, efficiency_pct: Number(form.efficiency_pct) || 0, width_mm: Number(form.width_mm) || 0, height_mm: Number(form.height_mm) || 0 };
    if (!p.brand || !p.model_ref || p.power_wc <= 0 || p.width_mm <= 0 || p.height_mm <= 0) return;
    onSave(p);
  };
  return (
    <ModalShell
      open
      onClose={onClose}
      size="lg"
      title={panel ? "Modifier le panneau" : "Ajouter un panneau"}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" form={PV_PANEL_FORM_ID}>
            Enregistrer
          </Button>
        </>
      }
    >
        {saveError && <div style={alertErrorStyle} role="alert">{saveError}</div>}
        <form id={PV_PANEL_FORM_ID} onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-12)" }}>
            <Field label="Marque *"><input type="text" value={form.brand ?? ""} onChange={(e) => setForm({ ...form, brand: e.target.value })} style={inputStyle} required readOnly={!!panel} /></Field>
            <Field label="Modèle / Réf *"><input type="text" value={form.model_ref ?? ""} onChange={(e) => setForm({ ...form, model_ref: e.target.value })} style={inputStyle} required readOnly={!!panel} /></Field>
            {panel && (
              <p style={{ margin: 0, fontSize: "var(--font-size-body-sm)", color: "var(--text-muted)", lineHeight: 1.4 }}>
                La référence technique n'est pas modifiable. Dupliquez le produit pour créer une nouvelle référence.
              </p>
            )}
            <Field label="Nom affiché"><input type="text" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} placeholder="ex: LONGi 485W" /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Technologie"><input type="text" value={form.technology ?? ""} onChange={(e) => setForm({ ...form, technology: e.target.value })} style={inputStyle} placeholder="PERC, TOPCon, HJT" /></Field>
              <Field label="Bifacial"><label><input type="checkbox" checked={form.bifacial ?? false} onChange={(e) => setForm({ ...form, bifacial: e.target.checked })} /> Oui</label></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Puissance (Wc) *"><input type="number" value={form.power_wc ?? ""} onChange={(e) => setForm({ ...form, power_wc: Number(e.target.value) || 0 })} style={inputStyle} required /></Field>
              <Field label="Rendement (%) *"><input type="number" step={0.01} value={form.efficiency_pct ?? ""} onChange={(e) => setForm({ ...form, efficiency_pct: Number(e.target.value) || 0 })} style={inputStyle} required /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Coeff. temp (°C)"><input type="number" step={0.001} value={form.temp_coeff_pct_per_deg ?? ""} onChange={(e) => setForm({ ...form, temp_coeff_pct_per_deg: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Dégrad. an 1 (%)"><input type="number" step={0.01} value={form.degradation_first_year_pct ?? ""} onChange={(e) => setForm({ ...form, degradation_first_year_pct: Number(e.target.value) || 1 })} style={inputStyle} /></Field>
              <Field label="Dégrad. annuelle (%)"><input type="number" step={0.01} value={form.degradation_annual_pct ?? ""} onChange={(e) => setForm({ ...form, degradation_annual_pct: Number(e.target.value) || 0.4 })} style={inputStyle} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Voc (V)"><input type="number" step={0.01} value={form.voc_v ?? ""} onChange={(e) => setForm({ ...form, voc_v: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Isc (A)"><input type="number" step={0.01} value={form.isc_a ?? ""} onChange={(e) => setForm({ ...form, isc_a: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Vmp (V)"><input type="number" step={0.01} value={form.vmp_v ?? ""} onChange={(e) => setForm({ ...form, vmp_v: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Imp (A)"><input type="number" step={0.01} value={form.imp_a ?? ""} onChange={(e) => setForm({ ...form, imp_a: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Largeur (mm) *"><input type="number" value={form.width_mm ?? ""} onChange={(e) => setForm({ ...form, width_mm: Number(e.target.value) || 0 })} style={inputStyle} required /></Field>
              <Field label="Hauteur (mm) *"><input type="number" value={form.height_mm ?? ""} onChange={(e) => setForm({ ...form, height_mm: Number(e.target.value) || 0 })} style={inputStyle} required /></Field>
              <Field label="Épaisseur (mm)"><input type="number" value={form.thickness_mm ?? ""} onChange={(e) => setForm({ ...form, thickness_mm: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Poids (kg)"><input type="number" step={0.01} value={form.weight_kg ?? ""} onChange={(e) => setForm({ ...form, weight_kg: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Garantie produit (ans)"><input type="number" value={form.warranty_product_years ?? ""} onChange={(e) => setForm({ ...form, warranty_product_years: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Garantie perf. (ans)"><input type="number" value={form.warranty_performance_years ?? ""} onChange={(e) => setForm({ ...form, warranty_performance_years: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
            </div>
            <Field label="Actif"><label><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Oui</label></Field>
          </div>
        </form>
    </ModalShell>
  );
}

const PV_INVERTER_FORM_ID = "pv-catalog-inverter-form";

function PvInverterModal({ inverter, defaultFamily, onSave, onClose, saveError }: { inverter: PvInverter | null; defaultFamily?: "CENTRAL" | "MICRO"; onSave: (i: Partial<PvInverter>) => void; onClose: () => void; saveError?: string | null }) {
  const initialForm = () => {
    if (inverter) return { ...inverter };
    return {
      name: "", brand: "", model_ref: "", inverter_type: "micro" as const,
      inverter_family: (defaultFamily ?? "CENTRAL") as "CENTRAL" | "MICRO",
      nominal_va: undefined, nominal_power_kw: undefined, phases: "1P", compatible_battery: false, active: true,
    };
  };
  const [form, setForm] = useState<Partial<PvInverter>>(initialForm);
  useEffect(() => {
    setForm(inverter ? { ...inverter } : {
      name: "", brand: "", model_ref: "", inverter_type: "micro",
      inverter_family: (defaultFamily ?? "CENTRAL") as "CENTRAL" | "MICRO",
      nominal_va: undefined, nominal_power_kw: undefined, phases: "1P", compatible_battery: false, active: true,
    });
  }, [inverter, defaultFamily]);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = { ...form, name: (form.name ?? "").trim() || form.brand + " " + form.model_ref, brand: (form.brand ?? "").trim(), model_ref: (form.model_ref ?? "").trim() };
    if (!p.brand || !p.model_ref || !p.inverter_type || !p.inverter_family) return;
    onSave(p);
  };
  const family = form.inverter_family ?? "CENTRAL";
  return (
    <ModalShell
      open
      onClose={onClose}
      size="lg"
      title={inverter ? "Modifier l'onduleur" : "Ajouter un onduleur"}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" form={PV_INVERTER_FORM_ID}>
            Enregistrer
          </Button>
        </>
      }
    >
        {saveError && <div style={alertErrorStyle} role="alert">{saveError}</div>}
        <form id={PV_INVERTER_FORM_ID} onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-12)" }}>
            <Field label="Marque *"><input type="text" value={form.brand ?? ""} onChange={(e) => setForm({ ...form, brand: e.target.value })} style={inputStyle} required /></Field>
            <Field label="Modèle / Réf *"><input type="text" value={form.model_ref ?? ""} onChange={(e) => setForm({ ...form, model_ref: e.target.value })} style={inputStyle} required /></Field>
            <Field label="Nom affiché"><input type="text" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} /></Field>
            <Field label="Famille *"><select value={form.inverter_family ?? "CENTRAL"} onChange={(e) => setForm({ ...form, inverter_family: e.target.value as "CENTRAL" | "MICRO" })} style={inputStyle} required><option value="CENTRAL">CENTRAL</option><option value="MICRO">MICRO</option></select></Field>
            <Field label="Type *"><select value={form.inverter_type ?? "micro"} onChange={(e) => setForm({ ...form, inverter_type: e.target.value as "micro" | "string" })} style={inputStyle}><option value="micro">Micro</option><option value="string">String</option></select></Field>
            {form.inverter_type === "micro" ? (
              <>
                <Field label="Nominal VA *"><input type="number" value={form.nominal_va ?? ""} onChange={(e) => setForm({ ...form, nominal_va: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
                <Field label="Modules par onduleur *"><input type="number" value={form.modules_per_inverter ?? ""} onChange={(e) => setForm({ ...form, modules_per_inverter: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} min={1} /></Field>
              </>
            ) : (
              <Field label="Puissance nominale (kW)"><input type="number" step={0.01} value={form.nominal_power_kw ?? ""} onChange={(e) => setForm({ ...form, nominal_power_kw: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
            )}
            <Field label="Phases"><select value={form.phases ?? ""} onChange={(e) => setForm({ ...form, phases: e.target.value || undefined })} style={inputStyle}><option value="">—</option><option value="1P">1P</option><option value="3P">3P</option></select></Field>
            <p style={{ margin: 0, fontSize: "var(--font-size-body-sm)", color: "var(--text-muted)", lineHeight: 1.4 }}>
              {family === "MICRO"
                ? "Les paramètres MPPT ne s'appliquent pas aux micro-onduleurs."
                : "Les paramètres MPPT sont requis pour le dimensionnement des strings."}
            </p>
            {family === "CENTRAL" && (
              <>
                <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-12)" }}>
                  <Field label="MPPT count"><input type="number" value={form.mppt_count ?? ""} onChange={(e) => setForm({ ...form, mppt_count: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
                  <Field label="Inputs/MPPT"><input type="number" value={form.inputs_per_mppt ?? ""} onChange={(e) => setForm({ ...form, inputs_per_mppt: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
                  <Field label="MPPT min V"><input type="number" step={0.01} value={form.mppt_min_v ?? ""} onChange={(e) => setForm({ ...form, mppt_min_v: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
                  <Field label="MPPT max V"><input type="number" step={0.01} value={form.mppt_max_v ?? ""} onChange={(e) => setForm({ ...form, mppt_max_v: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
                </div>
                <Field label="Euro efficiency (%)"><input type="number" step={0.01} value={form.euro_efficiency_pct ?? ""} onChange={(e) => setForm({ ...form, euro_efficiency_pct: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              </>
            )}
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Max input current (A)"><input type="number" step={0.01} value={form.max_input_current_a ?? ""} onChange={(e) => setForm({ ...form, max_input_current_a: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Max DC power (kW)"><input type="number" step={0.01} value={form.max_dc_power_kw ?? ""} onChange={(e) => setForm({ ...form, max_dc_power_kw: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
            </div>
            <Field label="Compatible batterie"><label><input type="checkbox" checked={form.compatible_battery ?? false} onChange={(e) => setForm({ ...form, compatible_battery: e.target.checked })} /> Oui</label></Field>
            <Field label="Actif"><label><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Oui</label></Field>
          </div>
        </form>
    </ModalShell>
  );
}

const PV_BATTERY_FORM_ID = "pv-catalog-battery-form";

function PvBatteryModal({ battery, onSave, onClose, saveError }: { battery: PvBattery | null; onSave: (b: Partial<PvBattery>) => void; onClose: () => void; saveError?: string | null }) {
  const [form, setForm] = useState<Partial<PvBattery>>(() => battery ?? { name: "", brand: "", model_ref: "", usable_kwh: 0, chemistry: "LFP", scalable: false, active: true });
  useEffect(() => { setForm(battery ?? { name: "", brand: "", model_ref: "", usable_kwh: 0, chemistry: "LFP", scalable: false, active: true }); }, [battery]);
  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const p = {
      ...form,
      name: (form.name ?? "").trim() || form.brand + " " + form.model_ref,
      brand: (form.brand ?? "").trim(),
      model_ref: (form.model_ref ?? "").trim(),
      usable_kwh: Number(form.usable_kwh) || 0,
      purchase_price_ht:
        form.purchase_price_ht === undefined || form.purchase_price_ht === null
          ? null
          : Number(form.purchase_price_ht),
    };
    if (!p.brand || !p.model_ref || p.usable_kwh <= 0) return;
    onSave(p);
  };
  return (
    <ModalShell
      open
      onClose={onClose}
      size="lg"
      title={battery ? "Modifier la batterie" : "Ajouter une batterie"}
      footer={
        <>
          <Button type="button" variant="ghost" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" form={PV_BATTERY_FORM_ID}>
            Enregistrer
          </Button>
        </>
      }
    >
        {saveError && <div style={alertErrorStyle} role="alert">{saveError}</div>}
        <form id={PV_BATTERY_FORM_ID} onSubmit={handleSubmit}>
          <div style={{ display: "flex", flexDirection: "column", gap: "var(--spacing-12)" }}>
            <Field label="Marque *"><input type="text" value={form.brand ?? ""} onChange={(e) => setForm({ ...form, brand: e.target.value })} style={inputStyle} required /></Field>
            <Field label="Modèle / Réf *"><input type="text" value={form.model_ref ?? ""} onChange={(e) => setForm({ ...form, model_ref: e.target.value })} style={inputStyle} required /></Field>
            <Field label="Nom affiché"><input type="text" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} style={inputStyle} /></Field>
            <Field label="Prix catalogue HT (€)"><input type="number" min={0} step={0.01} value={form.default_price_ht ?? ""} onChange={(e) => setForm({ ...form, default_price_ht: e.target.value === "" ? undefined : Number(e.target.value) })} style={inputStyle} placeholder="—" /></Field>
            <Field label="Prix d&apos;achat HT (€)" sublabel="Optionnel — marge interne devis technique">
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.purchase_price_ht ?? ""}
                onChange={(e) =>
                  setForm({ ...form, purchase_price_ht: e.target.value === "" ? undefined : Number(e.target.value) })
                }
                style={inputStyle}
                placeholder="—"
              />
            </Field>
            <Field label="Capacité utilisable (kWh) *"><input type="number" step={0.01} value={form.usable_kwh ?? ""} onChange={(e) => setForm({ ...form, usable_kwh: Number(e.target.value) || 0 })} style={inputStyle} required /></Field>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Tension nominale (V)"><input type="number" step={0.01} value={form.nominal_voltage_v ?? ""} onChange={(e) => setForm({ ...form, nominal_voltage_v: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Chimie"><input type="text" value={form.chemistry ?? ""} onChange={(e) => setForm({ ...form, chemistry: e.target.value })} style={inputStyle} placeholder="LFP" /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Charge max (kW)"><input type="number" step={0.01} value={form.max_charge_kw ?? ""} onChange={(e) => setForm({ ...form, max_charge_kw: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Décharge max (kW)"><input type="number" step={0.01} value={form.max_discharge_kw ?? ""} onChange={(e) => setForm({ ...form, max_discharge_kw: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Rendement (%)"><input type="number" step={0.01} value={form.roundtrip_efficiency_pct ?? ""} onChange={(e) => setForm({ ...form, roundtrip_efficiency_pct: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="DoD (%)"><input type="number" step={0.01} value={form.depth_of_discharge_pct ?? ""} onChange={(e) => setForm({ ...form, depth_of_discharge_pct: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
              <Field label="Cycles"><input type="number" value={form.cycle_life ?? ""} onChange={(e) => setForm({ ...form, cycle_life: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
            </div>
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "var(--spacing-12)" }}>
              <Field label="Scalable"><label><input type="checkbox" checked={form.scalable ?? false} onChange={(e) => setForm({ ...form, scalable: e.target.checked })} /> Oui</label></Field>
              <Field label="Max modules"><input type="number" value={form.max_modules ?? ""} onChange={(e) => setForm({ ...form, max_modules: e.target.value ? Number(e.target.value) : undefined })} style={inputStyle} /></Field>
            </div>
            <Field label="Actif"><label><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Oui</label></Field>
          </div>
        </form>
    </ModalShell>
  );
}
