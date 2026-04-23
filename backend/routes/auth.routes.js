import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { login } from "../auth/auth.controller.js";
import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import {
  SUPER_ADMIN_IMPERSONATION_ROLE_CODE,
  USER_IMPERSONATION_TYPE,
} from "../lib/superAdminUserGuards.js";

const router = express.Router();

router.post("/login", login);

router.get("/me", verifyJWT, async (req, res) => {
  const uid = req.user?.userId ?? req.user?.id;
  if (!uid) return res.status(401).json({ error: "Non authentifié" });
  const r = await pool.query(
    "SELECT id, email, organization_id, first_name, last_name FROM users WHERE id = $1",
    [uid]
  );
  if (r.rows.length === 0) return res.status(404).json({ error: "Utilisateur non trouvé" });
  const u = r.rows[0];
  const name = [u.first_name, u.last_name].filter(Boolean).join(" ").trim() || u.email;
  const isOrgImp = req.user?.role === SUPER_ADMIN_IMPERSONATION_ROLE_CODE;
  const isUserImp = String(req.user?.impersonationType) === USER_IMPERSONATION_TYPE;
  const effectiveOrg =
    isOrgImp || isUserImp ? (req.user.organizationId ?? req.user.organization_id) : u.organization_id;
  res.json({
    id: u.id,
    email: u.email,
    organizationId: effectiveOrg,
    firstName: u.first_name ?? null,
    lastName: u.last_name ?? null,
    name,
    superAdmin: req.user?.role === "SUPER_ADMIN",
    impersonation: Boolean(isOrgImp || isUserImp),
    impersonationType: isUserImp
      ? USER_IMPERSONATION_TYPE
      : isOrgImp
        ? "ORG"
        : undefined,
  });
});

router.get("/permissions", verifyJWT, async (req, res) => {
  try {
    const uid = req.user?.userId ?? req.user?.id;
    const org = req.user?.organizationId ?? req.user?.organization_id;
    if (!uid || !org) return res.status(401).json({ error: "Non authentifié" });
    if (req.user?.role === "SUPER_ADMIN") {
      return res.json({ permissions: ["*"], superAdmin: true });
    }
    if (req.user?.role === SUPER_ADMIN_IMPERSONATION_ROLE_CODE) {
      return res.json({
        permissions: ["*"],
        superAdmin: false,
        impersonation: true,
        impersonationType: "ORG",
      });
    }
    if (String(req.user?.impersonationType) === USER_IMPERSONATION_TYPE) {
      const perms = await getUserPermissions({ userId: uid, organizationId: org });
      return res.json({
        permissions: Array.from(perms),
        superAdmin: false,
        impersonation: true,
        impersonationType: "USER",
      });
    }
    const perms = await getUserPermissions({ userId: uid, organizationId: org });
    res.json({ permissions: Array.from(perms) });
  } catch (err) {
    console.error("GET /auth/permissions error:", err);
    res.status(500).json({
      error: err?.message || "Erreur chargement permissions",
      code: "PERMISSIONS_LOAD_FAILED"
    });
  }
});

export default router;
