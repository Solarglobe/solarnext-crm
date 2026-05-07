/**
 * CP-QUOTE-003 — Tab Catalogue devis
 * Phase 2 premium : org-tab-hero header, search avec icône, chips catégorie,
 * hover-reveal actions, modal XL avec sections iconifiées.
 */

import React, { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button";
import { ModalShell } from "../../components/ui/ModalShell";
import { ConfirmModal } from "../../components/ui/ConfirmModal";
import {
  adminGetQuoteCatalog,
  adminCreateQuoteCatalogItem,
  adminPatchQuoteCatalogItem,
  adminDeactivateQuoteCatalogItem,
  adminActivateQuoteCatalogItem,
  type QuoteCatalogItem,
  type QuoteCatalogCategory,
  type QuoteCatalogPricingMode,
  QUOTE_CATALOG_DESCRIPTION_MAX_CHARS,
} from "../../services/admin.api";
import { generateDuplicateName, sanitizeDuplicateQuoteCatalogFinancials } from "./quoteCatalogDuplicate";

import "./admin-tab-quote-catalog.css";

function showCatalogToast(message: string, type: "success" | "error" = "success") {
  const toast = document.createElement("div");
  toast.className = `planning-toast planning-toast-${type}`;
  toast.textContent = message;
  toast.setAttribute("role", "alert");
  toast.style.cssText =
    "position:fixed;bottom:24px;right:24px;z-index:99999;padding:12px 16px;border-radius:8px;font-size:14px;max-width:min(420px,calc(100vw - 48px));box-shadow:0 8px 24px rgba(0,0,0,.15);";
  document.body.appendChild(toast);
  setTimeout(() => toast.remove(), 3200);
}

const CATEGORY_LABELS: Record<QuoteCatalogCategory, string> = {
  PANEL: "Panneau",
  INVERTER: "Onduleur",
  MOUNTING: "Fixation",
  CABLE: "Câble",
  PROTECTION_BOX: "Coffret protection",
  INSTALL: "Pose",
  SERVICE: "Service",
  BATTERY_PHYSICAL: "Batterie physique",
  BATTERY_VIRTUAL: "Batterie virtuelle",
  PACK: "Pack",
  DISCOUNT: "Remise",
  OTHER: "Autre",
};

const PRICING_LABELS: Record<QuoteCatalogPricingMode, string> = {
  FIXED: "Forfait",
  UNIT: "Unitaire",
  PERCENT_TOTAL: "% du total",
};

const CATEGORIES: QuoteCatalogCategory[] = [
  "PANEL",
  "INVERTER",
  "MOUNTING",
  "CABLE",
  "PROTECTION_BOX",
  "INSTALL",
  "SERVICE",
  "BATTERY_PHYSICAL",
  "BATTERY_VIRTUAL",
  "PACK",
  "DISCOUNT",
  "OTHER",
];

const PRICING_MODES: QuoteCatalogPricingMode[] = ["FIXED", "UNIT", "PERCENT_TOTAL"];

// ─── Icons ─────────────────────────────────────────────────────────────────

function IconList() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <line x1="8" y1="6" x2="21" y2="6"/>
      <line x1="8" y1="12" x2="21" y2="12"/>
      <line x1="8" y1="18" x2="21" y2="18"/>
      <line x1="3" y1="6" x2="3.01" y2="6"/>
      <line x1="3" y1="12" x2="3.01" y2="12"/>
      <line x1="3" y1="18" x2="3.01" y2="18"/>
    </svg>
  );
}

function IconSearch() {
  return (
    <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="11" cy="11" r="8"/>
      <path d="m21 21-4.35-4.35"/>
    </svg>
  );
}

function IconPackage() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/>
      <polyline points="3.27 6.96 12 12.01 20.73 6.96"/>
      <line x1="12" y1="22.08" x2="12" y2="12"/>
    </svg>
  );
}

function IconPriceTag() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <path d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"/>
      <line x1="7" y1="7" x2="7.01" y2="7"/>
    </svg>
  );
}

function IconTrendingUp() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/>
      <polyline points="17 6 23 6 23 12"/>
    </svg>
  );
}

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconToggleOn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="1" y="5" width="22" height="14" rx="7"/>
      <circle cx="16" cy="12" r="3"/>
    </svg>
  );
}

function IconToggleOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="1" y="5" width="22" height="14" rx="7"/>
      <circle cx="8" cy="12" r="3"/>
    </svg>
  );
}

function IconCopy() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <rect x="9" y="9" width="13" height="13" rx="2" ry="2" />
      <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1" />
    </svg>
  );
}

// ─── Skeleton ───────────────────────────────────────────────────────────────

function SkeletonLines({ count = 5 }: { count?: number }) {
  return (
    <div className="admin-catalog-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="admin-catalog-skeleton-line" style={{ width: i === 0 ? "60%" : i === 1 ? "90%" : "100%" }} />
      ))}
    </div>
  );
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function centsToEur(cents: number): string {
  return (cents / 100).toLocaleString("fr-FR", {
    style: "currency",
    currency: "EUR",
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

function marginEur(saleCents: number, purchaseCents: number): number {
  return (saleCents - purchaseCents) / 100;
}

function marginPct(saleCents: number, purchaseCents: number): number | null {
  if (saleCents <= 0) return null;
  return ((saleCents - purchaseCents) / saleCents) * 100;
}

function marginLevel(pct: number | null): "low" | "mid" | "good" {
  if (pct == null) return "mid";
  if (pct < 15) return "low";
  if (pct < 25) return "mid";
  return "good";
}

function marginSnBadgeClass(level: "low" | "mid" | "good"): string {
  if (level === "good") return "sn-badge-success";
  if (level === "mid") return "sn-badge-neutral";
  return "sn-badge-warn";
}

// ─── Component ──────────────────────────────────────────────────────────────

export function AdminTabQuoteCatalog() {
  const [items, setItems] = useState<QuoteCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [includeInactive, setIncludeInactive] = useState(false);
  const [searchQ, setSearchQ] = useState("");
  const [filterCategory, setFilterCategory] = useState<string>("");
  const [modalOpen, setModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<QuoteCatalogItem | null>(null);
  const [confirmItem, setConfirmItem] = useState<{ item: QuoteCatalogItem; action: "deactivate" | "activate" } | null>(null);
  const [confirmSubmitting, setConfirmSubmitting] = useState(false);
  const [formName, setFormName] = useState("");
  const [formDescription, setFormDescription] = useState("");
  const [formCategory, setFormCategory] = useState<QuoteCatalogCategory>("PANEL");
  const [formPricingMode, setFormPricingMode] = useState<QuoteCatalogPricingMode>("FIXED");
  const [formSaleCents, setFormSaleCents] = useState<number>(0);
  const [formPurchaseCents, setFormPurchaseCents] = useState<number>(0);
  const [formVatPercent, setFormVatPercent] = useState<number>(20);
  const [quitConfirmOpen, setQuitConfirmOpen] = useState(false);
  const formInitialRef = useRef<string>("");
  const catalogNameInputRef = useRef<HTMLInputElement>(null);
  const focusCatalogNameOnOpenRef = useRef(false);

  const getFormSnapshot = useCallback(() =>
    JSON.stringify({
      name: formName,
      description: formDescription,
      category: formCategory,
      pricingMode: formPricingMode,
      saleCents: formSaleCents,
      purchaseCents: formPurchaseCents,
      vatPercent: formVatPercent,
    }), [formName, formDescription, formCategory, formPricingMode, formSaleCents, formPurchaseCents, formVatPercent]);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const { items: list } = await adminGetQuoteCatalog({
        include_inactive: includeInactive,
        q: searchQ.trim() || undefined,
        category: filterCategory || undefined,
      });
      setItems(list);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur chargement");
    } finally {
      setLoading(false);
    }
  }, [includeInactive, searchQ, filterCategory]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    if (!modalOpen || !focusCatalogNameOnOpenRef.current) return;
    focusCatalogNameOnOpenRef.current = false;
    const id = requestAnimationFrame(() => catalogNameInputRef.current?.focus());
    return () => cancelAnimationFrame(id);
  }, [modalOpen]);

  const openCreate = () => {
    focusCatalogNameOnOpenRef.current = false;
    setEditingItem(null);
    setFormName("");
    setFormDescription("");
    setFormCategory("PANEL");
    setFormPricingMode("FIXED");
    setFormSaleCents(0);
    setFormPurchaseCents(0);
    setFormVatPercent(20);
    setQuitConfirmOpen(false);
    formInitialRef.current = JSON.stringify({
      name: "", description: "", category: "PANEL", pricingMode: "FIXED",
      saleCents: 0, purchaseCents: 0, vatPercent: 20,
    });
    setModalOpen(true);
  };

  const openCatalogItemModalCreateFromDraft = (
    draft: Pick<
      QuoteCatalogItem,
      | "name"
      | "description"
      | "category"
      | "pricing_mode"
      | "sale_price_ht_cents"
      | "purchase_price_ht_cents"
      | "default_vat_rate_bps"
    >,
  ) => {
    setEditingItem(null);
    setFormName(draft.name);
    setFormDescription(draft.description ?? "");
    setFormCategory(draft.category);
    setFormPricingMode(draft.pricing_mode);
    setFormSaleCents(draft.sale_price_ht_cents);
    setFormPurchaseCents(draft.purchase_price_ht_cents);
    setFormVatPercent(draft.default_vat_rate_bps / 100);
    setQuitConfirmOpen(false);
    formInitialRef.current = JSON.stringify({
      name: draft.name,
      description: draft.description ?? "",
      category: draft.category,
      pricingMode: draft.pricing_mode,
      saleCents: draft.sale_price_ht_cents,
      purchaseCents: draft.purchase_price_ht_cents,
      vatPercent: draft.default_vat_rate_bps / 100,
    });
    focusCatalogNameOnOpenRef.current = true;
    setModalOpen(true);
  };

  const handleDuplicateItem = useCallback(
    (item: QuoteCatalogItem) => {
      if (item.category === "DISCOUNT") {
        showCatalogToast(
          "Les lignes « Remise » ne peuvent pas être dupliquées (risque de cumul ou d'erreur sur les montants). Créez une nouvelle remise manuellement.",
          "error",
        );
        return;
      }
      const c = structuredClone(item);
      const existingNames = items.map((i) => i.name);
      const draft = {
        name: generateDuplicateName(item.name, existingNames),
        description: c.description,
        category: c.category,
        pricing_mode: c.pricing_mode,
        sale_price_ht_cents: c.sale_price_ht_cents,
        purchase_price_ht_cents: c.purchase_price_ht_cents,
        default_vat_rate_bps: c.default_vat_rate_bps,
      };
      sanitizeDuplicateQuoteCatalogFinancials(draft, PRICING_MODES);
      openCatalogItemModalCreateFromDraft(draft);
      showCatalogToast("Ligne dupliquée, vous pouvez l'ajuster");
    },
    [items],
  );

  const openEdit = (item: QuoteCatalogItem) => {
    focusCatalogNameOnOpenRef.current = false;
    setEditingItem(item);
    setFormName(item.name);
    setFormDescription(item.description ?? "");
    setFormCategory(item.category);
    setFormPricingMode(item.pricing_mode);
    setFormSaleCents(item.sale_price_ht_cents);
    setFormPurchaseCents(item.purchase_price_ht_cents);
    setFormVatPercent(item.default_vat_rate_bps / 100);
    setQuitConfirmOpen(false);
    formInitialRef.current = JSON.stringify({
      name: item.name,
      description: item.description ?? "",
      category: item.category,
      pricingMode: item.pricing_mode,
      saleCents: item.sale_price_ht_cents,
      purchaseCents: item.purchase_price_ht_cents,
      vatPercent: item.default_vat_rate_bps / 100,
    });
    setModalOpen(true);
  };

  const requestClose = useCallback(() => {
    if (formInitialRef.current !== getFormSnapshot()) {
      setQuitConfirmOpen(true);
    } else {
      setModalOpen(false);
    }
  }, [getFormSnapshot]);

  const confirmQuit = useCallback(() => {
    setQuitConfirmOpen(false);
    focusCatalogNameOnOpenRef.current = false;
    setModalOpen(false);
  }, []);

  const handleModalEscape = useCallback(() => {
    if (quitConfirmOpen) setQuitConfirmOpen(false);
    else requestClose();
  }, [quitConfirmOpen, requestClose]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const name = formName.trim();
    if (name.length < 2) {
      setError("Le nom doit faire au moins 2 caractères");
      return;
    }
    const vatPercent = formVatPercent;
    if (typeof vatPercent !== "number" || Number.isNaN(vatPercent) || vatPercent < 0 || vatPercent > 300) {
      setError("TVA invalide (saisir un pourcentage entre 0 et 300)");
      return;
    }
    const vatBps = Math.round(vatPercent * 100);
    setError("");
    try {
      if (editingItem) {
        await adminPatchQuoteCatalogItem(editingItem.id, {
          name,
          description: formDescription.trim() || null,
          category: formCategory,
          pricing_mode: formPricingMode,
          sale_price_ht_cents: Math.round(formSaleCents),
          purchase_price_ht_cents: Math.round(formPurchaseCents),
          default_vat_rate_bps: vatBps,
        });
      } else {
        await adminCreateQuoteCatalogItem({
          name,
          description: formDescription.trim() || null,
          category: formCategory,
          pricing_mode: formPricingMode,
          sale_price_ht_cents: Math.round(formSaleCents),
          purchase_price_ht_cents: Math.round(formPurchaseCents),
          default_vat_rate_bps: vatBps,
        });
      }
      focusCatalogNameOnOpenRef.current = false;
      setModalOpen(false);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    }
  };

  const handleConfirmAction = async () => {
    if (!confirmItem) return;
    setConfirmSubmitting(true);
    setError("");
    try {
      if (confirmItem.action === "deactivate") {
        await adminDeactivateQuoteCatalogItem(confirmItem.item.id);
      } else {
        await adminActivateQuoteCatalogItem(confirmItem.item.id);
      }
      setConfirmItem(null);
      load();
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erreur");
    } finally {
      setConfirmSubmitting(false);
    }
  };

  const marginEurVal = marginEur(formSaleCents, formPurchaseCents);
  const marginPctVal = marginPct(formSaleCents, formPurchaseCents);

  if (loading) {
    return (
      <div className="admin-tab-quote-catalog org-structure-tab">
        <SkeletonLines count={8} />
      </div>
    );
  }

  const showEmpty = items.length === 0 && !error;

  return (
    <div className="admin-tab-quote-catalog org-structure-tab">

      {/* ── Header hero ── */}
      <header className="org-tab-hero">
        <div className="org-tab-hero__text">
          <h2 className="org-tab-hero__title">Lignes catalogue</h2>
          <p className="org-tab-hero__lead">
            Matériel, prestations et services : chaque ligne alimente le monteur de devis avec tarifs, TVA et indicateur de marge.
          </p>
          <span className="org-tab-hero__meta">
            {items.length} ligne{items.length !== 1 ? "s" : ""}
            {filterCategory ? ` · ${CATEGORY_LABELS[filterCategory as QuoteCatalogCategory]}` : ""}
            {includeInactive ? " · avec inactifs" : ""}
          </span>
        </div>
        <div className="org-tab-hero__actions">
          <Button variant="primary" size="md" type="button" onClick={openCreate}>
            Ajouter une ligne
          </Button>
        </div>
      </header>

      {error ? <p className="org-tab-alert">{error}</p> : null}

      {/* ── Toolbar : search + chips catégorie ── */}
      <div className="admin-catalog-toolbar-premium">
        <div className="org-tab-toolbar__search-wrap">
          <IconSearch />
          <input
            type="search"
            className="sn-input"
            placeholder="Rechercher par nom…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            aria-label="Rechercher par nom"
          />
        </div>

        <div className="admin-catalog-filter-chips" role="group" aria-label="Filtrer par catégorie">
          <button
            type="button"
            className={`admin-catalog-chip${filterCategory === "" ? " admin-catalog-chip--active" : ""}`}
            onClick={() => setFilterCategory("")}
          >
            Toutes
          </button>
          {CATEGORIES.map((c) => (
            <button
              key={c}
              type="button"
              className={`admin-catalog-chip${filterCategory === c ? " admin-catalog-chip--active" : ""}`}
              onClick={() => setFilterCategory(filterCategory === c ? "" : c)}
            >
              {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>

        <label className="admin-catalog-checkbox-wrap">
          <input
            type="checkbox"
            checked={includeInactive}
            onChange={(e) => setIncludeInactive(e.target.checked)}
            className="admin-catalog-checkbox"
          />
          <span>Inclure inactifs</span>
        </label>
      </div>

      {/* ── Contenu ── */}
      {showEmpty ? (
        <div className="org-tab-table-wrap">
          <div className="org-tab-empty-state">
            <div className="org-tab-empty-icon">
              <IconList />
            </div>
            <p className="org-tab-empty-title">Aucune ligne catalogue</p>
            <p className="org-tab-empty-lead">
              Ajoutez votre première ligne pour monter vos devis — matériel, prestation ou service.
            </p>
            <Button variant="primary" size="sm" type="button" onClick={openCreate}>
              Ajouter une ligne
            </Button>
          </div>
        </div>
      ) : (
        <div className="sn-saas-table-wrap admin-catalog-table-outer">
          <table className="sn-ui-table sn-saas-table sn-saas-table--dense admin-catalog-table">
            <thead>
              <tr>
                <th className="admin-catalog-col-nom">Nom</th>
                <th className="admin-catalog-th-muted admin-catalog-col-categorie">Catégorie</th>
                <th className="admin-catalog-th-muted admin-catalog-col-mode">Mode tarif</th>
                <th className="admin-catalog-th-right admin-catalog-col-prix">Prix vente HT</th>
                <th className="admin-catalog-th-right admin-catalog-col-prix">Prix achat HT</th>
                <th className="admin-catalog-th-right admin-catalog-col-marge">Marge</th>
                <th className="admin-catalog-th-right admin-catalog-th-muted admin-catalog-col-tva">TVA</th>
                <th className="admin-catalog-col-statut">Statut</th>
                <th className="admin-catalog-col-actions"></th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => {
                const mEur = marginEur(item.sale_price_ht_cents, item.purchase_price_ht_cents);
                const mPct = marginPct(item.sale_price_ht_cents, item.purchase_price_ht_cents);
                const level = marginLevel(mPct);
                return (
                  <tr
                    key={item.id}
                    className={item.is_active ? "" : "admin-catalog-row-inactive"}
                  >
                    <td className="admin-catalog-col-nom">
                      <span className="admin-catalog-cell-name" title={item.name}>
                        {item.name}
                      </span>
                    </td>
                    <td className="admin-catalog-col-categorie">
                      <span
                        className="admin-catalog-cell-secondary admin-catalog-cell-clip"
                        title={CATEGORY_LABELS[item.category]}
                      >
                        {CATEGORY_LABELS[item.category]}
                      </span>
                    </td>
                    <td className="admin-catalog-col-mode">
                      <span
                        className="admin-catalog-cell-secondary admin-catalog-cell-clip"
                        title={PRICING_LABELS[item.pricing_mode]}
                      >
                        {PRICING_LABELS[item.pricing_mode]}
                      </span>
                    </td>
                    <td className="admin-catalog-cell-right admin-catalog-cell-price admin-catalog-col-prix">
                      {centsToEur(item.sale_price_ht_cents)}
                    </td>
                    <td className="admin-catalog-cell-right admin-catalog-cell-price admin-catalog-col-prix">
                      {centsToEur(item.purchase_price_ht_cents)}
                    </td>
                    <td className="admin-catalog-cell-right admin-catalog-col-marge">
                      {mPct == null ? (
                        <span className="sn-badge sn-badge-neutral">—</span>
                      ) : (
                        <span className={`sn-badge ${marginSnBadgeClass(level)}`}>
                          {mPct.toFixed(1)}{" "}%
                        </span>
                      )}
                    </td>
                    <td className="admin-catalog-cell-right admin-catalog-cell-tva admin-catalog-col-tva">
                      {(item.default_vat_rate_bps / 100) % 1 === 0
                        ? <>{item.default_vat_rate_bps / 100}{" "}%</>
                        : <>{(item.default_vat_rate_bps / 100).toFixed(2)}{" "}%</>
                      }
                    </td>
                    <td className="admin-catalog-col-statut">
                      <span className={item.is_active ? "sn-badge sn-badge-success" : "sn-badge sn-badge-neutral"}>
                        {item.is_active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td className="admin-catalog-col-actions">
                      <div className="admin-catalog-actions org-tab-row-actions">
                        <button
                          type="button"
                          className="org-tab-icon-btn"
                          onClick={() => openEdit(item)}
                          aria-label="Modifier"
                          title="Modifier"
                        >
                          <IconEdit />
                        </button>
                        <button
                          type="button"
                          className="org-tab-icon-btn"
                          disabled={item.category === "DISCOUNT"}
                          title={
                            item.category === "DISCOUNT"
                              ? "Duplication désactivée pour les remises"
                              : "Dupliquer vers une nouvelle ligne"
                          }
                          onClick={() => handleDuplicateItem(item)}
                          aria-label="Dupliquer"
                        >
                          <IconCopy />
                        </button>
                        {item.is_active ? (
                          <button
                            type="button"
                            className="org-tab-icon-btn admin-catalog-toggle-btn--off"
                            onClick={() => setConfirmItem({ item, action: "deactivate" })}
                            aria-label="Désactiver"
                            title="Désactiver"
                          >
                            <IconToggleOff />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="org-tab-icon-btn admin-catalog-toggle-btn--on"
                            onClick={() => setConfirmItem({ item, action: "activate" })}
                            aria-label="Activer"
                            title="Activer"
                          >
                            <IconToggleOn />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {/* ── Modal création / édition ── */}
      <ModalShell
        open={modalOpen}
        onClose={requestClose}
        onEscape={handleModalEscape}
        closeOnBackdropClick
        size="xl"
        title={editingItem ? "Modifier la ligne" : "Nouvelle ligne catalogue"}
        subtitle={
          editingItem
            ? `Mettez à jour les informations de « ${editingItem.name} ».`
            : "Renseignez l'identité du produit, sa tarification, puis vérifiez la marge calculée."
        }
        panelClassName="admin-catalog-modal qc-modal-panel"
        bodyClassName="qc-modal-shell-body"
        footer={
          <>
            <Button variant="secondary" type="button" size="sm" onClick={requestClose}>
              Annuler
            </Button>
            <Button variant="primary" type="submit" size="sm" form="quote-catalog-form">
              {editingItem ? "Enregistrer" : "Créer la ligne"}
            </Button>
          </>
        }
      >
        <form id="quote-catalog-form" className="qc-modal-form" onSubmit={handleSubmit}>

          {/* Section Produit */}
          <section className="qc-modal-section" aria-labelledby="qc-sec-produit">
            <div className="qc-modal-section__header">
              <div className="qc-modal-section__icon">
                <IconPackage />
              </div>
              <div>
                <h3 id="qc-sec-produit" className="qc-modal-section__title">Produit</h3>
                <p className="qc-modal-section__desc">Identité, classification et description commerciale.</p>
              </div>
            </div>
            <div className="qc-modal-field-grid qc-modal-field-grid--2">
              <div className="qc-modal-field-span-2">
                <label className="qc-modal-label" htmlFor="qc-name">
                  Nom *
                </label>
                <input
                  ref={catalogNameInputRef}
                  id="qc-name"
                  type="text"
                  value={formName}
                  onChange={(e) => setFormName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={120}
                  className="qc-modal-input"
                  autoComplete="off"
                  placeholder="Ex. Panneau JA Solar 440 Wc"
                />
              </div>
              <div>
                <label className="qc-modal-label" htmlFor="qc-category">
                  Catégorie
                </label>
                <select
                  id="qc-category"
                  value={formCategory}
                  onChange={(e) => setFormCategory(e.target.value as QuoteCatalogCategory)}
                  className="qc-modal-input"
                >
                  {CATEGORIES.map((c) => (
                    <option key={c} value={c}>
                      {CATEGORY_LABELS[c]}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="qc-modal-label" htmlFor="qc-pricing">
                  Mode tarif
                </label>
                <select
                  id="qc-pricing"
                  value={formPricingMode}
                  onChange={(e) => setFormPricingMode(e.target.value as QuoteCatalogPricingMode)}
                  className="qc-modal-input"
                >
                  {PRICING_MODES.map((m) => (
                    <option key={m} value={m}>
                      {PRICING_LABELS[m]}
                    </option>
                  ))}
                </select>
              </div>
              <div className="qc-modal-field-span-2">
                <label className="qc-modal-label" htmlFor="qc-desc">
                  Description commerciale{" "}
                  <span className="qc-modal-label-optional">— optionnel</span>
                </label>
                <textarea
                  id="qc-desc"
                  value={formDescription}
                  onChange={(e) => setFormDescription(e.target.value)}
                  maxLength={QUOTE_CATALOG_DESCRIPTION_MAX_CHARS}
                  rows={3}
                  className="qc-modal-textarea"
                  placeholder="Détail affiché sur le devis et le PDF…"
                  aria-describedby="qc-desc-counter"
                />
                <p id="qc-desc-counter" className="qc-modal-desc-counter">
                  {formDescription.length} / {QUOTE_CATALOG_DESCRIPTION_MAX_CHARS}
                </p>
              </div>
            </div>
          </section>

          {/* Section Tarification */}
          <section className="qc-modal-section" aria-labelledby="qc-sec-tarif">
            <div className="qc-modal-section__header">
              <div className="qc-modal-section__icon">
                <IconPriceTag />
              </div>
              <div>
                <h3 id="qc-sec-tarif" className="qc-modal-section__title">Tarification</h3>
                <p className="qc-modal-section__desc">Prix de vente, d'achat et taux de TVA applicable.</p>
              </div>
            </div>
            <div className="qc-modal-field-grid qc-modal-field-grid--3">
              <div>
                <label className="qc-modal-label" htmlFor="qc-sale">
                  Vente HT (€)
                </label>
                <input
                  id="qc-sale"
                  type="number"
                  step={0.01}
                  value={formSaleCents / 100}
                  onChange={(e) => setFormSaleCents(Math.round(parseFloat(e.target.value || "0") * 100))}
                  className="qc-modal-input"
                  title="Valeur négative autorisée pour une remise (catégorie Remise)"
                />
              </div>
              <div>
                <label className="qc-modal-label" htmlFor="qc-purchase">
                  Achat HT (€)
                </label>
                <input
                  id="qc-purchase"
                  type="number"
                  step={0.01}
                  value={formPurchaseCents / 100}
                  onChange={(e) => setFormPurchaseCents(Math.round(parseFloat(e.target.value || "0") * 100))}
                  className="qc-modal-input"
                  title="Valeur négative autorisée si besoin métier"
                />
              </div>
              <div>
                <label className="qc-modal-label" htmlFor="qc-vat">
                  TVA (%)
                </label>
                <input
                  id="qc-vat"
                  type="number"
                  min={0}
                  max={300}
                  step={0.01}
                  value={formVatPercent}
                  onChange={(e) => setFormVatPercent(parseFloat(e.target.value) ?? 0)}
                  className="qc-modal-input"
                />
              </div>
            </div>
            {(formVatPercent < 0 || formVatPercent > 300) ? (
              <span className="qc-modal-field-error">TVA : 0 à 300</span>
            ) : null}
          </section>

          {/* Section Marge indicative */}
          <section className="qc-modal-section qc-modal-section--highlight" aria-labelledby="qc-sec-marge">
            <div className="qc-modal-section__header">
              <div className="qc-modal-section__icon qc-modal-section__icon--accent">
                <IconTrendingUp />
              </div>
              <div>
                <h3 id="qc-sec-marge" className="qc-modal-section__title">Marge indicative</h3>
                <p className="qc-modal-section__desc">Calculée automatiquement à partir des prix ci-dessus.</p>
              </div>
            </div>
            <div className="qc-modal-marge">
              <span className={`sn-badge ${marginSnBadgeClass(marginLevel(marginPctVal))}`}>
                {marginEurVal.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                <span className="qc-modal-marge-sep">|</span>
                {marginPctVal == null ? "—" : `${marginPctVal.toFixed(1)} %`}
              </span>
            </div>
          </section>

        </form>
      </ModalShell>

      <ConfirmModal
        open={quitConfirmOpen}
        title="Modifications non enregistrées"
        message="Des modifications non enregistrées seront perdues. Voulez-vous quitter ?"
        confirmLabel="Quitter"
        cancelLabel="Annuler"
        variant="warning"
        elevation="stacked"
        onCancel={() => setQuitConfirmOpen(false)}
        onConfirm={confirmQuit}
      />

      <ConfirmModal
        open={Boolean(confirmItem)}
        title={
          confirmItem?.action === "deactivate"
            ? "Désactiver cette ligne ?"
            : confirmItem
              ? "Activer cette ligne ?"
              : ""
        }
        message={
          confirmItem
            ? confirmItem.action === "deactivate"
              ? `« ${confirmItem.item.name} » restera en base mais ne sera plus proposé dans le catalogue.`
              : `« ${confirmItem.item.name} » sera à nouveau proposé dans le catalogue.`
            : ""
        }
        confirmLabel={
          confirmSubmitting
            ? "…"
            : confirmItem?.action === "deactivate"
              ? "Désactiver"
              : "Activer"
        }
        cancelLabel="Annuler"
        variant={confirmItem?.action === "deactivate" ? "danger" : "default"}
        elevation={modalOpen ? "stacked" : "base"}
        confirmDisabled={confirmSubmitting}
        cancelDisabled={confirmSubmitting}
        onCancel={() => !confirmSubmitting && setConfirmItem(null)}
        onConfirm={() => void handleConfirmAction()}
      />
    </div>
  );
}
