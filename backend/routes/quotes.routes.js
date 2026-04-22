/**
 * CP-031 — Routes Quotes avec moteur devis V1
 * POST, GET/:id, PATCH/:id, PATCH/:id/status, DELETE/:id
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/quotes.controller.js";
import * as service from "./quotes/service.js";
import { archiveEntity, restoreEntity } from "../services/archive.service.js";
import { pool } from "../config/db.js";
import path from "path";
import { resolveOrgLogoAbsolutePath } from "../services/orgLogo.service.js";
import { computeVirtualBatteryQuoteFromGrid } from "../services/virtualBatteryQuoteCalculator.service.js";
import * as invoiceService from "../services/invoices.service.js";
import { heavyUserRateLimiter } from "../middleware/security/rateLimit.presets.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

router.get("/", verifyJWT, requirePermission("quote.manage"), controller.getAll);

// Liste batteries virtuelles (pour préparation devis) — même permission que devis
router.get(
  "/virtual-batteries",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      if (!org) return res.status(403).json({ error: "Organization non identifiée" });
      const { rows } = await pool.query(
        `SELECT id, organization_id, name, provider_code, pricing_model, is_active,
                tariff_grid_json, tariff_source_label, tariff_effective_date
         FROM pv_virtual_batteries WHERE organization_id = $1 AND is_active = true ORDER BY name`,
        [org]
      );
      res.json(rows);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// Calcul coût annuel batterie virtuelle (grille JSON)
router.post(
  "/virtual-battery/compute",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      if (!org) return res.status(403).json({ error: "Organization non identifiée" });
      const body = req.body || {};
      const result = await computeVirtualBatteryQuoteFromGrid({
        organizationId: org,
        providerCode: body.providerCode,
        segmentCode: body.segmentCode,
        kva: body.kva,
        kwcInstalled: body.kwcInstalled,
        kwhRestitutionAnnual: body.kwhRestitutionAnnual,
        includeActivationFee: body.includeActivationFee === true,
        hpRatio: body.hpRatio,
        hcRatio: body.hcRatio,
      });
      res.json(result);
    } catch (e) {
      const status = e.message?.includes("non trouvée") ? 404 : e.message?.includes("invalide") ? 400 : 500;
      res.status(status).json({ error: e.message });
    }
  }
);

router.patch(
  "/:id/archive",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const data = await archiveEntity("quotes", req.params.id, orgId(req), userId(req));
      if (!data) return res.status(404).json({ error: "Devis non trouvé" });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);
router.patch(
  "/:id/restore",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const data = await restoreEntity("quotes", req.params.id, orgId(req));
      if (!data) return res.status(404).json({ error: "Devis non trouvé" });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

router.get(
  "/:id/snapshot",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const snap = await service.getQuoteDocumentSnapshot(req.params.id, org);
      if (snap === null) {
        const exists = await pool.query(
          `SELECT id FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
          [req.params.id, org]
        );
        if (exists.rows.length === 0) return res.status(404).json({ error: "Devis non trouvé" });
        return res.status(404).json({ error: "Aucun snapshot documentaire figé pour ce devis" });
      }
      res.json({ snapshot: snap });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

/** Payload miroir PDF (officiel si snapshot, sinon aperçu live brouillon) — page Présenter / cohérence document */
router.get(
  "/:id/document-view-model",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await service.getQuoteDocumentViewModel(req.params.id, org);
      res.json(data);
    } catch (e) {
      const code = e.statusCode === 404 ? 404 : 500;
      res.status(code).json({ error: e.message });
    }
  }
);

/** Logo org pour rendu devis CRM (JWT) — évite renderToken dans <img> */
router.get(
  "/:id/pdf-logo",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const exists = await pool.query(
        `SELECT id FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [req.params.id, org]
      );
      if (exists.rows.length === 0) return res.status(404).json({ error: "Devis non trouvé" });
      const filePath = await resolveOrgLogoAbsolutePath(org);
      if (!filePath) return res.status(404).json({ error: "Logo non trouvé" });
      res.sendFile(path.resolve(filePath));
    } catch (e) {
      if (e.code === "ENOENT") return res.status(404).json({ error: "Fichier non trouvé" });
      res.status(500).json({ error: e.message });
    }
  }
);

router.get(
  "/:id/invoice-billing-context",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await invoiceService.getQuoteInvoiceBillingContext(req.params.id, org);
      if (!data) return res.status(404).json({ error: "Devis non trouvé" });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

/** Finalisation terrain : signatures PNG → PDF signé (Playwright) → quote_pdf_signed → ACCEPTED */
router.post(
  "/:id/finalize-signed",
  verifyJWT,
  requirePermission("quote.manage"),
  heavyUserRateLimiter,
  async (req, res) => {
    try {
      const org = orgId(req);
      const uid = userId(req);
      const data = await service.finalizeQuoteSigned(req.params.id, org, uid, req.body || {});
      res.status(201).json(data);
    } catch (e) {
      const code =
        e.statusCode === 404 ? 404 : e.statusCode === 400 ? 400 : e.statusCode === 502 ? 502 : 500;
      res.status(code).json({ error: e.message });
    }
  }
);

router.get(
  "/:id",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await service.getQuoteDetail(req.params.id, org);
      if (!data) return res.status(404).json({ error: "Devis non trouvé" });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

router.post(
  "/:id/duplicate",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await service.duplicateQuote(req.params.id, org);
      res.status(201).json(data);
    } catch (e) {
      const code = e.statusCode === 404 ? 404 : 400;
      res.status(code).json({ error: e.message });
    }
  }
);

router.post(
  "/:id/pdf",
  verifyJWT,
  requirePermission("quote.manage"),
  heavyUserRateLimiter,
  async (req, res) => {
    try {
      const org = orgId(req);
      const uid = userId(req);
      const data = await service.generateQuotePdfRecord(req.params.id, org, uid);
      res.status(201).json(data);
    } catch (e) {
      const code = e.statusCode === 404 ? 404 : e.statusCode === 400 ? 400 : 500;
      res.status(code).json({ error: e.message });
    }
  }
);

router.post(
  "/:id/add-to-documents",
  verifyJWT,
  requirePermission("quote.manage"),
  heavyUserRateLimiter,
  async (req, res) => {
    try {
      const org = orgId(req);
      const uid = userId(req);
      const data = await service.addQuotePdfToDocuments(req.params.id, org, uid, req.body || {});
      if (data.status === "conflict") {
        return res.status(409).json(data);
      }
      if (data.status === "replaced") {
        return res.status(200).json(data);
      }
      return res.status(201).json(data);
    } catch (e) {
      const code = e.statusCode === 404 ? 404 : e.statusCode === 400 ? 400 : 500;
      res.status(code).json({ error: e.message });
    }
  }
);

router.post(
  "/",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await service.createQuote(org, req.body, { req, userId: userId(req) });
      res.status(201).json(data);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

// CP-QUOTE-004 — Lignes devis depuis catalogue (snapshot) + recalcul totaux
router.post(
  "/:id/items/from-catalog",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const { item, totals } = await service.addItemFromCatalog(
        req.params.id,
        org,
        req.body
      );
      res.status(201).json({ item, totals });
    } catch (e) {
      const code = e.statusCode ?? (e.message?.includes("PERCENT_TOTAL") ? 400 : 500);
      res.status(code).json({ error: e.message });
    }
  }
);
router.patch(
  "/:id/items/:itemId",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const { item, totals } = await service.patchQuoteLine(
        req.params.id,
        req.params.itemId,
        org,
        req.body
      );
      res.json({ item, totals });
    } catch (e) {
      res.status(e.statusCode ?? 500).json({ error: e.message });
    }
  }
);
router.post(
  "/:id/items/:itemId/deactivate",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const { totals } = await service.deactivateQuoteLine(
        req.params.id,
        req.params.itemId,
        org
      );
      res.json({ totals });
    } catch (e) {
      res.status(e.statusCode ?? 500).json({ error: e.message });
    }
  }
);

async function handleQuoteUpdate(req, res) {
  try {
    const org = orgId(req);
    const data = await service.updateQuote(req.params.id, org, req.body, {
      req,
      userId: userId(req),
    });
    if (!data) return res.status(404).json({ error: "Devis non trouvé" });
    res.json(data);
  } catch (e) {
    const status = e.message?.includes("interdite") ? 403 : 400;
    res.status(status).json({ error: e.message });
  }
}

router.patch(
  "/:id",
  verifyJWT,
  requirePermission("quote.manage"),
  handleQuoteUpdate
);

router.put(
  "/:id",
  verifyJWT,
  requirePermission("quote.manage"),
  handleQuoteUpdate
);

router.patch(
  "/:id/status",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const uid = userId(req);
      const { status } = req.body;
      if (!status) return res.status(400).json({ error: "status requis" });
      const data = await service.patchQuoteStatus(req.params.id, org, status, uid);
      if (!data) return res.status(404).json({ error: "Devis non trouvé" });
      res.json(data);
    } catch (e) {
      const status = e.message?.includes("interdite") ? 403 : 400;
      res.status(status).json({ error: e.message });
    }
  }
);

router.delete(
  "/:id",
  verifyJWT,
  requirePermission("quote.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const qid = req.params.id;
      const qnumRes = await pool.query(
        `SELECT quote_number, status FROM quotes WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [qid, org]
      );
      const quoteNumber = qnumRes.rows[0]?.quote_number ?? null;
      const ok = await service.deleteQuote(qid, org);
      if (!ok) return res.status(404).json({ error: "Devis non trouvé" });
      void logAuditEvent({
        action: AuditActions.QUOTE_DELETED,
        entityType: "quote",
        entityId: qid,
        organizationId: org,
        userId: userId(req),
        targetLabel: quoteNumber != null ? String(quoteNumber) : undefined,
        req,
        statusCode: 204,
        metadata: {
          hard_delete: true,
          draft_only: true,
          quote_number: quoteNumber,
          status_before: qnumRes.rows[0]?.status ?? null,
        },
      });
      res.status(204).send();
    } catch (e) {
      const status = e.message?.includes("interdite") ? 403 : 400;
      res.status(status).json({ error: e.message });
    }
  }
);

export default router;
