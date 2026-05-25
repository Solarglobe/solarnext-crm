/**
 * Annulation d’un paiement (hors arbre /api/invoices/...).
 */

import * as paymentsService from "../services/payments.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

export async function cancelPayment(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(403).json({ error: "Organization non identifiée" });
    const row = await paymentsService.cancelPayment(org, req.params.id, userId(req));
    void logAuditEvent({
      action: AuditActions.PAYMENT_CANCELLED,
      entityType: "payment",
      entityId: row.id,
      organizationId: org,
      userId: userId(req),
      targetLabel: row.reference || undefined,
      req,
      statusCode: 200,
      metadata: {
        invoice_id: row.invoice_id,
        amount: row.amount,
        payment_method: row.payment_method,
      },
    });
    res.json(row);
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ error: e.message });
  }
}
