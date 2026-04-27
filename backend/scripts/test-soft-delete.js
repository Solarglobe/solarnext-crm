/**
 * CP-032A — Test Soft Delete & Archivage
 * Vérifie : création client, archive, GET 404, restore, GET OK
 * Lancer avec: node --env-file=./.env scripts/test-soft-delete.js
 * ou: node -r dotenv/config scripts/test-soft-delete.js dotenv_config_path=./.env
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import pg from "pg";
import { archiveEntity, restoreEntity } from "../services/archive.service.js";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

async function run() {
  const client = await pool.connect();
  let passed = 0;
  let failed = 0;

  try {
    // Récupérer org et user
    const orgRes = await client.query("SELECT id FROM organizations LIMIT 1");
    const userRes = await client.query("SELECT id FROM users LIMIT 1");
    if (orgRes.rows.length === 0 || userRes.rows.length === 0) {
      console.log("SKIP: Aucune organisation ou utilisateur en base");
      process.exit(0);
    }
    const orgId = orgRes.rows[0].id;
    const userId = userRes.rows[0].id;

    // 1. Créer client
    const ins = await client.query(
      `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
       VALUES ($1, $2, $3, $4, $5) RETURNING id, archived_at`,
      [orgId, `TEST-SD-${Date.now()}`, "Test", "SoftDelete", "test@test.com"]
    );
    const clientId = ins.rows[0].id;
    if (ins.rows[0].archived_at) {
      console.log("FAIL: archived_at devrait être NULL à la création");
      failed++;
    } else {
      console.log("OK: Client créé, archived_at NULL");
      passed++;
    }

    // 2. Vérifier GET (doit trouver)
    const get1 = await client.query(
      "SELECT id FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
      [clientId, orgId]
    );
    if (get1.rows.length === 0) {
      console.log("FAIL: Client non trouvé avant archivage");
      failed++;
    } else {
      console.log("OK: Client trouvé avant archivage");
      passed++;
    }

    // 3. Archiver
    const archived = await archiveEntity("clients", clientId, orgId, userId);
    if (!archived || !archived.archived_at) {
      console.log("FAIL: archiveEntity n'a pas set archived_at");
      failed++;
    } else {
      console.log("OK: Client archivé, archived_at set");
      passed++;
    }

    // 4. GET doit 404 (exclu par filtre)
    const get2 = await client.query(
      "SELECT id FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
      [clientId, orgId]
    );
    if (get2.rows.length > 0) {
      console.log("FAIL: Client archivé encore visible (devrait 404)");
      failed++;
    } else {
      console.log("OK: Client archivé exclu des requêtes normales");
      passed++;
    }

    // 5. Restore
    const restored = await restoreEntity("clients", clientId, orgId);
    if (!restored || restored.archived_at) {
      console.log("FAIL: restoreEntity n'a pas clear archived_at");
      failed++;
    } else {
      console.log("OK: Client restauré, archived_at NULL");
      passed++;
    }

    // 6. GET doit OK
    const get3 = await client.query(
      "SELECT id FROM clients WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
      [clientId, orgId]
    );
    if (get3.rows.length === 0) {
      console.log("FAIL: Client non trouvé après restore");
      failed++;
    } else {
      console.log("OK: Client trouvé après restore");
      passed++;
    }

    // Nettoyage
    await client.query("DELETE FROM clients WHERE id = $1", [clientId]);

    console.log("\n--- Résultat ---");
    console.log(`Passés: ${passed}, Échoués: ${failed}`);
    process.exit(failed > 0 ? 1 : 0);
  } catch (e) {
    console.error("ERREUR:", e.message);
    process.exit(1);
  } finally {
    client.release();
    pool.end();
  }
}

run();
