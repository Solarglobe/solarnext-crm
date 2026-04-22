/**
 * CP-027 — Admin Users Controller
 * Gestion des utilisateurs dans l'organisation courante.
 * Isolation par organization_id : impossible de modifier un user d'une autre org.
 *
 * CP-ADMIN-ARCH-01 : Cohérence JWT/legacy — le login lit user_roles/roles.
 * On garantit qu'un user avec rbac_role a toujours un legacy role correspondant.
 * Mapping stable : rbac_role.code = roles.name (1:1).
 */

import { pool } from "../config/db.js";
import { hashPassword } from "../auth/auth.service.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";
import {
  isJwtSuperAdmin,
  rbacRoleIdsIncludeSuperAdmin,
  userHasSuperAdminRbacRole,
  sendForbiddenSuperAdminRole,
  SUPER_ADMIN_ROLE_CODE,
} from "../lib/superAdminUserGuards.js";
import {
  ensureAdminRbacConsistentAfterUserCreate,
} from "../rbac/rbac.service.js";
import { ensureLegacyRoleAndUserBridge } from "../services/rbac/legacyRoleBridge.service.js";
import { respondIfDeletingOwnAccount } from "../services/rbac/userSelfDeleteGuard.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

/** @param {unknown} v */
function normOptName(v) {
  if (v == null) return null;
  const t = String(v).trim();
  return t === "" ? null : t;
}

async function ensureLegacyRoleAndSync(pool, userId, rbacCode) {
  await ensureLegacyRoleAndUserBridge(pool, userId, rbacCode);
}

/**
 * @param {import("express").Request} req
 * @param {import("express").Response} res
 * @param {string} targetUserId
 * @param {{ forbiddenSuperAdminMessage?: string }} [options]
 */
async function assertCallerMayAccessTargetUser(req, res, targetUserId, options = {}) {
  const org = orgId(req);
  if (isJwtSuperAdmin(req)) return true;
  if (await userHasSuperAdminRbacRole(pool, targetUserId, org)) {
    sendForbiddenSuperAdminRole(res, options.forbiddenSuperAdminMessage);
    return false;
  }
  return true;
}

/**
 * GET /api/admin/users
 * Liste les utilisateurs de l'organisation courante.
 */
export async function list(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(
      `SELECT u.id, u.email, u.status, u.last_login, u.created_at,
              u.first_name, u.last_name,
              NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS name,
              COALESCE(
                (SELECT array_agg(r.code) FROM rbac_user_roles ur
                 JOIN rbac_roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id AND (r.organization_id = u.organization_id OR r.organization_id IS NULL)),
                ARRAY[]::text[]
              ) as roles
       FROM users u
       WHERE u.organization_id = $1
       ORDER BY u.email`,
      [org]
    );
    const requesterSuper = isJwtSuperAdmin(req);
    const rows = result.rows
      .filter((row) => {
        const codes = row.roles || [];
        if (requesterSuper) return true;
        return !codes.some((c) => String(c).toUpperCase() === SUPER_ADMIN_ROLE_CODE);
      })
      .map((row) => {
        if (requesterSuper) return row;
        const codes = row.roles || [];
        const filtered = codes.filter((c) => String(c).toUpperCase() !== SUPER_ADMIN_ROLE_CODE);
        return { ...row, roles: filtered };
      });
    res.json(rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/admin/users
 * Crée un utilisateur dans l'organisation courante.
 * Body: { email, password, first_name?, last_name?, roleIds?: string[] }
 */
export async function create(req, res) {
  try {
    const org = orgId(req);
    const { email, password, roleIds = [] } = req.body;
    const firstName = normOptName(req.body.first_name);
    const lastName = normOptName(req.body.last_name);

    if (!email || !password) {
      return res.status(400).json({ error: "email et password requis" });
    }

    const emailNorm = email.toLowerCase().trim();
    const existing = await pool.query(
      "SELECT id FROM users WHERE organization_id = $1 AND email = $2",
      [org, emailNorm]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: "Un utilisateur avec cet email existe déjà" });
    }

    if (!isJwtSuperAdmin(req) && (await rbacRoleIdsIncludeSuperAdmin(pool, roleIds))) {
      return sendForbiddenSuperAdminRole(res);
    }

    const passwordHash = await hashPassword(password);
    const insert = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status, first_name, last_name)
       VALUES ($1, $2, $3, 'active', $4, $5)
       RETURNING id, email, status, created_at, first_name, last_name,
         NULLIF(TRIM(CONCAT_WS(' ', first_name, last_name)), '') AS name`,
      [org, emailNorm, passwordHash, firstName, lastName]
    );
    const user = insert.rows[0];

    for (const roleId of roleIds) {
      const role = await pool.query(
        "SELECT id, organization_id, code FROM rbac_roles WHERE id = $1",
        [roleId]
      );
      if (role.rows.length === 0) continue;
      const r = role.rows[0];
      if (r.organization_id !== org && r.organization_id !== null) continue;
      await pool.query(
        "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
        [user.id, roleId]
      );
      await ensureLegacyRoleAndSync(pool, user.id, r.code);
    }

    await ensureAdminRbacConsistentAfterUserCreate(pool, user.id, org, roleIds);

    const actorId = req.user?.userId ?? req.user?.id ?? null;
    void logAuditEvent({
      action: AuditActions.USER_CREATED,
      entityType: "user",
      entityId: user.id,
      organizationId: org,
      userId: actorId,
      targetLabel: user.email,
      req,
      statusCode: 201,
      metadata: { role_ids: roleIds },
    });
    res.status(201).json(user);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/admin/users/:id
 * Met à jour un utilisateur de l'organisation courante.
 * Impossible de modifier un user d'une autre org.
 */
export async function update(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const { email, password, status, roleIds } = req.body;
    const actorId = req.user?.userId ?? req.user?.id ?? null;

    const existing = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (existing.rows.length === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé ou hors organisation" });
    }

    if (!(await assertCallerMayAccessTargetUser(req, res, id))) return;

    const updates = [];
    const values = [];
    let idx = 1;

    if (email !== undefined) {
      const emailNorm = email.toLowerCase().trim();
      const dup = await pool.query(
        "SELECT id FROM users WHERE organization_id = $1 AND email = $2 AND id != $3",
        [org, emailNorm, id]
      );
      if (dup.rows.length > 0) {
        return res.status(409).json({ error: "Un utilisateur avec cet email existe déjà" });
      }
      updates.push(`email = $${idx++}`);
      values.push(emailNorm);
    }
    if (password !== undefined && password !== "") {
      const passwordHash = await hashPassword(password);
      updates.push(`password_hash = $${idx++}`);
      values.push(passwordHash);
    }
    if (status !== undefined) {
      updates.push(`status = $${idx++}`);
      values.push(status);
    }
    if (req.body.first_name !== undefined) {
      updates.push(`first_name = $${idx++}`);
      values.push(normOptName(req.body.first_name));
    }
    if (req.body.last_name !== undefined) {
      updates.push(`last_name = $${idx++}`);
      values.push(normOptName(req.body.last_name));
    }

    if (updates.length > 0) {
      values.push(id);
      await pool.query(
        `UPDATE users SET ${updates.join(", ")} WHERE id = $${idx}`,
        values
      );
    }

    if (roleIds !== undefined) {
      if (!isJwtSuperAdmin(req) && (await rbacRoleIdsIncludeSuperAdmin(pool, roleIds))) {
        return sendForbiddenSuperAdminRole(res);
      }
      await pool.query("DELETE FROM rbac_user_roles WHERE user_id = $1", [id]);
      await pool.query("DELETE FROM user_roles WHERE user_id = $1", [id]);
      for (const roleId of roleIds) {
        const role = await pool.query(
          "SELECT id, organization_id, code FROM rbac_roles WHERE id = $1",
          [roleId]
        );
        if (role.rows.length === 0) continue;
        const r = role.rows[0];
        if (r.organization_id !== org && r.organization_id !== null) continue;
        await pool.query(
          "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
          [id, roleId]
        );
        await ensureLegacyRoleAndSync(pool, id, r.code);
      }
    }

    const updated = await pool.query(
      `SELECT u.id, u.email, u.status, u.last_login, u.created_at,
              u.first_name, u.last_name,
              NULLIF(TRIM(CONCAT_WS(' ', u.first_name, u.last_name)), '') AS name,
              COALESCE(
                (SELECT array_agg(r.code) FROM rbac_user_roles ur
                 JOIN rbac_roles r ON r.id = ur.role_id
                 WHERE ur.user_id = u.id),
                ARRAY[]::text[]
              ) as roles
       FROM users u
       WHERE u.id = $1`,
      [id]
    );
    const row = updated.rows[0] || {};
    const changed = [];
    if (email !== undefined) changed.push("email");
    if (password !== undefined && password !== "") changed.push("password");
    if (status !== undefined) changed.push("status");
    if (req.body.first_name !== undefined) changed.push("first_name");
    if (req.body.last_name !== undefined) changed.push("last_name");
    const changedNoRoles = changed.filter((c) => c !== "roles");
    if (changedNoRoles.length > 0) {
      void logAuditEvent({
        action: AuditActions.USER_UPDATED,
        entityType: "user",
        entityId: id,
        organizationId: org,
        userId: actorId,
        targetLabel: row.email,
        req,
        statusCode: 200,
        metadata: { changed_fields: changedNoRoles },
      });
    }
    if (roleIds !== undefined) {
      void logAuditEvent({
        action: AuditActions.USER_ROLE_UPDATED,
        entityType: "user",
        entityId: id,
        organizationId: org,
        userId: actorId,
        targetLabel: row.email,
        req,
        statusCode: 200,
        metadata: { role_ids: roleIds },
      });
    }
    res.json(row);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/admin/users/:id/teams
 * Liste les équipes affectées à l'utilisateur.
 */
export async function getUserTeams(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;

    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé ou hors organisation" });
    }

    if (!(await assertCallerMayAccessTargetUser(req, res, id))) return;

    const result = await pool.query(
      `SELECT ut.id, ut.team_id, t.name as team_name, t.agency_id, a.name as agency_name
       FROM user_team ut
       JOIN teams t ON t.id = ut.team_id
       LEFT JOIN agencies a ON a.id = t.agency_id
       WHERE ut.user_id = $1 AND ut.organization_id = $2
       ORDER BY t.name`,
      [id, org]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/admin/users/:id/teams
 * Remplace les affectations équipes (replace complet, transaction).
 * Body: { teamIds: string[] }
 */
export async function putUserTeams(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const { teamIds = [] } = req.body;

    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé ou hors organisation" });
    }

    if (!(await assertCallerMayAccessTargetUser(req, res, id))) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM user_team WHERE user_id = $1 AND organization_id = $2", [id, org]);

      for (const teamId of teamIds) {
        const teamCheck = await client.query(
          "SELECT id FROM teams WHERE id = $1 AND organization_id = $2",
          [teamId, org]
        );
        if (teamCheck.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: `team_id ${teamId} invalide ou hors organisation` });
        }
        await client.query(
          `INSERT INTO user_team (organization_id, user_id, team_id) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, team_id) DO NOTHING`,
          [org, id, teamId]
        );
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const result = await pool.query(
      `SELECT ut.id, ut.team_id, t.name as team_name
       FROM user_team ut
       JOIN teams t ON t.id = ut.team_id
       WHERE ut.user_id = $1 AND ut.organization_id = $2
       ORDER BY t.name`,
      [id, org]
    );
    res.json(result.rows);
  } catch (e) {
    if (e.code === "23514" || e.message?.includes("cross-org")) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/admin/users/:id/agencies
 * Liste les agences affectées à l'utilisateur.
 */
export async function getUserAgencies(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;

    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé ou hors organisation" });
    }

    if (!(await assertCallerMayAccessTargetUser(req, res, id))) return;

    const result = await pool.query(
      `SELECT ua.id, ua.agency_id, a.name as agency_name
       FROM user_agency ua
       JOIN agencies a ON a.id = ua.agency_id
       WHERE ua.user_id = $1 AND ua.organization_id = $2
       ORDER BY a.name`,
      [id, org]
    );
    res.json(result.rows);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/admin/users/:id/agencies
 * Remplace les affectations agences (replace complet, transaction).
 * Body: { agencyIds: string[] }
 */
export async function putUserAgencies(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;
    const { agencyIds = [] } = req.body;

    const userCheck = await pool.query(
      "SELECT id FROM users WHERE id = $1 AND organization_id = $2",
      [id, org]
    );
    if (userCheck.rows.length === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé ou hors organisation" });
    }

    if (!(await assertCallerMayAccessTargetUser(req, res, id))) return;

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("DELETE FROM user_agency WHERE user_id = $1 AND organization_id = $2", [id, org]);

      for (const agencyId of agencyIds) {
        const agencyCheck = await client.query(
          "SELECT id FROM agencies WHERE id = $1 AND organization_id = $2",
          [agencyId, org]
        );
        if (agencyCheck.rows.length === 0) {
          await client.query("ROLLBACK");
          return res.status(400).json({ error: `agency_id ${agencyId} invalide ou hors organisation` });
        }
        await client.query(
          `INSERT INTO user_agency (organization_id, user_id, agency_id) VALUES ($1, $2, $3)
           ON CONFLICT (user_id, agency_id) DO NOTHING`,
          [org, id, agencyId]
        );
      }
      await client.query("COMMIT");
    } finally {
      client.release();
    }

    const result = await pool.query(
      `SELECT ua.id, ua.agency_id, a.name as agency_name
       FROM user_agency ua
       JOIN agencies a ON a.id = ua.agency_id
       WHERE ua.user_id = $1 AND ua.organization_id = $2
       ORDER BY a.name`,
      [id, org]
    );
    res.json(result.rows);
  } catch (e) {
    if (e.code === "23514" || e.message?.includes("cross-org")) {
      return res.status(400).json({ error: e.message });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/admin/users/:id
 * Supprime un utilisateur de l'organisation courante.
 */
export async function remove(req, res) {
  try {
    const org = orgId(req);
    const { id } = req.params;

    const actorId = req.user?.userId ?? req.user?.id ?? null;
    if (respondIfDeletingOwnAccount(res, actorId, id)) return;

    if (
      !(await assertCallerMayAccessTargetUser(req, res, id, {
        forbiddenSuperAdminMessage: "Seul un super administrateur peut supprimer cet utilisateur",
      }))
    ) {
      return;
    }

    if (respondIfDeletingOwnAccount(res, actorId, id)) return;

    const before = await pool.query("SELECT email FROM users WHERE id = $1 AND organization_id = $2", [id, org]);
    const deletedEmail = before.rows[0]?.email ?? null;

    const result = await pool.query(
      "DELETE FROM users WHERE id = $1 AND organization_id = $2 RETURNING id",
      [id, org]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Utilisateur non trouvé ou hors organisation" });
    }
    void logAuditEvent({
      action: AuditActions.USER_DELETED,
      entityType: "user",
      entityId: id,
      organizationId: org,
      userId: actorId,
      targetLabel: deletedEmail != null ? String(deletedEmail) : undefined,
      req,
      statusCode: 204,
      metadata: { deleted_user_email: deletedEmail },
    });
    res.status(204).send();
  } catch (error) {
    console.error("DELETE USER ERROR", error);
    if (res.headersSent) return;
    return res.status(500).json({
      error: "Internal error",
      code: "DELETE_USER_FAILED",
    });
  }
}
