import { pool } from "../config/db.js";
import { comparePassword, generateJWT } from "./auth.service.js";
import logger from "../app/core/logger.js";

export async function login(req, res) {
  if (process.env.NODE_ENV !== "production") {
    console.log("LOGIN START");
    const b = req.body ?? {};
    console.log("LOGIN BODY:", { ...b, password: b.password ? "[redacted]" : undefined });
  }

  const { email, password } = req.body ?? {};

  if (!email || !password) {
    return res.status(400).json({ error: "email et password requis" });
  }

  let client;
  try {
    client = await pool.connect();
    // CP-ADMIN-ARCH-01 : ORDER BY pour JWT.role stable (priorité rôle le plus élevé)
    const result = await client.query(
      `SELECT u.id, u.email, u.organization_id, u.password_hash, r.name as role
       FROM users u
       JOIN user_roles ur ON u.id = ur.user_id
       JOIN roles r ON ur.role_id = r.id
       WHERE u.email = $1 AND u.status = 'active'
       ORDER BY CASE r.name
         WHEN 'SUPER_ADMIN' THEN 1
         WHEN 'ADMIN' THEN 2
         WHEN 'SALES_MANAGER' THEN 3
         WHEN 'SALES' THEN 4
         WHEN 'TECHNICIEN' THEN 5
         WHEN 'ASSISTANTE' THEN 6
         WHEN 'APPORTEUR' THEN 7
         ELSE 99
       END
       LIMIT 1`,
      [email.toLowerCase().trim()]
    );

    const user = result.rows[0];
    if (!user) {
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    if (!user.password_hash) {
      logger.warn("LOGIN_NO_PASSWORD_HASH", { userId: user.id });
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    const valid = await comparePassword(password, user.password_hash);
    if (!valid) {
      return res.status(401).json({ error: "Identifiants invalides" });
    }

    await client.query(
      "UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = $1",
      [user.id]
    );

    const token = generateJWT(user);
    return res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        role: user.role,
        organizationId: user.organization_id
      }
    });
  } catch (err) {
    console.error("LOGIN ERROR:", err);
    logger.error("LOGIN_ERROR", { err: err?.message, stack: err?.stack });
    if (!res.headersSent) {
      const message = err?.message || (err && String(err)) || "Erreur serveur";
      return res.status(500).json({ error: message });
    }
  } finally {
    if (client) client.release();
  }
}
