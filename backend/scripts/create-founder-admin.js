/**
 * CP-025 — Création du premier admin fondateur
 * Usage: node scripts/create-founder-admin.js
 * Prérequis: DATABASE_URL dans .env.dev
 */

// 🔐 À REMPLIR AVANT EXÉCUTION
const ADMIN_EMAIL = "b.letren@solarglobe.fr";
const ADMIN_PASSWORD = "@Goofy29041997";

import "../config/register-local-env.js";
import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { hashPassword } from "../auth/auth.service.js";
import { getConnectionString } from "../config/database-url.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL manquant. Vérifiez .env.dev");
  process.exit(1);
}

const { Client } = pg;

async function run() {
  const client = new Client({ connectionString: getConnectionString() });
  await client.connect();

  try {
    const existing = await client.query(
      "SELECT id FROM users WHERE email = $1",
      [ADMIN_EMAIL]
    );
    if (existing.rows.length > 0) {
      console.log("Founder admin already exists");
      return;
    }

    let roleId = (
      await client.query("SELECT id FROM roles WHERE name = $1", ["SUPER_ADMIN"])
    ).rows[0]?.id;

    if (!roleId) {
      const insertRole = await client.query(
        "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id",
        ["SUPER_ADMIN", "Full system access"]
      );
      roleId = insertRole.rows[0].id;
    }

    const orgs = await client.query(
      "SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1"
    );
    if (orgs.rows.length === 0) {
      console.error("Aucune organisation existante. Créez une organisation d'abord.");
      process.exit(1);
    }
    const organizationId = orgs.rows[0].id;

    const passwordHash = await hashPassword(ADMIN_PASSWORD);
    const insertUser = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, status, created_at)
       VALUES ($1, $2, $3, 'active', CURRENT_TIMESTAMP)
       RETURNING id`,
      [organizationId, ADMIN_EMAIL, passwordHash]
    );
    const userId = insertUser.rows[0].id;

    await client.query(
      "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
      [userId, roleId]
    );

    const rbacSuperAdmin = await client.query(
      "SELECT id FROM rbac_roles WHERE organization_id IS NULL AND code = $1",
      ["SUPER_ADMIN"]
    );
    if (rbacSuperAdmin.rows.length > 0) {
      await client.query(
        "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
        [userId, rbacSuperAdmin.rows[0].id]
      );
    }

    console.log("Founder admin created successfully");
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
