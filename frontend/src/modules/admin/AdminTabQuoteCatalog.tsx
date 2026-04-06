/**
 * CP-QUOTE-003 — Tab Catalogue devis
 * Phase 1 professionnel : toolbar structurée, table lisible, marge colorée, icônes, modal confirmation.
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

import "./admin-tab-quote-catalog.css";

const CATEGORY_LABELS: Record<QuoteCatalogCategory, string> = {
  PANEL: "Panneau",
  INVERTER: "Onduleur",
  MOUNTING: "Fixation",
  CABLE: "Câble",
  PROTECTION_BOX: "Coffret de protection",
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

function IconEdit() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7" />
      <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z" />
    </svg>
  );
}

function IconToggleOn() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="5" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
    </svg>
  );
}

function IconToggleOff() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
      <circle cx="12" cy="12" r="10" />
      <path d="M12 2v4" />
      <path d="M12 18v4" />
      <path d="M2 12h4" />
      <path d="M18 12h4" />
    </svg>
  );
}

function SkeletonLines({ count = 5 }: { count?: number }) {
  return (
    <div className="admin-catalog-skeleton">
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="admin-catalog-skeleton-line" style={{ width: i === 0 ? "60%" : i === 1 ? "90%" : "100%" }} />
      ))}
    </div>
  );
}

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

  const openCreate = () => {
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

  const openEdit = (item: QuoteCatalogItem) => {
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
      <div className="admin-tab-quote-catalog">
        <SkeletonLines count={8} />
      </div>
    );
  }

  const showEmpty = items.length === 0 && !error;

  return (
    <div className="admin-tab-quote-catalog">
      {/* Toolbar structurée */}
      <div className="admin-catalog-toolbar">
        <div className="admin-catalog-toolbar-left">
          <input
            type="text"
            placeholder="Rechercher par nom…"
            value={searchQ}
            onChange={(e) => setSearchQ(e.target.value)}
            className="admin-catalog-input sn-input"
          />
          <select
            value={filterCategory}
            onChange={(e) => setFilterCategory(e.target.value)}
            className="admin-catalog-select sn-input"
          >
            <option value="">Toutes catégories</option>
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {CATEGORY_LABELS[c]}
              </option>
            ))}
          </select>
          <label className="admin-catalog-checkbox-wrap">
            <input
              type="checkbox"
              checked={includeInactive}
              onChange={(e) => setIncludeInactive(e.target.checked)}
              style={{ width: 18, height: 18 }}
            />
            <span>Inclure inactifs</span>
          </label>
        </div>
        <div className="admin-catalog-toolbar-right">
          <Button variant="primary" onClick={openCreate}>
            Nouveau panneau
          </Button>
        </div>
      </div>

      {error && (
        <p style={{ color: "var(--danger)", marginBottom: "var(--spacing-16)" }}>{error}</p>
      )}

      {showEmpty ? (
        <div className="admin-catalog-empty">
          <h3 className="admin-catalog-empty-title">Aucun panneau</h3>
          <p className="admin-catalog-empty-desc">
            Ajoutez votre premier panneau au catalogue pour monter vos devis.
          </p>
          <Button variant="primary" onClick={openCreate}>
            Nouveau panneau
          </Button>
        </div>
      ) : (
        <div className="admin-catalog-table-wrap">
          <table className="admin-catalog-table">
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
                <th className="admin-catalog-col-actions">Actions</th>
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
                      <span className={`admin-catalog-marge admin-catalog-marge--${level}`}>
                        {mPct == null ? "—" : (
                          <>
                            {mPct.toFixed(1)}
                            {"\u00a0"}%
                          </>
                        )}
                      </span>
                    </td>
                    <td className="admin-catalog-cell-right admin-catalog-cell-tva admin-catalog-col-tva">
                      {(item.default_vat_rate_bps / 100) % 1 === 0
                        ? (
                            <>
                              {item.default_vat_rate_bps / 100}
                              {"\u00a0"}%
                            </>
                          )
                        : (
                            <>
                              {(item.default_vat_rate_bps / 100).toFixed(2)}
                              {"\u00a0"}%
                            </>
                          )}
                    </td>
                    <td className="admin-catalog-col-statut">
                      <span
                        className={
                          item.is_active
                            ? "admin-catalog-badge admin-catalog-badge--active"
                            : "admin-catalog-badge admin-catalog-badge--inactive"
                        }
                      >
                        {item.is_active ? "Actif" : "Inactif"}
                      </span>
                    </td>
                    <td className="admin-catalog-col-actions">
                      <div className="admin-catalog-actions">
                        <button
                          type="button"
                          className="admin-catalog-icon-btn"
                          onClick={() => openEdit(item)}
                          aria-label="Modifier"
                          title="Modifier"
                        >
                          <IconEdit />
                        </button>
                        {item.is_active ? (
                          <button
                            type="button"
                            className="admin-catalog-icon-btn admin-catalog-icon-btn--warning"
                            onClick={() => setConfirmItem({ item, action: "deactivate" })}
                            aria-label="Désactiver"
                            title="Désactiver"
                          >
                            <IconToggleOff />
                          </button>
                        ) : (
                          <button
                            type="button"
                            className="admin-catalog-icon-btn admin-catalog-icon-btn--success"
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

      <ModalShell
        open={modalOpen}
        onClose={requestClose}
        onEscape={handleModalEscape}
        closeOnBackdropClick
        size="lg"
        title={editingItem ? "Modifier le panneau" : "Nouveau panneau"}
        subtitle={editingItem ? "Informations et tarifs" : "Nouvelle ligne catalogue"}
        panelClassName="admin-catalog-modal"
        footer={
          <>
            <Button variant="ghost" type="button" size="sm" onClick={requestClose}>
              Annuler
            </Button>
            <Button variant="primary" type="submit" size="sm" form="quote-catalog-form">
              {editingItem ? "Enregistrer" : "Créer"}
            </Button>
          </>
        }
      >
        <form id="quote-catalog-form" onSubmit={handleSubmit}>
              <div className="admin-catalog-modal-section">
                <h3 className="admin-catalog-modal-section-title">Produit</h3>
                <div className="admin-catalog-modal-fields">
                  <div className="admin-catalog-modal-field">
                    <label className="admin-catalog-field-label" htmlFor="qc-name">Nom *</label>
                    <input
                      id="qc-name"
                      type="text"
                      value={formName}
                      onChange={(e) => setFormName(e.target.value)}
                      required
                      minLength={2}
                      maxLength={120}
                      className="admin-catalog-modal-input"
                    />
                  </div>
                  <div className="admin-catalog-modal-field-row">
                    <div className="admin-catalog-modal-field">
                      <label className="admin-catalog-field-label">Catégorie</label>
                      <select
                        value={formCategory}
                        onChange={(e) => setFormCategory(e.target.value as QuoteCatalogCategory)}
                        className="admin-catalog-modal-input"
                      >
                        {CATEGORIES.map((c) => (
                          <option key={c} value={c}>
                            {CATEGORY_LABELS[c]}
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="admin-catalog-modal-field">
                      <label className="admin-catalog-field-label">Mode tarif</label>
                      <select
                        value={formPricingMode}
                        onChange={(e) => setFormPricingMode(e.target.value as QuoteCatalogPricingMode)}
                        className="admin-catalog-modal-input"
                      >
                        {PRICING_MODES.map((m) => (
                          <option key={m} value={m}>
                            {PRICING_LABELS[m]}
                          </option>
                        ))}
                      </select>
                    </div>
                  </div>
                  <div className="admin-catalog-modal-field admin-catalog-field-optional">
                    <label className="admin-catalog-field-label admin-catalog-field-label-optional" htmlFor="qc-desc">
                      Description (texte commercial, multi-lignes)
                    </label>
                    <textarea
                      id="qc-desc"
                      value={formDescription}
                      onChange={(e) => setFormDescription(e.target.value)}
                      maxLength={QUOTE_CATALOG_DESCRIPTION_MAX_CHARS}
                      rows={10}
                      className="admin-catalog-modal-input admin-catalog-modal-input-optional admin-catalog-modal-textarea"
                      placeholder="Optionnel — détail commercial affiché sur le devis et le PDF"
                      aria-describedby="qc-desc-counter"
                    />
                    <p id="qc-desc-counter" className="admin-catalog-desc-counter">
                      {formDescription.length} / {QUOTE_CATALOG_DESCRIPTION_MAX_CHARS}
                    </p>
                  </div>
                </div>
              </div>

              <div className="admin-catalog-modal-section">
                <h3 className="admin-catalog-modal-section-title">Prix</h3>
                <div className="admin-catalog-modal-fields">
                  <div className="admin-catalog-modal-field-row admin-catalog-modal-field-row--3">
                    <div className="admin-catalog-modal-field">
                      <label className="admin-catalog-field-label">Vente HT (€)</label>
                      <input
                        type="number"
                        step={0.01}
                        value={formSaleCents / 100}
                        onChange={(e) => setFormSaleCents(Math.round(parseFloat(e.target.value || "0") * 100))}
                        className="admin-catalog-modal-input"
                        title="Valeur négative autorisée pour une remise (catégorie Remise)"
                      />
                    </div>
                    <div className="admin-catalog-modal-field">
                      <label className="admin-catalog-field-label">Achat HT (€)</label>
                      <input
                        type="number"
                        step={0.01}
                        value={formPurchaseCents / 100}
                        onChange={(e) => setFormPurchaseCents(Math.round(parseFloat(e.target.value || "0") * 100))}
                        className="admin-catalog-modal-input"
                        title="Valeur négative autorisée si besoin métier"
                      />
                    </div>
                    <div className="admin-catalog-modal-field">
                      <label className="admin-catalog-field-label" htmlFor="qc-vat">TVA (%)</label>
                      <input
                        id="qc-vat"
                        type="number"
                        min={0}
                        max={300}
                        step={0.01}
                        value={formVatPercent}
                        onChange={(e) => setFormVatPercent(parseFloat(e.target.value) ?? 0)}
                        className="admin-catalog-modal-input"
                      />
                    </div>
                  </div>
                  {(formVatPercent < 0 || formVatPercent > 300) && (
                    <span className="admin-catalog-field-error">TVA : 0 à 300</span>
                  )}
                </div>
              </div>

              <div className="admin-catalog-modal-section">
                <h3 className="admin-catalog-modal-section-title">Résultat</h3>
                <div className="admin-catalog-modal-marge">
                  <span className={`admin-catalog-marge-value admin-catalog-marge--${marginLevel(marginPctVal)}`}>
                    {marginEurVal.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €
                    <span className="admin-catalog-marge-sep">|</span>
                    {marginPctVal == null ? "—" : `${marginPctVal.toFixed(1)} %`}
                  </span>
                </div>
              </div>

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
            ? "Désactiver ce panneau ?"
            : confirmItem
              ? "Activer ce panneau ?"
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
