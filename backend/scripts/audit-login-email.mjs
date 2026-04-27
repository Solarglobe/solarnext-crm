/**
 * Usage : railway run node scripts/audit-login-email.mjs <email>
 * Local : node --env-file=.env scripts/audit-login-email.mjs <email>
 */
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { pool } from "../config/db.js";

const email = process.argv[2];
if (!email) {
  console.error("Usage: node scripts/audit-login-email.mjs <email>");
  process.exit(1);
}

const r = await pool.query(
  `SELECT u.id, u.email, u.organization_id, u.status, u.created_at, o.name AS org_name
   FROM users u
   LEFT JOIN organizations o ON o.id = u.organization_id
   WHERE LOWER(TRIM(u.email)) = LOWER(TRIM($1))
   ORDER BY u.created_at`,
  [email]
);
console.log(JSON.stringify(r.rows, null, 2));
console.log("count:", r.rows.length);
await pool.end();
