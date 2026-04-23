/**
 * Super admin — CRUD organisations (liste, archivage, suppression, impersonation).
 */
import { pool } from "../config/db.js";
import { generateImpersonationJWT } from "../auth/auth.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import * as svc from "../services/admin/adminOrganizations.service.js";
import { SUPER_ADMIN_IMPERSONATION_ROLE_CODE } from "../lib/superAdminUserGuards.js";

function jwtOrgId(req) {
  return req.user?.jwtOrganizationId ?? req.user?.jwt_organization_id ?? null;
}

function requireSuperAdmin(req, res) {
  if (req.user?.role !== "SUPER_ADMIN") {
    res.status(403).json({ error: "Accès réservé au super administrateur" });
    return false;
  }
  return true;
}

/**
 * GET /api/admin/organizations?includeArchived=true
 */
export async function list(req, res) {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const raw = req.query?.includeArchived;
    const includeArchived =
      raw === "true" || raw === "1" || raw === true || (Array.isArray(raw) && raw[0] === "true");
    const rows = await svc.listSuperAdminOrganizations({ includeArchived });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PATCH /api/admin/organizations/:id/archive
 */
export async function archive(req, res) {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const id = req.params.id;
    const home = jwtOrgId(req);
    const row = await svc.archiveOrganization(id, home);
    console.log("[admin.organizations] archived", { id: row.id, name: row.name });
    res.json({ ok: true, organization: row });
  } catch (e) {
    const code = e.code;
    const status = e.statusCode || (e.message?.includes("introuvable") ? 404 : 500);
    if (status >= 500) console.error("[admin.organizations] archive", e);
    res.status(status).json({ error: e.message, code });
  }
}

/**
 * PATCH /api/admin/organizations/:id/restore
 */
export async function restore(req, res) {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const id = req.params.id;
    const row = await svc.restoreOrganization(id);
    console.log("[admin.organizations] restored", { id: row.id, name: row.name });
    res.json({ ok: true, organization: row });
  } catch (e) {
    const status = e.statusCode || (e.message?.includes("introuvable") ? 404 : 500);
    if (status >= 500) console.error("[admin.organizations] restore", e);
    res.status(status).json({ error: e.message, code: e.code });
  }
}

/**
 * DELETE /api/admin/organizations/:id
 */
export async function remove(req, res) {
  try {
    if (!requireSuperAdmin(req, res)) return;
    const id = req.params.id;
    const home = jwtOrgId(req);
    const row = await svc.deleteOrganizationSafe(id, home);
    console.log("[admin.organizations] deleted", { id: row.id, name: row.name });
    res.json({ ok: true, deleted: row });
  } catch (e) {
    const code = e.code;
    const status = e.statusCode || (e.message?.includes("introuvable") ? 404 : 500);
    if (status >= 500) console.error("[admin.organizations] delete", e);
    res.status(status).json({ error: e.message, code, details: e.details });
  }
}

/**
 * POST /api/admin/organizations/:id/impersonate
 * Jeton court : organisation cible, rôle SUPER_ADMIN_IMPERSONATION, originalAdminId = admin.
 */
export async function impersonate(req, res) {
  try {
    if (!requireSuperAdmin(req, res)) return;
    if (
      req.user?.impersonation === true ||
      req.user?.impersonation === "true" ||
      String(req.user?.role) === SUPER_ADMIN_IMPERSONATION_ROLE_CODE
    ) {
      return res.status(400).json({
        error: "Session d’impersonation déjà active — reconnectez-vous en super administrateur",
        code: "IMPERSONATION_CHAIN_FORBIDDEN",
      });
    }
    const id = String(req.params.id || "").trim();
    const o = await pool.query(
      `SELECT id, name, COALESCE(is_archived, false) AS is_archived
       FROM organizations WHERE id = $1`,
      [id]
    );
    if (o.rows.length === 0) {
      return res.status(404).json({ error: "Organisation introuvable" });
    }
    const org = o.rows[0];
    if (org.is_archived) {
      return res.status(400).json({
        error: "Impossible d’impersonner une organisation archivée",
        code: "ORG_ARCHIVED",
      });
    }
    const adminId = String(req.user.userId ?? req.user.id ?? "");
    if (!adminId) {
      return res.status(401).json({ error: "Utilisateur non identifié" });
    }
    const adminHomeOrg = String(
      req.user.jwtOrganizationId ?? req.user.jwt_organization_id ?? req.user.organizationId ?? ""
    );
    const token = generateImpersonationJWT({
      originalAdminId: adminId,
      targetOrganizationId: org.id,
      originalAdminOrganizationId: adminHomeOrg,
    });
    void logAuditEvent({
      action: AuditActions.SUPER_ADMIN_ORG_IMPERSONATE,
      entityType: "organization",
      entityId: org.id,
      organizationId: org.id,
      userId: adminId,
      req,
      statusCode: 200,
      metadata: {
        target_organization_id: org.id,
        target_organization_name: org.name,
        original_admin_id: adminId,
      },
    });
    console.log("[admin.organizations] impersonate issued", { target: org.id, name: org.name, adminId });
    res.json({
      token,
      expiresInSec: 7200,
      organization: { id: org.id, name: org.name },
    });
  } catch (e) {
    console.error("[admin.organizations] impersonate", e);
    res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}
