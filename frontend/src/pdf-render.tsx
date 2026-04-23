/**
 * PDF V2 — Entrée Vite pour le renderer PDF.
 * Monte StudySnapshotPdfPage directement (pas LegacyPdfTemplate, pas smartpitch HTML).
 * studyId et versionId lus depuis les query params (?studyId=...&versionId=...).
 * Appelle GET /api/studies/:studyId/versions/:versionId/pdf-view-model.
 * URL : /pdf-render.html?studyId=...&versionId=... (fichier d’entrée : pdf-render.html)
 */

import React from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import StudySnapshotPdfPage from "./pages/pdf/StudySnapshotPdfPage";
import FinancialInvoicePdfPage from "./pages/pdf/FinancialInvoicePdfPage";

/** Devis financier : renderer dédié /financial-quote-pdf-render (pas ce bundle). */

function PdfRenderRoot() {
  if (typeof window !== "undefined") {
    const q = new URLSearchParams(window.location.search);
    if (q.get("financialInvoiceId")) {
      return <FinancialInvoicePdfPage />;
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
