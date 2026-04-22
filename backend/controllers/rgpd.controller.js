/**
 * CP-075 — Contrôleur RGPD (export JSON, anonymisation).
 */

import { exportRgpdData, runRgpdAnonymization } from "../services/rgpd/rgpd.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

function orgId(req) {
  return req.user?.organizationId ?? req.user?.organization_id;
}

export async function exportRgpd(req, res) {
  try {
    const oid = orgId(req);
    if (!oid) {
      return res.status(403).json({ error: "Organisation manquante" });
    }
    const { entityType, id } = req.params;
    const payload = await exportRgpdData(oid, entityType, id);

    await logAuditEvent({
      action: AuditActions.RGPD_EXPORT_REQUESTED,
      entityType: String(entityType || "unknown").toLowerCase(),
      entityId: id,
      organizationId: oid,
      userId: req.user?.userId ?? req.user?.id ?? null,
      req,
      statusCode: 200,
      metadata: { route: "GET /api/rgpd/export/:entityType/:id" },
    });

    const dl = req.query.download === "1" || req.query.download === "true";
    if (dl) {
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.setHeader(
        "Content-Disposition",
        `attachment; filename="rgpd-export-${entityType}-${id}.json"`
      );
    }
    return res.status(200).json(payload);
  } catch (e) {
    const code = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    return res.status(code).json({ error: e.message || "Erreur serveur" });
  }
}

export async function anonymizeRgpd(req, res) {
  try {
    const oid = orgId(req);
    if (!oid) {
      return res.status(403).json({ error: "Organisation manquante" });
    }
    const { entityType, id } = req.params;
    const result = await runRgpdAnonymization(oid, entityType, id);

    await logAuditEvent({
      action: AuditActions.RGPD_DELETE_REQUESTED,
      entityType: String(entityType || "unknown").toLowerCase(),
      entityId: id,
      organizationId: oid,
      userId: req.user?.userId ?? req.user?.id ?? null,
      req,
      statusCode: 200,
      metadata: { route: "DELETE /api/rgpd/delete/:entityType/:id", anonymization: true, ...result },
    });

    return res.status(200).json({ ok: true, ...result });
  } catch (e) {
    const code = e.statusCode && e.statusCode >= 400 && e.statusCode < 600 ? e.statusCode : 500;
    return res.status(code).json({ error: e.message || "Erreur serveur" });
  }
}
