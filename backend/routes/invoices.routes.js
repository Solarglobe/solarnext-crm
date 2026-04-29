/**
 * CP-026 — Routes Invoices
 * Ordre : routes spécifiques avant /:id
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import * as controller from "../controllers/invoices.controller.js";
import * as invoiceFinance from "../controllers/invoiceFinance.controller.js";
import { archiveEntity, restoreEntity } from "../services/archive.service.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

router.get("/", verifyJWT, requirePermission("invoice.manage"), controller.getAll);

router.post(
  "/from-quote/:quoteId",
  verifyJWT,
  requirePermission("invoice.manage"),
  controller.createFromQuote
);
router.post(
  "/from-quote/:quoteId/prepared-standard",
  verifyJWT,
  requirePermission("invoice.manage"),
  controller.createPreparedStandardFromQuote
);

router.post(
  "/:id/duplicate",
  verifyJWT,
  requirePermission("invoice.manage"),
  controller.duplicate
);

router.post(
  "/:id/recalculate-status",
  verifyJWT,
  requirePermission("invoice.manage"),
  controller.recalculateStatus
);

router.post(
  "/:id/pdf",
  verifyJWT,
  requirePermission("invoice.manage"),
  controller.generatePdf
);

router.patch(
  "/:id/status",
  verifyJWT,
  requirePermission("invoice.manage"),
  controller.patchStatus
);

router.get(
  "/:id/snapshot",
  verifyJWT,
  requirePermission("invoice.manage"),
  controller.getDocumentSnapshot
);

router.get(
  "/:invoiceId/payments",
  verifyJWT,
  requirePermission("invoice.manage"),
  invoiceFinance.listPayments
);
router.post(
  "/:invoiceId/payments",
  verifyJWT,
  requirePermission("invoice.manage"),
  invoiceFinance.createPayment
);

router.get(
  "/:invoiceId/credit-notes",
  verifyJWT,
  requirePermission("invoice.manage"),
  invoiceFinance.listCreditNotes
);
router.post(
  "/:invoiceId/credit-notes",
  verifyJWT,
  requirePermission("invoice.manage"),
  invoiceFinance.createCreditNote
);

router.get(
  "/:invoiceId/reminders",
  verifyJWT,
  requirePermission("invoice.manage"),
  invoiceFinance.listReminders
);
router.post(
  "/:invoiceId/reminders",
  verifyJWT,
  requirePermission("invoice.manage"),
  invoiceFinance.createReminder
);

router.get("/:id", verifyJWT, requirePermission("invoice.manage"), controller.getById);

router.patch(
  "/:id/archive",
  verifyJWT,
  requirePermission("invoice.manage"),
  async (req, res) => {
    try {
      const data = await archiveEntity("invoices", req.params.id, orgId(req), userId(req));
      if (!data) return res.status(404).json({ error: "Facture non trouvée" });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);
router.patch(
  "/:id/restore",
  verifyJWT,
  requirePermission("invoice.manage"),
  async (req, res) => {
    try {
      const data = await restoreEntity("invoices", req.params.id, orgId(req));
      if (!data) return res.status(404).json({ error: "Facture non trouvée" });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

router.post("/", verifyJWT, requirePermission("invoice.manage"), controller.create);
router.patch("/:id", verifyJWT, requirePermission("invoice.manage"), controller.update);
router.put("/:id", verifyJWT, requirePermission("invoice.manage"), controller.update);
router.delete("/:id", verifyJWT, requirePermission("invoice.manage"), controller.remove);

export default router;
