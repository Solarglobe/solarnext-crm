/**
 * Crée un utilisateur SUPER_ADMIN (legacy user_roles + RBAC global) si l’email n’existe pas encore.
 *
 * Usage (PowerShell) :
 *   cd backend
 *   $env:SUPER_ADMIN_PASSWORD="VotreMotDePasse"; node scripts/create-super-admin-user.mjs admin@example.com
 *
 * Variables optionnelles :
 *   SUPER_ADMIN_EMAIL   — sinon 1er argument positionnel
 *   SUPER_ADMIN_PASSWORD — obligatoire (jamais en dur dans le dépôt)
 */

import "../config/load-env.js";
import pg from "pg";
import { hashPassword } from "../auth/auth.service.js";

const emailArg = process.env.SUPER_ADMIN_EMAIL || process.argv[2];
const password = process.env.SUPER_ADMIN_PASSWORD;

function normEmail(s) {
  return String(s || "")
    .toLowerCase()
    .trim();
}

async function resolveLoginRole(client, userId) {
  const ROLE_PRIORITY_OUTER = `
    CASE role_val
      WHEN 'SUPER_ADMIN' THEN 1
      WHEN 'ADMIN' THEN 2
      WHEN 'SALES_MANAGER' THEN 3
      WHEN 'SALES' THEN 4
      WHEN 'TECHNICIEN' THEN 5
      WHEN 'ASSISTANTE' THEN 6
      WHEN 'APPORTEUR' THEN 7
      ELSE 99
    END
  `;
  const r = await client.query(
    `SELECT role_val AS role
     FROM (
       SELECT r.name AS role_val
       FROM user_roles ur
       JOIN roles r ON r.id = ur.role_id
       WHERE ur.user_id = $1
       UNION ALL
       SELECT rr.code AS role_val
       FROM rbac_user_roles rur
       JOIN rbac_roles rr ON rr.id = rur.role_id
       WHERE rur.user_id = $1
     ) s
     ORDER BY ${ROLE_PRIORITY_OUTER} ASC, role_val ASC
     LIMIT 1`,
    [userId]
  );
  return r.rows[0]?.role ?? null;
}

async function main() {
  const email = normEmail(emailArg);
  if (!email) {
    console.error("Usage: SUPER_ADMIN_PASSWORD=... node scripts/create-super-admin-user.mjs <email>");
    process.exit(1);
  }
  if (!password || String(password).length === 0) {
    console.error("SUPER_ADMIN_PASSWORD est requis (variable d’environnement).");
    process.exit(1);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL manquant — charger .env.dev / backend/.env");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const existing = await client.query(
      `SELECT id, email, status FROM users WHERE LOWER(TRIM(email)) = $1 ORDER BY created_at DESC LIMIT 1`,
      [email]
    );
    if (existing.rows.length > 0) {
      const u = existing.rows[0];
      console.log(`Utilisateur déjà existant — aucune création (id: ${u.id}, status: ${u.status}).`);
      const role = await resolveLoginRole(client, u.id);
      console.log(`Rôle effectif actuel (login): ${role ?? "(aucun)"}`);
      if (role === "SUPER_ADMIN") {
        console.log("OK — compte déjà SUPER_ADMIN.");
      } else {
        console.log(
          "ℹ Ce compte n’est pas SUPER_ADMIN. Ce script ne modifie pas les rôles des comptes existants."
        );
      }
      return;
    }

    let roleId = (await client.query("SELECT id FROM roles WHERE name = $1", ["SUPER_ADMIN"])).rows[0]?.id;
    if (!roleId) {
      const insertRole = await client.query(
        "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id",
        ["SUPER_ADMIN", "Full system access"]
      );
      roleId = insertRole.rows[0].id;
    }

    const orgs = await client.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1");
    if (orgs.rows.length === 0) {
      console.error("Aucune organisation en base. Créez une organisation d’abord.");
      process.exit(1);
    }
    const organizationId = orgs.rows[0].id;

    const passwordHash = await hashPassword(password);
    const insertUser = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, status, created_at)
       VALUES ($1, $2, $3, 'active', CURRENT_TIMESTAMP)
       RETURNING id`,
      [organizationId, email, passwordHash]
    );
    const userId = insertUser.rows[0].id;

    await client.query("INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)", [userId, roleId]);

    const rbacSuperAdmin = await client.query(
      "SELECT id FROM rbac_roles WHERE organization_id IS NULL AND code = $1",
      ["SUPER_ADMIN"]
    );
    if (rbacSuperAdmin.rows.length > 0) {
      await client.query(
        `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
        [userId, rbacSuperAdmin.rows[0].id]
      );
    } else {
      console.warn(
        "⚠ Aucun rbac_roles SUPER_ADMIN global — rôle RBAC non assigné (legacy SUPER_ADMIN tout de même)."
      );
    }

    const role = await resolveLoginRole(client, userId);
    console.log("");
    console.log("Compte SUPER_ADMIN créé.");
    console.log(`  user id: ${userId}`);
    console.log(`  email:   ${email}`);
    console.log(`  org id:  ${organizationId}`);
    console.log(`  rôle login (priorité): ${role}`);
    if (role !== "SUPER_ADMIN") {
      console.error("ERREUR: le rôle effectif attendu était SUPER_ADMIN.");
      process.exit(1);
    }
    console.log("");
    console.log("Vérification attendue pour GET /auth/permissions (avec JWT après login):");
    console.log('  { "permissions": ["*"], "superAdmin": true }');
  } finally {
    client.release();
    await pool.end();
  }
}

main().catch((e) => {
  console.error(e?.message || e);
  process.exit(1);
});
