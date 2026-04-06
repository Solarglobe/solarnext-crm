/**
 * Renderer PDF devis financier uniquement — isolé du pipeline étude / proposition commerciale.
 * Ne charge pas StudySnapshotPdfPage, pdf-unified, pdf-print, ni les moteurs P1–P12.
 *
 * URL : /financial-quote-pdf-render?financialQuoteId=...&renderToken=... [&quoteSigned=1]
 */

import "./pages/pdf/financial-quote-pdf-shell.css";
import React from "react";
import { createRoot } from "react-dom/client";
import FinancialQuotePdfPage from "./pages/pdf/FinancialQuotePdfPage";

const el = document.getElementById("financial-quote-pdf-app");
if (el) {
  createRoot(el).render(
    <React.StrictMode>
      <FinancialQuotePdfPage />
    </React.StrictMode>
  );
}
