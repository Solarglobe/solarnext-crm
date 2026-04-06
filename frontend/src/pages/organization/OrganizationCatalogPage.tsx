/**
 * CP-REFAC-004.1 — Catalogue devis (lignes matériel / StudyQuoteBuilder)
 * + modèles de texte (notes, technique, paiement).
 */

import React, { useState } from "react";
import { Card } from "../../components/ui/Card";
import { AdminTabQuoteCatalog } from "../../modules/admin/AdminTabQuoteCatalog";
import { AdminTabQuoteTextTemplates } from "../../modules/admin/AdminTabQuoteTextTemplates";
import { AdminTabQuoteDocument } from "../../modules/admin/AdminTabQuoteDocument";
import "../../modules/admin/admin-tab-quote-catalog.css";

type CatalogTab = "lines" | "text-templates" | "document-pdf";

export default function OrganizationCatalogPage() {
  const [tab, setTab] = useState<CatalogTab>("lines");

  return (
    <div className="admin-page">
      <header className="admin-header" style={{ marginBottom: "var(--spacing-24)" }}>
        <h1 className="sg-title">Catalogue devis</h1>
        <p style={{ color: "var(--text-muted)", fontSize: "var(--font-size-body)", margin: "var(--spacing-8) 0 0", maxWidth: 720 }}>
          Articles et modèles de texte utilisés pour les devis commerciaux.
        </p>
      </header>

      <div
        className="admin-catalog-page-tabs"
        role="tablist"
        aria-label="Sections catalogue devis"
        style={{ marginBottom: "var(--spacing-16)" }}
      >
        <button
          type="button"
          role="tab"
          id="catalog-page-tab-lines"
          aria-selected={tab === "lines"}
          aria-controls="catalog-page-panel"
          className={`admin-catalog-page-tab${tab === "lines" ? " admin-catalog-page-tab--active" : ""}`}
          onClick={() => setTab("lines")}
        >
          Lignes catalogue
        </button>
        <button
          type="button"
          role="tab"
          id="catalog-page-tab-text-templates"
          aria-selected={tab === "text-templates"}
          aria-controls="catalog-page-panel"
          className={`admin-catalog-page-tab${tab === "text-templates" ? " admin-catalog-page-tab--active" : ""}`}
          onClick={() => setTab("text-templates")}
        >
          Modèles de texte
        </button>
        <button
          type="button"
          role="tab"
          id="catalog-page-tab-document-pdf"
          aria-selected={tab === "document-pdf"}
          aria-controls="catalog-page-panel"
          className={`admin-catalog-page-tab${tab === "document-pdf" ? " admin-catalog-page-tab--active" : ""}`}
          onClick={() => setTab("document-pdf")}
        >
          Document PDF
        </button>
      </div>

      <Card
        variant="premium"
        padding="lg"
        className="sn-card-premium admin-card"
        style={{
          background: "var(--surface-card)",
          border: "1px solid var(--border-soft)",
          borderRadius: "var(--radius-16)",
          backdropFilter: "blur(14px)",
        }}
      >
        <div
          role="tabpanel"
          id="catalog-page-panel"
          aria-labelledby={
            tab === "lines"
              ? "catalog-page-tab-lines"
              : tab === "text-templates"
                ? "catalog-page-tab-text-templates"
                : "catalog-page-tab-document-pdf"
          }
        >
          {tab === "lines" ? (
            <AdminTabQuoteCatalog />
          ) : tab === "text-templates" ? (
            <AdminTabQuoteTextTemplates />
          ) : (
            <AdminTabQuoteDocument />
          )}
        </div>
      </Card>
    </div>
  );
}
