import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import { effectiveSuperAdminRequestBypass } from "../lib/superAdminUserGuards.js";
import { AuditActions } from "../services/audit/auditActions.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { exportAuditLogsCsv, listAuditLogs } from "../services/audit/auditLogQuery.service.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

function filtersFromQuery(query) {
  return {
    action: query.action || undefined,
    userId: query.user_id || undefined,
    entityType: query.entity_type || undefined,
    dateFrom: query.date_from || undefined,
    dateTo: query.date_to || undefined,
    organizationId: query.org_id || undefined,
    limit: query.limit ? Number(query.limit) : 50,
    offset: query.offset ? Number(query.offset) : 0,
  };
}

router.get("/", verifyJWT, requirePermission("org.settings.manage"), async (req, res) => {
  try {
    const isSuperAdmin = effectiveSuperAdminRequestBypass(req);
    const org = orgId(req);
    const filters = filtersFromQuery(req.query);
    const result = await listAuditLogs(org, { ...filters, isSuperAdmin });
    void logAuditEvent({
      action: AuditActions.AUDIT_LOG_VIEWED,
      entityType: "audit_log",
      organizationId: isSuperAdmin && filters.organizationId ? filters.organizationId : org,
      userId: userId(req),
      req,
      statusCode: 200,
      metadata: { filters: { ...filters, limit: result.limit, offset: result.offset } },
    });
    res.json(result);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

router.get("/export.csv", verifyJWT, requirePermission("org.settings.manage"), async (req, res) => {
  try {
    const isSuperAdmin = effectiveSuperAdminRequestBypass(req);
    const org = orgId(req);
    const filters = filtersFromQuery(req.query);
    const csv = await exportAuditLogsCsv(org, { ...filters, isSuperAdmin });
    void logAuditEvent({
      action: AuditActions.AUDIT_LOG_EXPORTED,
      entityType: "audit_log",
      organizationId: isSuperAdmin && filters.organizationId ? filters.organizationId : org,
      userId: userId(req),
      req,
      statusCode: 200,
      metadata: { filters },
    });
    res.setHeader("Content-Type", "text/csv; charset=utf-8");
    res.setHeader("Content-Disposition", "attachment; filename=audit-log.csv");
    res.send(csv);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

export default router;
