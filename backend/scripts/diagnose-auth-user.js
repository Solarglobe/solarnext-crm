/**
 * Diagnostic connexion : utilisateur, statut, hash, rôles legacy + RBAC.
 * Usage (depuis la racine repo ou backend, avec .env.dev / backend/.env chargés) :
 *   node scripts/diagnose-auth-user.js b.letren@solarglobe.fr
 */
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import pg from "pg";

const emailArg = process.argv[2] || process.env.DIAGNOSE_AUTH_EMAIL;
if (!emailArg) {
  console.error("Usage: node scripts/diagnose-auth-user.js <email>");
  process.exit(1);
}

const emailNorm = String(emailArg).toLowerCase().trim();

const { Pool } = pg;
if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL manquant — charger .env.dev ou backend/.env");
  process.exit(1);
}

const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function main() {
  const client = await pool.connect();
  try {
    const users = await client.query(
      `SELECT u.id, u.email, u.status, u.organization_id,
              (u.password_hash IS NOT NULL AND length(trim(u.password_hash)) > 0) AS has_password_hash
       FROM users u
       WHERE LOWER(TRIM(u.email)) = $1
       ORDER BY u.created_at DESC`,
      [emailNorm]
    );

    console.log("--- Utilisateurs (email normalisé) ---");
    console.log("email recherché:", JSON.stringify(emailNorm));
    console.log("lignes:", users.rows.length);
    if (users.rows.length === 0) {
      console.log("Aucun compte : email inconnu ou casse/espaces différents en base.");
      return;
    }

    for (const u of users.rows) {
      const ur = await client.query(
        `SELECT r.name
         FROM user_roles x
         JOIN roles r ON r.id = x.role_id
         WHERE x.user_id = $1`,
        [u.id]
      );
      const rbac = await client.query(
        `SELECT rr.code, rr.organization_id AS role_org
         FROM rbac_user_roles x
         JOIN rbac_roles rr ON rr.id = x.role_id
         WHERE x.user_id = $1`,
        [u.id]
      );
      console.log("\nid:", u.id);
      console.log("  email stocké:", u.email);
      console.log("  status:", u.status);
      console.log("  organization_id:", u.organization_id);
      console.log("  has_password_hash:", u.has_password_hash);
      console.log("  legacy roles (user_roles):", ur.rows.map((r) => r.name).join(", ") || "(aucun)");
      console.log(
        "  rbac roles:",
        rbac.rows.map((r) => `${r.code}@org=${r.role_org ?? "null"}`).join(", ") || "(aucun)"
      );
    }

    const anyActive = users.rows.filter((r) => r.status === "active");
    if (anyActive.length === 0) {
      console.log("\n⚠ Tous les comptes pour cet email sont inactifs → login 401.");
    }
    const anyRole = [];
    for (const u of users.rows) {
      const c1 = await client.query("SELECT 1 FROM user_roles WHERE user_id = $1 LIMIT 1", [u.id]);
      const c2 = await client.query("SELECT 1 FROM rbac_user_roles WHERE user_id = $1 LIMIT 1", [u.id]);
      if (c1.rows.length || c2.rows.length) anyRole.push(u.id);
    }
    if (anyRole.length === 0 && users.rows.some((r) => r.status === "active")) {
      console.log(
        "\n⚠ Compte(s) actif(s) mais aucun rôle legacy ni RBAC → le login renvoie 401 (LOGIN_NO_ROLE)."
      );
    }
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
