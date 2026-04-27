/**
 * CP-028 — Tests conversion Lead → Client
 *
 * Tester :
 * - Création lead
 * - Conversion (POST /api/leads/:id/convert)
 * - Vérifier : client créé, lead.client_id rempli, status = converted, historique inséré
 * - Tentative double conversion → doit échouer (400)
 *
 * Usage: node scripts/test-lead-convert.js
 * Prérequis: Backend lancé (port 3000), DATABASE_URL et JWT_SECRET dans .env.dev
 */

import "../config/register-local-env.js";
import dotenv from "dotenv";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// Chemin vers la RACINE du projet (2 niveaux au-dessus)
const rootEnvPath = path.resolve(__dirname, "../../.env.dev");

if (!process.env.DATABASE_URL || !process.env.JWT_SECRET) {
  const result = dotenv.config({ path: rootEnvPath, override: false });
  if (result.error) {
    console.error("❌ Impossible de charger .env.dev à :", rootEnvPath);
    throw result.error;
  }
  console.log("✅ .env chargé depuis :", rootEnvPath);
}

if (!process.env.DATABASE_URL) {
  throw new Error("DATABASE_URL manquant — vérifier backend/.env.dev");
}

if (!process.env.JWT_SECRET) {
  throw new Error("JWT_SECRET manquant — vérifier backend/.env.dev");
}

const BASE_URL = "http://localhost:3000";

let token = null;
let leadId = null;
let orgId = null;
let stageId = null;

function generateTestToken(user) {
  return jwt.sign(
    {
      userId: user.id,
      organizationId: user.organization_id,
      role: user.role || "SUPER_ADMIN"
    },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function api(method, path, body = null) {
  const opts = {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`
    }
  };
  if (body && (method === "POST" || method === "PATCH" || method === "PUT")) {
    opts.body = JSON.stringify(body);
  }
  const res = await fetch(`${BASE_URL}${path}`, opts);
  return { res, data: await res.json().catch(() => ({})) };
}

function ok(label, detail = "") {
  console.log(`✅ ${label}${detail ? ` — ${detail}` : ""}`);
}

function fail(label, err) {
  console.log(`❌ ${label}`);
  console.log(`   ${err}`);
}

async function run() {
  console.log("\n=== CP-028 — Tests Lead Convert ===\n");

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const userResult = await client.query(`
      SELECT u.id, u.organization_id,
        (SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = u.id LIMIT 1) as role
      FROM users u
      WHERE u.status = 'active'
      LIMIT 1
    `);
    const testUser = userResult.rows[0];
    if (!testUser) throw new Error("Aucun utilisateur actif en base. Exécutez create-founder-admin.js.");
    token = generateTestToken(testUser);
    ok("Token généré");

    orgId = (await client.query("SELECT id FROM organizations ORDER BY created_at ASC LIMIT 1")).rows[0]?.id;
    if (!orgId) throw new Error("Aucune organisation.");

    stageId = (await client.query(
      "SELECT id FROM pipeline_stages WHERE organization_id = $1 ORDER BY position ASC LIMIT 1",
      [orgId]
    )).rows[0]?.id;
    if (!stageId) throw new Error("Aucun stage pipeline.");

    // --- TEST 1: Création lead ---
    const createRes = await api("POST", "/api/leads", {
      first_name: "Convert",
      last_name: "Test",
      email: "convert-test@test.local",
      phone: "+33612345678",
      stage_id: stageId
    });
    if (!createRes.res.ok) {
      fail("TEST 1: Création lead", createRes.data.error || createRes.res.status);
      return;
    }
    leadId = createRes.data.id;
    ok("TEST 1: Création lead", `id=${leadId}`);

    // --- TEST 2: Conversion ---
    const convertRes = await api("POST", `/api/leads/${leadId}/convert`);
    if (!convertRes.res.ok) {
      fail("TEST 2: Conversion", convertRes.data.error || convertRes.res.status);
      return;
    }
    const { client: createdClient, lead: updatedLead } = convertRes.data;
    if (!createdClient?.id) {
      fail("TEST 2: Conversion", "client manquant dans la réponse");
      return;
    }
    ok("TEST 2: Conversion", `client_id=${createdClient.id}`);

    // --- TEST 3: Vérifier client créé ---
    const clientCheck = await client.query(
      "SELECT * FROM clients WHERE id = $1 AND organization_id = $2",
      [createdClient.id, orgId]
    );
    if (clientCheck.rows.length === 0) {
      fail("TEST 3: Client créé", "Client non trouvé en base");
    } else {
      const c = clientCheck.rows[0];
      if (!c.client_number?.startsWith("SG-")) fail("TEST 3: client_number", `format invalide: ${c.client_number}`);
      else ok("TEST 3: Client créé", `client_number=${c.client_number}`);
    }

    // --- TEST 4: Vérifier lead.client_id et status ---
    const leadCheck = await client.query("SELECT client_id, status FROM leads WHERE id = $1", [leadId]);
    if (leadCheck.rows.length === 0) {
      fail("TEST 4: Lead mis à jour", "Lead non trouvé");
    } else {
      const l = leadCheck.rows[0];
      if (l.client_id !== createdClient.id) fail("TEST 4: lead.client_id", `attendu ${createdClient.id}, reçu ${l.client_id}`);
      else if (l.status !== "converted") fail("TEST 4: lead.status", `attendu converted, reçu ${l.status}`);
      else ok("TEST 4: Lead mis à jour", `client_id=${l.client_id}, status=${l.status}`);
    }

    // --- TEST 5: Historique inséré ---
    const histCheck = await client.query(
      "SELECT * FROM lead_stage_history WHERE lead_id = $1 ORDER BY changed_at DESC LIMIT 1",
      [leadId]
    );
    if (histCheck.rows.length === 0) {
      fail("TEST 5: Historique", "Aucune entrée");
    } else {
      const h = histCheck.rows[0];
      const hasNote = h.note && h.note.includes("converti");
      ok("TEST 5: Historique inséré", hasNote ? `note=${h.note}` : "entrée présente");
    }

    // --- TEST 6: Double conversion (lead déjà converti) → doit échouer 400 ---
    const convert2Res = await api("POST", `/api/leads/${leadId}/convert`);
    if (convert2Res.res.ok) {
      fail("TEST 6: Double conversion", "Devrait échouer (400)");
    } else {
      ok("TEST 6: Double conversion rejetée", `status=${convert2Res.res.status}`);
    }

    console.log("\n=== Fin des tests ===\n");
  } finally {
    if (leadId) {
      const leadRow = await client.query("SELECT client_id FROM leads WHERE id = $1", [leadId]).then((r) => r.rows[0]);
      if (leadRow?.client_id) await client.query("DELETE FROM clients WHERE id = $1", [leadRow.client_id]);
      await client.query("DELETE FROM lead_stage_history WHERE lead_id = $1", [leadId]);
      await client.query("DELETE FROM leads WHERE id = $1", [leadId]);
    }
    client.release();
    await pool.end();
  }
}

run().catch((e) => {
  console.error("Erreur:", e.message);
  process.exit(1);
});
