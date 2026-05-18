import { pool } from "../config/db.js";

export async function requireEmailVerified(req, res, next) {
  const userId = req.user?.userId ?? req.user?.id;
  if (!userId) return res.status(401).json({ error: "Non authentifie" });

  if (req.user?.emailVerified === true || req.user?.email_verified === true) {
    return next();
  }

  try {
    const result = await pool.query(
      "SELECT COALESCE(email_verified, false) AS email_verified FROM users WHERE id = $1",
      [userId]
    );
    if (result.rows[0]?.email_verified === true) {
      req.user.emailVerified = true;
      req.user.email_verified = true;
      return next();
    }
    return res.status(403).json({
      error: "Email non verifie",
      code: "EMAIL_NOT_VERIFIED",
    });
  } catch (err) {
    return res.status(500).json({
      error: "Verification email impossible",
      code: "EMAIL_VERIFICATION_CHECK_FAILED",
    });
  }
}
