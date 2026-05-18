import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { authStrictRateLimiter, registerRateLimiter } from "../middleware/rateLimit.middleware.js";
import {
  forgotPassword,
  confirmMfaSetup,
  disableMfa,
  getMfaStatus,
  login,
  logout,
  register,
  refresh,
  resendVerificationEmail,
  resetPassword,
  startMfaSetup,
  validateResetPasswordToken,
  verifyMfaLogin,
  verifyEmail,
} from "../auth/auth.controller.js";
import { pool } from "../config/db.js";
import { getUserPermissions } from "../rbac/rbac.service.js";
import {
  SUPER_ADMIN_IMPERSONATION_ROLE_CODE,
  USER_IMPERSONATION_TYPE,
} from "../lib/superAdminUserGuards.js";

const router = express.Router();

router.post("/login", authStrictRateLimiter, login);
router.post("/refresh", authStrictRateLimiter, refresh);
router.post("/logout", authStrictRateLimiter, logout);
router.get("/verify-email", authStrictRateLimiter, verifyEmail);
router.post("/resend-verification-email", verifyJWT, authStrictRateLimiter, resendVerificationEmail);
router.post("/forgot-password", authStrictRateLimiter, forgotPassword);
router.get("/reset-password/:token", authStrictRateLimiter, validateResetPasswordToken);
router.post("/reset", authStrictRateLimiter, resetPassword);
router.post("/reset-password", authStrictRateLimiter, resetPassword);
router.post("/register", registerRateLimiter, register);
router.post("/mfa/login/verify", authStrictRateLimiter, verifyMfaLogin);
router.get("/mfa/status", verifyJWT, getMfaStatus);
router.post("/mfa/setup/start", verifyJWT, authStrictRateLimiter, startMfaSetup);
router.post("/mfa/setup/confirm", verifyJWT, authStrictRateLimiter, confirmMfaSetup);
router.post("/mfa/disable", verifyJWT, authStrictRateLimiter, disableMfa);

router.get("/me", verifyJWT, async (req, res) => {
  const uid = req.user?.userId ?? req.user?.id;
  if (!uid) return res.status(401).json({ error: "Non authentifié" });
  const r = await pool.query(
    `SELECT u.id, u.email, u.organization_id, u.first_name, u.last_name,
            COALESCE(u.email_verified, false) AS email_verified,
            COALESCE(u.mfa_enabled, false) AS mfa_enabled,
            COALESCE(o.require_mfa, false) AS organization_require_mfa
     FROM users u
     JOIN organizations o ON o.id = u.organization_id
     WHERE u.id = $1`,
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
    emailVerified: u.email_verified === true,
    mfaEnabled: u.mfa_enabled === true,
    organizationRequiresMfa: u.organization_require_mfa === true,
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
