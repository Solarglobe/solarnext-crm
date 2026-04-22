/**
 * CP-071 — Envoi SMTP (test + envoi métier).
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import { testSmtpConnection, SmtpErrorCodes, mapSmtpError } from "../services/mail/smtp.service.js";
import { sensitiveUserRateLimiter } from "../middleware/security/rateLimit.presets.js";

const router = express.Router();

function smtpHttpStatus(code) {
  if (code === SmtpErrorCodes.AUTH_FAILED) return 401;
  if (code === SmtpErrorCodes.SMTP_UNAVAILABLE) return 503;
  if (code === SmtpErrorCodes.INVALID_CONFIG) return 400;
  if (code === SmtpErrorCodes.SEND_FAILED) return 502;
  return 500;
}

function handleSmtpRouteError(res, err) {
  if (err?.code && Object.values(SmtpErrorCodes).includes(err.code)) {
    return res.status(smtpHttpStatus(err.code)).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }
  try {
    mapSmtpError(err);
  } catch (e2) {
    if (e2?.code && Object.values(SmtpErrorCodes).includes(e2.code)) {
      return res.status(smtpHttpStatus(e2.code)).json({
        success: false,
        code: e2.code,
        message: e2.message,
      });
    }
  }
  return res.status(500).json({ success: false, code: "UNKNOWN", message: String(err) });
}

router.post("/send/test", verifyJWT, requireMailUseStrict(), sensitiveUserRateLimiter, async (req, res) => {
  try {
    const { smtp_host, smtp_port, smtp_secure, email, password } = req.body || {};
    if (!smtp_host || smtp_port == null || !email || !password) {
      return res.status(400).json({
        success: false,
        code: SmtpErrorCodes.INVALID_CONFIG,
        message: "smtp_host, smtp_port, email et password requis",
      });
    }
    await testSmtpConnection({
      smtp_host,
      smtp_port,
      smtp_secure,
      email,
      password,
    });
    return res.json({ success: true });
  } catch (err) {
    return handleSmtpRouteError(res, err);
  }
});

/** POST /send — déplacé vers routes/mail.routes.js (CP-076). */

export default router;
