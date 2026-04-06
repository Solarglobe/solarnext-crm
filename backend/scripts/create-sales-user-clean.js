/**
 * Création du user SALES (même mécanisme que create-founder-admin.js)
 * Usage: node scripts/create-sales-user-clean.js
 * Prérequis: DATABASE_URL dans .env.dev
 */

const SALES_EMAIL = "sales@test.com";
const SALES_PASSWORD = "Test1234!";

import pg from "pg";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import dotenv from "dotenv";
import { hashPassword } from "../auth/auth.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.dev") });

if (!process.env.DATABASE_URL) {
  console.error("DATABASE_URL manquant. Vérifiez .env.dev");
  process.exit(1);
}

const { Client } = pg;

async function run() {
  const client = new Client({ connectionString: process.env.DATABASE_URL });
  await client.connect();

  try {
    await client.query(`DELETE FROM users WHERE email = 'sales@test.com'`);

    let roleId = (
      await client.query("SELECT id FROM roles WHERE name = $1", ["SALES"])
    ).rows[0]?.id;

    if (!roleId) {
      const insertRole = await client.query(
        "INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING id",
        ["SALES", "Sales"]
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

    const passwordHash = await hashPassword(SALES_PASSWORD);
    const insertUser = await client.query(
      `INSERT INTO users (organization_id, email, password_hash, status, created_at)
       VALUES ($1, $2, $3, 'active', CURRENT_TIMESTAMP)
       RETURNING id`,
      [organizationId, SALES_EMAIL, passwordHash]
    );
    const userId = insertUser.rows[0].id;

    await client.query(
      "INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2)",
      [userId, roleId]
    );

    const rbacSales = await client.query(
      "SELECT id FROM rbac_roles WHERE organization_id IS NULL AND code = $1",
      ["SALES"]
    );
    if (rbacSales.rows.length > 0) {
      await client.query(
        "INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING",
        [userId, rbacSales.rows[0].id]
      );
    }

    console.log("Sales user created successfully");
  } finally {
    await client.end();
  }
}

run().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
