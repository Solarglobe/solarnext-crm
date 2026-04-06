/**
 * CP-PDF-V2-019 — Routes internes (sans verifyJWT utilisateur)
 * Utilisées par le renderer Playwright avec renderToken.
 */

import express from "express";
import { getInternalPdfViewModel } from "../controllers/internalPdfViewModel.controller.js";
import * as pdfAsset from "../controllers/internalPdfAsset.controller.js";
import { getInternalFinancialQuotePdfPayload } from "../controllers/internalFinancialQuotePdf.controller.js";
import { getInternalQuoteSignaturePng } from "../controllers/internalQuoteSignature.controller.js";
import { getInternalFinancialInvoicePdfPayload } from "../controllers/internalFinancialInvoicePdf.controller.js";
import { getCalpinageRenderData } from "../controllers/internalCalpinageRender.controller.js";

const router = express.Router();

/**
 * GET /api/internal/calpinage-render-data/:studyId/:versionId?renderToken=...
 * Données geometry pour la page de rendu Playwright.
 */
router.get("/internal/calpinage-render-data/:studyId/:versionId", getCalpinageRenderData);

/**
 * GET /api/internal/pdf-view-model/:studyId/:versionId?renderToken=...
 * Route dédiée au renderer PDF Playwright.
 * Vérifie le renderToken, retourne le ViewModel identique à l'endpoint CRM.
 */
router.get(
  "/internal/pdf-view-model/:studyId/:versionId",
  getInternalPdfViewModel
);

/**
 * GET /api/internal/pdf-asset/:orgId/logo?renderToken=...&studyId=...&versionId=...
 * GET /api/internal/pdf-asset/:orgId/pdf-cover?renderToken=...&studyId=...&versionId=...
 * Sert logo et image couverture pour le PDF (Playwright).
 */
router.get("/internal/pdf-asset/:orgId/logo", pdfAsset.getLogo);
router.get("/internal/pdf-asset/:orgId/logo-for-quote", pdfAsset.getLogoForQuote);
router.get("/internal/pdf-asset/:orgId/logo-for-invoice", pdfAsset.getLogoForInvoice);
router.get("/internal/pdf-asset/:orgId/pdf-cover", pdfAsset.getPdfCover);

/**
 * GET /api/internal/pdf-financial-quote/:quoteId?renderToken=...&quoteSigned=1
 */
router.get("/internal/pdf-financial-quote/:quoteId", getInternalFinancialQuotePdfPayload);

/**
 * GET /api/internal/pdf-quote-signature/:quoteId/:role?renderToken=... — role client|company
 */
router.get("/internal/pdf-quote-signature/:quoteId/:role", getInternalQuoteSignaturePng);

/**
 * GET /api/internal/pdf-financial-invoice/:invoiceId?renderToken=...
 */
router.get("/internal/pdf-financial-invoice/:invoiceId", getInternalFinancialInvoicePdfPayload);

export default router;
