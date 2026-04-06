import pg from "pg";
import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { getConnectionString } from "../config/database-url.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: resolve(__dirname, "../../.env.dev") });

const { Pool } = pg;

const pool = new Pool({
  connectionString: getConnectionString(),
});

async function createOrganization() {
  const client = await pool.connect();

  try {
    const existing = await client.query(
      "SELECT id FROM organizations WHERE name = $1 LIMIT 1",
      ["SolarGlobe"]
    );

    if (existing.rows.length > 0) {
      console.log("Organization already exists.");
      return;
    }

    const orgResult = await client.query(
      `INSERT INTO organizations (name, created_at)
       VALUES ($1, NOW())
       RETURNING id`,
      ["SolarGlobe"]
    );
    const orgId = orgResult.rows[0].id;

    const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");
    await ensureOrgRolesSeeded(orgId);

    console.log("Organization SolarGlobe created successfully.");
  } catch (err) {
    console.error("Error creating organization:", err.message);
  } finally {
    client.release();
    await pool.end();
  }
}

createOrganization();
