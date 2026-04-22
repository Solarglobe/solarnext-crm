/**
 * CP-REFAC-004.1 — Catalogue devis (lignes matériel / StudyQuoteBuilder)
 * + modèles de texte (notes, technique, paiement).
 */

import React, { useState } from "react";
import { SaasTabs } from "../../components/ui/SaasTabs";
import { AdminTabQuoteCatalog } from "../../modules/admin/AdminTabQuoteCatalog";
import { AdminTabQuoteTextTemplates } from "../../modules/admin/AdminTabQuoteTextTemplates";
import { AdminTabQuoteDocument } from "../../modules/admin/AdminTabQuoteDocument";
import "../../modules/admin/admin-tab-quote-catalog.css";
import "../../modules/admin/admin-org-structure-visual.css";
import "../../modules/finance/financial-pole.css";

type CatalogTab = "lines" | "text-templates" | "document-pdf";

const CATALOG_TABS: { id: CatalogTab; label: string }[] = [
  { id: "lines", label: "Lignes catalogue" },
  { id: "text-templates", label: "Modèles de texte" },
  { id: "document-pdf", label: "Document PDF" },
];

export default function OrganizationCatalogPage() {
  const [tab, setTab] = useState<CatalogTab>("lines");

  return (
    <div className="qb-page fin-pole-shell sn-saas-page">
      <header className="fin-pole-list-hero sn-saas-hero">
        <div className="fin-pole-list-hero__text">
          <h1 className="sg-title">Catalogue devis</h1>
          <p className="fin-pole-lead">Articles et modèles de texte utilisés pour les devis commerciaux.</p>
        </div>
      </header>

      <SaasTabs<CatalogTab>
        items={CATALOG_TABS}
        activeId={tab}
        onChange={setTab}
        ariaLabel="Sections catalogue devis"
        tabIdPrefix="catalog-page-tab"
        panelId="catalog-page-panel"
        className="org-structure-tabs-segmented"
      />

      <div className="sn-saas-surface org-structure-panel">
        <div
          role="tabpanel"
          id="catalog-page-panel"
          aria-labelledby={`catalog-page-tab-${tab}`}
        >
          {tab === "lines" ? (
            <AdminTabQuoteCatalog />
          ) : tab === "text-templates" ? (
            <AdminTabQuoteTextTemplates />
          ) : (
            <AdminTabQuoteDocument />
          )}
        </div>
      </div>
    </div>
  );
}
