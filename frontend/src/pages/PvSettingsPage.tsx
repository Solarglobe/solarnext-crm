/**
 * CP-002 — Paramètres PV — 5 onglets : Économie, Panneaux, Micro/Onduleurs, Batteries, Batteries virtuelles
 * CP-002-FIX : Onglet Économie simplifié (Économie nationale uniquement), filtres marque/recherche/actifs sur catalogues
 * Route: /admin/settings/pv
 * Accès: SUPER_ADMIN, ADMIN (via AdminRoute / org.settings.manage)
 */

import React, { useEffect, useState, useCallback } from "react";
import { Button } from "../components/ui/Button";
import { ModalShell } from "../components/ui/ModalShell";
import { SaasTabs } from "../components/ui/SaasTabs";
import "../modules/admin/admin-tab-quote-catalog.css";
import "./pv-settings-page.css";
import VirtualBatterySettings from "../modules/pv/VirtualBatterySettings";
import {
  adminGetOrgSettings,
  adminPostOrgSettings,
  type OrgPvSettings,
} from "../services/admin.api";
import { ORG_ECONOMICS_UI_KEYS } from "../config/orgEconomicsKeys";
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

/** Onglets paramètres PV — ids stables pour SaasTabs */
type PvSettingsTabId = "economie" | "panneaux" | "onduleurs" | "batteries" | "virtuelles";

const PV_TAB_ITEMS: { id: PvSettingsTabId; label: string }[] = [
  { id: "economie", label: "Économie" },
  { id: "panneaux", label: "Panneaux" },
  { id: "onduleurs", label: "Micro/Onduleurs" },
  { id: "batteries", label: "Batteries" },
  { id: "virtuelles", label: "Batteries virtuelles" },
];

function Field({
  label,
  sublabel,
  children,
  style,
}: {
  label: string;
  sublabel?: string;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div style={style}>
      <span className="qc-modal-label">{label}</span>
      {sublabel ? <p className="pv-eco-hint" style={{ marginTop: 4 }}>{sublabel}</p> : null}
      {children}
    </div>
  );
}

/** Aligné sur `config/orgEconomicsKeys` ↔ backend `orgEconomics.common.js`. */
const ECONOMICS_KEYS = ORG_ECONOMICS_UI_KEYS;

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
  const [pvTab, setPvTab] = useState<PvSettingsTabId>("economie");
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
    if (pvTab !== "economie") loadCatalogs();
  }, [pvTab, loadCatalogs]);

  const saveEconomics = async () => {
    if (!data?.economics) {
      showToast("Données économiques indisponibles. Rechargez la page.", "error");
      return;
    }
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
      <div className="pv-settings-page">
        <p className="sn-saas-muted">Chargement…</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="pv-settings-page">
        <p className="sn-saas-callout-error__text" style={{ color: "var(--danger)" }}>
          {error || "Données non disponibles"}
        </p>
      </div>
    );
  }

  const e = data.economics ?? {};

  return (
    <div className="pv-settings-page">
      <div className="pv-settings-page__sticky">
        <header style={{ marginBottom: 16 }}>
          <h1 className="sg-title">Paramètres PV</h1>
          <p className="pv-settings-page__lead">
            Paramètres économiques, catalogues panneaux, micro-onduleurs et batteries. Les blocs API hérités{" "}
            <code>pvtech</code> / <code>ai</code> restent en base mais ne sont plus exposés ici (non branchés au moteur).
          </p>
        </header>

        <SaasTabs<PvSettingsTabId>
          items={PV_TAB_ITEMS}
          activeId={pvTab}
          onChange={setPvTab}
          ariaLabel="Sections paramètres PV"
        />
      </div>

      <div className="pv-settings-page__scroll">

      {pvTab === "economie" && (
        <div className="pv-eco-stack">
          <div className="pv-eco-topbar">
            <div className="pv-eco-topbar__text">
              <h2 className="pv-eco-topbar__title">Économie nationale</h2>
              <p className="pv-eco-topbar__lead">Prix, simulation, rachat et OPEX — mise en page dense pour laptop.</p>
            </div>
            <div className="pv-eco-head__actions">
              <Button variant="ghost" size="sm" onClick={resetEconomics} disabled={!isEconomicsDirty}>
                Réinitialiser
              </Button>
              <Button variant="primary" size="sm" onClick={saveEconomics} disabled={!isEconomicsDirty || saving}>
                {saving ? "Enregistrement…" : "Enregistrer"}
              </Button>
            </div>
          </div>

          <section className="sn-saas-form-section">
            <h3 className="sn-saas-form-section__title">Prix, simulation &amp; rachat &lt; 9 kWc</h3>
            <div className="pv-eco-grid--dense">
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-kwh">Prix du kWh (€)</label>
                <p className="pv-eco-hint">Référence HT</p>
                <input
                  id="pv-eco-kwh"
                  type="number"
                  step={0.0001}
                  min={0}
                  value={e.price_eur_kwh ?? ""}
                  onChange={(ev) => updateEconomics({ price_eur_kwh: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-elec-growth">Croissance prix élec. (%/an)</label>
                <p className="pv-eco-hint">Hypothèse long terme</p>
                <input
                  id="pv-eco-elec-growth"
                  type="number"
                  step={0.1}
                  value={e.elec_growth_pct ?? ""}
                  onChange={(ev) => updateEconomics({ elec_growth_pct: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-pvdeg">Dégrad. modules (%/an)</label>
                <p className="pv-eco-hint">Perte production</p>
                <input
                  id="pv-eco-pvdeg"
                  type="number"
                  step={0.1}
                  value={e.pv_degradation_pct ?? ""}
                  onChange={(ev) => updateEconomics({ pv_degradation_pct: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-batdeg">Dégrad. batterie (%/an)</label>
                <p className="pv-eco-hint">Scénario avec stockage</p>
                <input
                  id="pv-eco-batdeg"
                  type="number"
                  step={0.1}
                  min={0}
                  value={e.battery_degradation_pct ?? ""}
                  onChange={(ev) => updateEconomics({ battery_degradation_pct: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-horizon">Horizon (années)</label>
                <p className="pv-eco-hint">Durée analyse</p>
                <input
                  id="pv-eco-horizon"
                  type="number"
                  value={e.horizon_years ?? ""}
                  onChange={(ev) => updateEconomics({ horizon_years: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-oa-lt">Rachat surplus &lt; 9 kWc</label>
                <p className="pv-eco-hint">€/kWh injecté</p>
                <input
                  id="pv-eco-oa-lt"
                  type="number"
                  step={0.0001}
                  value={e.oa_rate_lt_9 ?? ""}
                  onChange={(ev) => updateEconomics({ oa_rate_lt_9: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
            </div>
          </section>

          <section className="sn-saas-form-section">
            <h3 className="sn-saas-form-section__title">Rachat ≥ 9 kWc, primes &amp; exploitation</h3>
            <div className="pv-eco-grid--dense">
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-oa-gte">Rachat surplus ≥ 9 kWc</label>
                <p className="pv-eco-hint">€/kWh injecté</p>
                <input
                  id="pv-eco-oa-gte"
                  type="number"
                  step={0.0001}
                  value={e.oa_rate_gte_9 ?? ""}
                  onChange={(ev) => updateEconomics({ oa_rate_gte_9: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-prime-lt">Prime auto. &lt; 9 kWc</label>
                <p className="pv-eco-hint">€/kWc</p>
                <input
                  id="pv-eco-prime-lt"
                  type="number"
                  value={e.prime_lt9 ?? ""}
                  onChange={(ev) => updateEconomics({ prime_lt9: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-prime-gte">Prime auto. ≥ 9 kWc</label>
                <p className="pv-eco-hint">€/kWc</p>
                <input
                  id="pv-eco-prime-gte"
                  type="number"
                  value={e.prime_gte9 ?? ""}
                  onChange={(ev) => updateEconomics({ prime_gte9: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-maint">Maintenance (%/an)</label>
                <p className="pv-eco-hint">% CAPEX TTC</p>
                <input
                  id="pv-eco-maint"
                  type="number"
                  step={0.1}
                  min={0}
                  value={e.maintenance_pct ?? ""}
                  onChange={(ev) => updateEconomics({ maintenance_pct: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-inv-y">Remplac. onduleur (année)</label>
                <p className="pv-eco-hint">Index 1…N</p>
                <input
                  id="pv-eco-inv-y"
                  type="number"
                  step={1}
                  min={0}
                  value={e.onduleur_year ?? ""}
                  onChange={(ev) => updateEconomics({ onduleur_year: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
              <div className="pv-eco-field">
                <label className="sn-saas-label" htmlFor="pv-eco-inv-pct">Coût onduleur (%)</label>
                <p className="pv-eco-hint">% CAPEX TTC</p>
                <input
                  id="pv-eco-inv-pct"
                  type="number"
                  step={0.1}
                  min={0}
                  value={e.onduleur_cost_pct ?? ""}
                  onChange={(ev) => updateEconomics({ onduleur_cost_pct: Number(ev.target.value) || 0 })}
                  className="sn-saas-input"
                />
              </div>
            </div>
          </section>
        </div>
      )}

      {pvTab === "panneaux" && (
        <div className="pv-cat-page">
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
        </div>
      )}
      {pvTab === "onduleurs" && (
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
      {pvTab === "batteries" && (
        <div className="pv-cat-page">
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
        </div>
      )}

      {pvTab === "virtuelles" && <VirtualBatterySettings />}

      </div>

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
    </div>
  );
}

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

  if (loading) return <div className="pv-cat-empty">Chargement…</div>;
  return (
    <section className="sn-saas-form-section">
      <div className="sn-saas-form-section__head">
        <h2 className="sn-saas-form-section__title">Catalogue panneaux</h2>
        <Button variant="primary" size="sm" onClick={onAdd}>+ Ajouter</Button>
      </div>
      <p className="pv-eco-hint" style={{ marginTop: -6, marginBottom: 12 }}>Filtrez par marque ou texte, puis activez ou éditez les références.</p>
      <div className="pv-cat-toolbar">
        <input
          type="text"
          placeholder="Recherche…"
          value={search}
          onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
          className="pv-cat-filter"
        />
        <select
          value={brandFilter}
          onChange={(e) => handleFilterChange(() => setBrandFilter(e.target.value))}
          className="pv-cat-filter"
        >
          <option value="">Toutes les marques</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <label className="pv-cat-check">
          <input type="checkbox" checked={activeOnly} onChange={(e) => handleFilterChange(() => setActiveOnly(e.target.checked))} />
          Actifs seulement
        </label>
      </div>
      {selectedOnPage.length > 0 && (
        <div className="pv-bulk-bar">
          <span className="pv-bulk-bar__count">{selectedOnPage.length} sélectionné(s)</span>
          <Button variant="secondary" size="sm" onClick={() => handleBulk(false)} disabled={bulkLoading}>Désactiver</Button>
          <Button variant="secondary" size="sm" onClick={() => handleBulk(true)} disabled={bulkLoading}>Activer</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} disabled={bulkLoading}>Effacer</Button>
        </div>
      )}
      <div className="pv-cat-table-wrap">
        <table className="pv-cat-table">
          <thead>
            <tr>
              <th className="pv-cat-table__th--check" scope="col">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={filtered.length === 0} aria-label="Tout sélectionner" />
              </th>
              <th scope="col">Marque</th>
              <th scope="col">Modèle</th>
              <th className="pv-cat-table__th--right" scope="col">Wc</th>
              <th className="pv-cat-table__th--right" scope="col">L×H (mm)</th>
              <th scope="col">Statut</th>
              <th className="pv-cat-table__th--right" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <p className="pv-cat-empty">Aucun panneau.</p>
                </td>
              </tr>
            ) : (
              filtered.map((p) => (
                <tr key={p.id}>
                  <td className="pv-cat-table__td--check">
                    <input type="checkbox" checked={selectedIds.has(p.id)} onChange={() => toggleSelect(p.id)} aria-label={`Sélectionner ${p.brand} ${p.model_ref}`} />
                  </td>
                  <td>{p.brand}</td>
                  <td>{p.model_ref}</td>
                  <td className="pv-cat-table__td--right">{p.power_wc}</td>
                  <td className="pv-cat-table__td--right">{p.width_mm}×{p.height_mm}</td>
                  <td>
                    <span className={p.active ? "pv-cat-badge pv-cat-badge--on" : "pv-cat-badge pv-cat-badge--off"}>{p.active ? "Actif" : "Inactif"}</span>
                  </td>
                  <td className="pv-cat-table__td--right">
                    <div className="pv-cat-row-actions">
                      <Button variant="ghost" size="sm" onClick={() => onToggle(p)}>{p.active ? "Désact." : "Activer"}</Button>
                      <Button variant="ghost" size="sm" onClick={() => onEdit(p)}>Modifier</Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function InverterBlock({
  title,
  inverters,
  onAdd,
  onEdit,
  onToggle,
  onBulkActiveChange,
  addButtonVariant = "primary",
}: {
  title: string;
  inverters: PvInverter[];
  onAdd: () => void;
  onEdit: (i: PvInverter) => void;
  onToggle: (i: PvInverter) => void;
  onBulkActiveChange: (ids: string[], active: boolean) => Promise<void>;
  /** Une seule action primaire par écran : le second bloc catalogue passe en secondary. */
  addButtonVariant?: "primary" | "secondary";
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
    <section className="sn-saas-form-section">
      <div className="sn-saas-form-section__head">
        <h2 className="sn-saas-form-section__title">{title}</h2>
        <Button variant={addButtonVariant} size="sm" onClick={onAdd}>+ Ajouter</Button>
      </div>
      <div className="pv-cat-toolbar">
        <input
          type="text"
          placeholder="Recherche…"
          value={search}
          onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
          className="pv-cat-filter"
        />
        <select
          value={brandFilter}
          onChange={(e) => handleFilterChange(() => setBrandFilter(e.target.value))}
          className="pv-cat-filter"
        >
          <option value="">Toutes les marques</option>
          {brands.map((b) => (
            <option key={b} value={b}>{b}</option>
          ))}
        </select>
        <label className="pv-cat-check">
          <input type="checkbox" checked={activeOnly} onChange={(e) => handleFilterChange(() => setActiveOnly(e.target.checked))} />
          Actifs seulement
        </label>
      </div>
      {selectedOnPage.length > 0 && (
        <div className="pv-bulk-bar">
          <span className="pv-bulk-bar__count">{selectedOnPage.length} sélectionné(s)</span>
          <Button variant="secondary" size="sm" onClick={() => handleBulk(false)} disabled={bulkLoading}>Désactiver</Button>
          <Button variant="secondary" size="sm" onClick={() => handleBulk(true)} disabled={bulkLoading}>Activer</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} disabled={bulkLoading}>Effacer</Button>
        </div>
      )}
      <div className="pv-cat-table-wrap">
        <table className="pv-cat-table">
          <thead>
            <tr>
              <th className="pv-cat-table__th--check" scope="col">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={filtered.length === 0} aria-label="Tout sélectionner" />
              </th>
              <th scope="col">Marque</th>
              <th scope="col">Modèle</th>
              <th scope="col">Type</th>
              <th className="pv-cat-table__th--right" scope="col">Puissance</th>
              <th scope="col">Statut</th>
              <th className="pv-cat-table__th--right" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={7}>
                  <p className="pv-cat-empty">Aucun onduleur.</p>
                </td>
              </tr>
            ) : (
              filtered.map((i) => (
                <tr key={i.id}>
                  <td className="pv-cat-table__td--check">
                    <input type="checkbox" checked={selectedIds.has(i.id)} onChange={() => toggleSelect(i.id)} aria-label={`Sélectionner ${i.brand} ${i.model_ref}`} />
                  </td>
                  <td>{i.brand}</td>
                  <td>{i.model_ref}</td>
                  <td>{i.inverter_type}</td>
                  <td className="pv-cat-table__td--right">{i.nominal_va ? `${i.nominal_va} VA` : i.nominal_power_kw ? `${i.nominal_power_kw} kW` : "—"}</td>
                  <td>
                    <span className={i.active ? "pv-cat-badge pv-cat-badge--on" : "pv-cat-badge pv-cat-badge--off"}>{i.active ? "Actif" : "Inactif"}</span>
                  </td>
                  <td className="pv-cat-table__td--right">
                    <div className="pv-cat-row-actions">
                      <Button variant="ghost" size="sm" onClick={() => onToggle(i)}>{i.active ? "Désact." : "Activer"}</Button>
                      <Button variant="ghost" size="sm" onClick={() => onEdit(i)}>Modifier</Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
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
  if (loading) return <div className="pv-cat-empty">Chargement…</div>;
  return (
    <div className="pv-cat-page">
      <InverterBlock
        title="Micro-onduleurs"
        inverters={invertersMicro}
        onAdd={onAddMicro}
        onEdit={onEdit}
        onToggle={onToggle}
        onBulkActiveChange={onBulkActiveChange}
        addButtonVariant="primary"
      />
      <div className="pv-cat-block-gap">
        <InverterBlock
          title="Onduleurs centraux"
          inverters={invertersCentral}
          onAdd={onAddCentral}
          onEdit={onEdit}
          onToggle={onToggle}
          onBulkActiveChange={onBulkActiveChange}
          addButtonVariant="secondary"
        />
      </div>
    </div>
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

  if (loading) return <div className="pv-cat-empty">Chargement…</div>;
  return (
    <section className="sn-saas-form-section">
      <div className="sn-saas-form-section__head">
        <h2 className="sn-saas-form-section__title">Catalogue batteries</h2>
        <Button variant="primary" size="sm" onClick={onAdd}>+ Ajouter</Button>
      </div>
      <p className="pv-eco-hint" style={{ marginTop: -6, marginBottom: 12 }}>Prix catalogue et achat optionnel pour le suivi de marge.</p>
      <div className="pv-cat-toolbar">
        <input
          type="text"
          placeholder="Recherche…"
          value={search}
          onChange={(e) => handleFilterChange(() => setSearch(e.target.value))}
          className="pv-cat-filter"
        />
        <select
          value={brandFilter}
          onChange={(e) => handleFilterChange(() => setBrandFilter(e.target.value))}
          className="pv-cat-filter"
        >
          <option value="">Toutes les marques</option>
          {brands.map((br) => (
            <option key={br} value={br}>{br}</option>
          ))}
        </select>
        <label className="pv-cat-check">
          <input type="checkbox" checked={activeOnly} onChange={(e) => handleFilterChange(() => setActiveOnly(e.target.checked))} />
          Actifs seulement
        </label>
      </div>
      {selectedOnPage.length > 0 && (
        <div className="pv-bulk-bar">
          <span className="pv-bulk-bar__count">{selectedOnPage.length} sélectionné(s)</span>
          <Button variant="secondary" size="sm" onClick={() => handleBulk(false)} disabled={bulkLoading}>Désactiver</Button>
          <Button variant="secondary" size="sm" onClick={() => handleBulk(true)} disabled={bulkLoading}>Activer</Button>
          <Button variant="ghost" size="sm" onClick={() => setSelectedIds(new Set())} disabled={bulkLoading}>Effacer</Button>
        </div>
      )}
      <div className="pv-cat-table-wrap">
        <table className="pv-cat-table">
          <thead>
            <tr>
              <th className="pv-cat-table__th--check" scope="col">
                <input type="checkbox" checked={allSelected} onChange={toggleSelectAll} disabled={filtered.length === 0} aria-label="Tout sélectionner" />
              </th>
              <th scope="col">Marque</th>
              <th scope="col">Modèle</th>
              <th className="pv-cat-table__th--right" scope="col">kWh</th>
              <th className="pv-cat-table__th--right" scope="col">Prix HT</th>
              <th className="pv-cat-table__th--right" scope="col">Achat HT</th>
              <th scope="col">Statut</th>
              <th className="pv-cat-table__th--right" scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {filtered.length === 0 ? (
              <tr>
                <td colSpan={8}>
                  <p className="pv-cat-empty">Aucune batterie.</p>
                </td>
              </tr>
            ) : (
              filtered.map((b) => (
                <tr key={b.id}>
                  <td className="pv-cat-table__td--check">
                    <input type="checkbox" checked={selectedIds.has(b.id)} onChange={() => toggleSelect(b.id)} aria-label={`Sélectionner ${b.brand} ${b.model_ref}`} />
                  </td>
                  <td>{b.brand}</td>
                  <td>{b.model_ref}</td>
                  <td className="pv-cat-table__td--right">{b.usable_kwh}</td>
                  <td className="pv-cat-table__td--right">{b.default_price_ht != null ? `${Number(b.default_price_ht).toLocaleString("fr-FR")} €` : "—"}</td>
                  <td className="pv-cat-table__td--right">{b.purchase_price_ht != null ? `${Number(b.purchase_price_ht).toLocaleString("fr-FR")} €` : "—"}</td>
                  <td>
                    <span className={b.active ? "pv-cat-badge pv-cat-badge--on" : "pv-cat-badge pv-cat-badge--off"}>{b.active ? "Actif" : "Inactif"}</span>
                  </td>
                  <td className="pv-cat-table__td--right">
                    <div className="pv-cat-row-actions">
                      <Button variant="ghost" size="sm" onClick={() => onToggle(b)}>{b.active ? "Désact." : "Activer"}</Button>
                      <Button variant="ghost" size="sm" onClick={() => onEdit(b)}>Modifier</Button>
                    </div>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
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
      panelClassName="qc-modal-panel"
      bodyClassName="qc-modal-shell-body"
      title={panel ? "Modifier le panneau" : "Ajouter un panneau"}
      subtitle="Référence catalogue — champs structurés par bloc."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" form={PV_PANEL_FORM_ID}>
            Enregistrer
          </Button>
        </>
      }
    >
      {saveError ? <div style={alertErrorStyle} role="alert">{saveError}</div> : null}
      <form id={PV_PANEL_FORM_ID} className="qc-modal-form" onSubmit={handleSubmit}>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Identité</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Marque *"><input type="text" value={form.brand ?? ""} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="qc-modal-input" required readOnly={!!panel} /></Field>
            <Field label="Modèle / Réf *"><input type="text" value={form.model_ref ?? ""} onChange={(e) => setForm({ ...form, model_ref: e.target.value })} className="qc-modal-input" required readOnly={!!panel} /></Field>
            <div className="qc-modal-field-span-2">
              <Field label="Nom affiché"><input type="text" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="qc-modal-input" placeholder="ex: LONGi 485W" /></Field>
            </div>
          </div>
          {panel ? (
            <p className="pv-eco-hint" style={{ marginTop: 12 }}>
              La référence technique n&apos;est pas modifiable. Dupliquez le produit pour créer une nouvelle référence.
            </p>
          ) : null}
        </div>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Performance</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Technologie"><input type="text" value={form.technology ?? ""} onChange={(e) => setForm({ ...form, technology: e.target.value })} className="qc-modal-input" placeholder="PERC, TOPCon, HJT" /></Field>
            <Field label="Bifacial"><label className="pv-cat-check"><input type="checkbox" checked={form.bifacial ?? false} onChange={(e) => setForm({ ...form, bifacial: e.target.checked })} /> Oui</label></Field>
            <Field label="Puissance (Wc) *"><input type="number" value={form.power_wc ?? ""} onChange={(e) => setForm({ ...form, power_wc: Number(e.target.value) || 0 })} className="qc-modal-input" required /></Field>
            <Field label="Rendement (%) *"><input type="number" step={0.01} value={form.efficiency_pct ?? ""} onChange={(e) => setForm({ ...form, efficiency_pct: Number(e.target.value) || 0 })} className="qc-modal-input" required /></Field>
            <Field label="Coeff. temp (°C)"><input type="number" step={0.001} value={form.temp_coeff_pct_per_deg ?? ""} onChange={(e) => setForm({ ...form, temp_coeff_pct_per_deg: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Dégrad. an 1 (%)"><input type="number" step={0.01} value={form.degradation_first_year_pct ?? ""} onChange={(e) => setForm({ ...form, degradation_first_year_pct: Number(e.target.value) || 1 })} className="qc-modal-input" /></Field>
            <Field label="Dégrad. annuelle (%)"><input type="number" step={0.01} value={form.degradation_annual_pct ?? ""} onChange={(e) => setForm({ ...form, degradation_annual_pct: Number(e.target.value) || 0.4 })} className="qc-modal-input" /></Field>
          </div>
        </div>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Électrique (STC)</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Voc (V)"><input type="number" step={0.01} value={form.voc_v ?? ""} onChange={(e) => setForm({ ...form, voc_v: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Isc (A)"><input type="number" step={0.01} value={form.isc_a ?? ""} onChange={(e) => setForm({ ...form, isc_a: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Vmp (V)"><input type="number" step={0.01} value={form.vmp_v ?? ""} onChange={(e) => setForm({ ...form, vmp_v: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Imp (A)"><input type="number" step={0.01} value={form.imp_a ?? ""} onChange={(e) => setForm({ ...form, imp_a: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
          </div>
        </div>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Gabarit &amp; garanties</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Largeur (mm) *"><input type="number" value={form.width_mm ?? ""} onChange={(e) => setForm({ ...form, width_mm: Number(e.target.value) || 0 })} className="qc-modal-input" required /></Field>
            <Field label="Hauteur (mm) *"><input type="number" value={form.height_mm ?? ""} onChange={(e) => setForm({ ...form, height_mm: Number(e.target.value) || 0 })} className="qc-modal-input" required /></Field>
            <Field label="Épaisseur (mm)"><input type="number" value={form.thickness_mm ?? ""} onChange={(e) => setForm({ ...form, thickness_mm: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Poids (kg)"><input type="number" step={0.01} value={form.weight_kg ?? ""} onChange={(e) => setForm({ ...form, weight_kg: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Garantie produit (ans)"><input type="number" value={form.warranty_product_years ?? ""} onChange={(e) => setForm({ ...form, warranty_product_years: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Garantie perf. (ans)"><input type="number" value={form.warranty_performance_years ?? ""} onChange={(e) => setForm({ ...form, warranty_performance_years: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Actif"><label className="pv-cat-check"><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Catalogue actif</label></Field>
          </div>
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
      panelClassName="qc-modal-panel"
      bodyClassName="qc-modal-shell-body"
      title={inverter ? "Modifier l'onduleur" : "Ajouter un onduleur"}
      subtitle="Famille centrale ou micro — champs MPPT uniquement pour le central."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" form={PV_INVERTER_FORM_ID}>
            Enregistrer
          </Button>
        </>
      }
    >
      {saveError ? <div style={alertErrorStyle} role="alert">{saveError}</div> : null}
      <form id={PV_INVERTER_FORM_ID} className="qc-modal-form" onSubmit={handleSubmit}>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Identité</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Marque *"><input type="text" value={form.brand ?? ""} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="qc-modal-input" required /></Field>
            <Field label="Modèle / Réf *"><input type="text" value={form.model_ref ?? ""} onChange={(e) => setForm({ ...form, model_ref: e.target.value })} className="qc-modal-input" required /></Field>
            <div className="qc-modal-field-span-2">
              <Field label="Nom affiché"><input type="text" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="qc-modal-input" /></Field>
            </div>
            <Field label="Famille *"><select value={form.inverter_family ?? "CENTRAL"} onChange={(e) => setForm({ ...form, inverter_family: e.target.value as "CENTRAL" | "MICRO" })} className="qc-modal-input" required><option value="CENTRAL">CENTRAL</option><option value="MICRO">MICRO</option></select></Field>
            <Field label="Type *"><select value={form.inverter_type ?? "micro"} onChange={(e) => setForm({ ...form, inverter_type: e.target.value as "micro" | "string" })} className="qc-modal-input"><option value="micro">Micro</option><option value="string">String</option></select></Field>
          </div>
        </div>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Puissance &amp; alimentation</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            {form.inverter_type === "micro" ? (
              <>
                <Field label="Nominal VA *"><input type="number" value={form.nominal_va ?? ""} onChange={(e) => setForm({ ...form, nominal_va: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
                <Field label="Modules par onduleur *"><input type="number" value={form.modules_per_inverter ?? ""} onChange={(e) => setForm({ ...form, modules_per_inverter: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" min={1} /></Field>
              </>
            ) : (
              <div className="qc-modal-field-span-2">
                <Field label="Puissance nominale (kW)"><input type="number" step={0.01} value={form.nominal_power_kw ?? ""} onChange={(e) => setForm({ ...form, nominal_power_kw: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
              </div>
            )}
            <Field label="Phases"><select value={form.phases ?? ""} onChange={(e) => setForm({ ...form, phases: e.target.value || undefined })} className="qc-modal-input"><option value="">—</option><option value="1P">1P</option><option value="3P">3P</option></select></Field>
          </div>
          <p className="pv-eco-hint" style={{ marginTop: 12 }}>
            {family === "MICRO"
              ? "Les paramètres MPPT ne s'appliquent pas aux micro-onduleurs."
              : "Les paramètres MPPT sont requis pour le dimensionnement des strings."}
          </p>
        </div>
        {family === "CENTRAL" ? (
          <div className="qc-modal-section">
            <h3 className="qc-modal-section__title">MPPT &amp; rendement</h3>
            <div className="qc-modal-field-grid qc-modal-field-grid--2">
              <Field label="MPPT count"><input type="number" value={form.mppt_count ?? ""} onChange={(e) => setForm({ ...form, mppt_count: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
              <Field label="Inputs/MPPT"><input type="number" value={form.inputs_per_mppt ?? ""} onChange={(e) => setForm({ ...form, inputs_per_mppt: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
              <Field label="MPPT min V"><input type="number" step={0.01} value={form.mppt_min_v ?? ""} onChange={(e) => setForm({ ...form, mppt_min_v: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
              <Field label="MPPT max V"><input type="number" step={0.01} value={form.mppt_max_v ?? ""} onChange={(e) => setForm({ ...form, mppt_max_v: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
              <Field label="Euro efficiency (%)"><input type="number" step={0.01} value={form.euro_efficiency_pct ?? ""} onChange={(e) => setForm({ ...form, euro_efficiency_pct: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            </div>
          </div>
        ) : null}
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Limites DC &amp; options</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Max input current (A)"><input type="number" step={0.01} value={form.max_input_current_a ?? ""} onChange={(e) => setForm({ ...form, max_input_current_a: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Max DC power (kW)"><input type="number" step={0.01} value={form.max_dc_power_kw ?? ""} onChange={(e) => setForm({ ...form, max_dc_power_kw: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Compatible batterie"><label className="pv-cat-check"><input type="checkbox" checked={form.compatible_battery ?? false} onChange={(e) => setForm({ ...form, compatible_battery: e.target.checked })} /> Oui</label></Field>
            <Field label="Actif"><label className="pv-cat-check"><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Catalogue actif</label></Field>
          </div>
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
      panelClassName="qc-modal-panel"
      bodyClassName="qc-modal-shell-body"
      title={battery ? "Modifier la batterie" : "Ajouter une batterie"}
      subtitle="Prix catalogue, capacité utile et limites de puissance."
      footer={
        <>
          <Button type="button" variant="secondary" onClick={onClose}>
            Annuler
          </Button>
          <Button type="submit" variant="primary" form={PV_BATTERY_FORM_ID}>
            Enregistrer
          </Button>
        </>
      }
    >
      {saveError ? <div style={alertErrorStyle} role="alert">{saveError}</div> : null}
      <form id={PV_BATTERY_FORM_ID} className="qc-modal-form" onSubmit={handleSubmit}>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Identité</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Marque *"><input type="text" value={form.brand ?? ""} onChange={(e) => setForm({ ...form, brand: e.target.value })} className="qc-modal-input" required /></Field>
            <Field label="Modèle / Réf *"><input type="text" value={form.model_ref ?? ""} onChange={(e) => setForm({ ...form, model_ref: e.target.value })} className="qc-modal-input" required /></Field>
            <div className="qc-modal-field-span-2">
              <Field label="Nom affiché"><input type="text" value={form.name ?? ""} onChange={(e) => setForm({ ...form, name: e.target.value })} className="qc-modal-input" /></Field>
            </div>
          </div>
        </div>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Prix &amp; capacité</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Prix catalogue HT (€)"><input type="number" min={0} step={0.01} value={form.default_price_ht ?? ""} onChange={(e) => setForm({ ...form, default_price_ht: e.target.value === "" ? undefined : Number(e.target.value) })} className="qc-modal-input" placeholder="—" /></Field>
            <Field label="Prix d&apos;achat HT (€)" sublabel="Optionnel — marge interne">
              <input
                type="number"
                min={0}
                step={0.01}
                value={form.purchase_price_ht ?? ""}
                onChange={(e) =>
                  setForm({ ...form, purchase_price_ht: e.target.value === "" ? undefined : Number(e.target.value) })
                }
                className="qc-modal-input"
                placeholder="—"
              />
            </Field>
            <div className="qc-modal-field-span-2">
              <Field label="Capacité utilisable (kWh) *"><input type="number" step={0.01} value={form.usable_kwh ?? ""} onChange={(e) => setForm({ ...form, usable_kwh: Number(e.target.value) || 0 })} className="qc-modal-input" required /></Field>
            </div>
          </div>
        </div>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Électrique</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Tension nominale (V)"><input type="number" step={0.01} value={form.nominal_voltage_v ?? ""} onChange={(e) => setForm({ ...form, nominal_voltage_v: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Chimie"><input type="text" value={form.chemistry ?? ""} onChange={(e) => setForm({ ...form, chemistry: e.target.value })} className="qc-modal-input" placeholder="LFP" /></Field>
            <Field label="Charge max (kW)"><input type="number" step={0.01} value={form.max_charge_kw ?? ""} onChange={(e) => setForm({ ...form, max_charge_kw: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Décharge max (kW)"><input type="number" step={0.01} value={form.max_discharge_kw ?? ""} onChange={(e) => setForm({ ...form, max_discharge_kw: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Rendement (%)"><input type="number" step={0.01} value={form.roundtrip_efficiency_pct ?? ""} onChange={(e) => setForm({ ...form, roundtrip_efficiency_pct: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="DoD (%)"><input type="number" step={0.01} value={form.depth_of_discharge_pct ?? ""} onChange={(e) => setForm({ ...form, depth_of_discharge_pct: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Cycles"><input type="number" value={form.cycle_life ?? ""} onChange={(e) => setForm({ ...form, cycle_life: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
          </div>
        </div>
        <div className="qc-modal-section">
          <h3 className="qc-modal-section__title">Modularité &amp; statut</h3>
          <div className="qc-modal-field-grid qc-modal-field-grid--2">
            <Field label="Scalable"><label className="pv-cat-check"><input type="checkbox" checked={form.scalable ?? false} onChange={(e) => setForm({ ...form, scalable: e.target.checked })} /> Oui</label></Field>
            <Field label="Max modules"><input type="number" value={form.max_modules ?? ""} onChange={(e) => setForm({ ...form, max_modules: e.target.value ? Number(e.target.value) : undefined })} className="qc-modal-input" /></Field>
            <Field label="Actif"><label className="pv-cat-check"><input type="checkbox" checked={form.active !== false} onChange={(e) => setForm({ ...form, active: e.target.checked })} /> Catalogue actif</label></Field>
          </div>
        </div>
      </form>
    </ModalShell>
  );
}
