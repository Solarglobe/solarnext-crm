/**
 * PDF V2 — Entrée Vite pour le renderer PDF.
 * Monte StudySnapshotPdfPage directement (pas LegacyPdfTemplate, pas smartpitch HTML).
 * studyId et versionId lus depuis les query params (?studyId=...&versionId=...).
 * Appelle GET /api/studies/:studyId/versions/:versionId/pdf-view-model.
 * URL : /pdf-render.html?studyId=...&versionId=... (fichier d’entrée : pdf-render.html)
 */

import React, { Suspense, lazy } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import StudySnapshotPdfPage from "./pages/pdf/StudySnapshotPdfPage";

/** Facture : lazy-load pour ne jamais importer financial-invoice-pdf.css sur le renderer étude. */
const FinancialInvoicePdfPage = lazy(() => import("./pages/pdf/FinancialInvoicePdfPage"));

/** Devis financier : renderer dédié /financial-quote-pdf-render (pas ce bundle). */

function PdfRenderRoot() {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search);
    if (q.get("financialInvoiceId")) {
      return (
        <Suspense
          fallback={
            <div id="pdf-loading" style={{ padding: "2rem", textAlign: "center" }}>
              Chargement du document...
            </div>
          }
        >
          <FinancialInvoicePdfPage />
        </Suspense>
      );
    }
  }
  return <StudySnapshotPdfPage />;
}

const container = document.getElementById("pdf-app");
if (container) {
  const root = createRoot(container);
  root.render(
    <React.StrictMode>
      <BrowserRouter future={{ v7_startTransition: true }}>
        <PdfRenderRoot />
      </BrowserRouter>
    </React.StrictMode>
  );
}
