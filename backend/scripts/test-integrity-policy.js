/**
 * CP-032C — Tests non-régression politique d'intégrité
 * Usage: cd backend && node scripts/test-integrity-policy.js
 * Prérequis: Backend lancé (port 3000), DATABASE_URL, JWT_SECRET dans .env.dev
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";
import jwt from "jsonwebtoken";
import fetch from "node-fetch";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BASE_URL = "http://localhost:3000";
let token = null;
let orgId = null;
let passed = 0;
let failed = 0;

function ok(label) {
  console.log(`✅ ${label}`);
  passed++;
}

function fail(label, msg) {
  console.log(`❌ ${label}: ${msg}`);
  failed++;
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
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

function genToken(user) {
  return jwt.sign(
    { userId: user.id, organizationId: user.organization_id, role: user.role || "SUPER_ADMIN" },
    process.env.JWT_SECRET,
    { expiresIn: "1h" }
  );
}

async function run() {
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  const client = await pool.connect();

  try {
    const userRes = await client.query(`
      SELECT u.id, u.organization_id,
        (SELECT r.name FROM user_roles ur JOIN roles r ON ur.role_id = r.id WHERE ur.user_id = u.id LIMIT 1) as role
      FROM users u WHERE u.status = 'active' LIMIT 1
    `);
    const user = userRes.rows[0];
    if (!user) throw new Error("Aucun utilisateur actif");
    token = genToken(user);
    orgId = (await client.query("SELECT id FROM organizations LIMIT 1")).rows[0]?.id;
    if (!orgId) throw new Error("Aucune organisation");

    const sharedClientId = (await client.query(
      `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, `TEST-SHARED-${Date.now()}`, "Shared", "Test", "shared@test.com"]
    )).rows[0]?.id;
    if (!sharedClientId) throw new Error("Impossible de créer client partagé");

    // 1. Archiver un client → GET doit 404
    const clientIns = await client.query(
      `INSERT INTO clients (organization_id, client_number, first_name, last_name, email)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [orgId, `TEST-IP-${Date.now()}`, "Test", "Integrity", "test@test.com"]
    );
    const clientId = clientIns.rows[0].id;
    const archiveRes = await api("PATCH", `/api/clients/${clientId}/archive`);
    if (archiveRes.status !== 200) {
      fail("1. Archiver client", `archive failed ${archiveRes.status}`);
    } else {
      const getRes = await api("GET", `/api/clients/${clientId}`);
      if (getRes.status === 404) ok("1. Client archivé → GET 404");
      else fail("1. Client archivé → GET 404", `got ${getRes.status}`);
    }
    await client.query("DELETE FROM clients WHERE id = $1", [clientId]);

    // 2. Archiver une study → POST version doit 404
    const studyRes = await api("POST", "/api/studies", { client_id: sharedClientId });
    if (studyRes.status !== 201) {
      fail("2. Archiver study → POST version 404", `create study failed ${studyRes.status}`);
    } else {
      let studyId = studyRes.data?.study?.id ?? studyRes.data?.id;
      if (!studyId) {
        const lastStudy = await client.query(
          "SELECT id FROM studies WHERE organization_id = $1 ORDER BY created_at DESC LIMIT 1",
          [orgId]
        );
        studyId = lastStudy.rows[0]?.id;
      }
      if (!studyId) {
        fail("2. Archiver study → POST version 404", "no study id");
      } else {
        await api("PATCH", `/api/studies/${studyId}/archive`);
        const verRes = await api("POST", `/api/studies/${studyId}/versions`, { data: {} });
        if (verRes.status === 404) ok("2. Study archivée → POST version 404");
        else fail("2. Study archivée → POST version 404", `got ${verRes.status}`);
        await client.query("DELETE FROM study_versions WHERE study_id = $1", [studyId]);
        await client.query("DELETE FROM studies WHERE id = $1", [studyId]);
      }
    }

    // 3. Quote signed → PATCH doit 403
    const quoteRes = await api("POST", "/api/quotes", {
      client_id: sharedClientId,
      items: [{ label: "L1", quantity: 1, unit_price_ht: 100, tva_rate: 20 }]
    });
    const qId = quoteRes.data?.quote?.id;
    if (!qId) {
      fail("3. Quote signed → PATCH 403", "create quote failed");
    } else {
      await api("PATCH", `/api/quotes/${qId}/status`, { status: "sent" });
      await api("PATCH", `/api/quotes/${qId}/status`, { status: "signed" });
      const patchRes = await api("PATCH", `/api/quotes/${qId}`, { items: [] });
      if (patchRes.status === 403) ok("3. Quote signed → PATCH 403");
      else fail("3. Quote signed → PATCH 403", `got ${patchRes.status}`);
      await client.query("DELETE FROM quote_lines WHERE quote_id = $1", [qId]);
      await client.query("DELETE FROM quotes WHERE id = $1", [qId]);
    }

    // 4. Convert lead 2 fois → 400
    const leadStageId = (await client.query(
      "SELECT id FROM pipeline_stages WHERE organization_id = $1 LIMIT 1",
      [orgId]
    )).rows[0]?.id;
    const leadRes = await api("POST", "/api/leads", {
      first_name: "Conv", last_name: "Test", email: "conv@test.com", stage_id: leadStageId
    });
    const leadId = leadRes.data?.id;
    if (!leadId) {
      fail("4. Convert lead 2× → 400", "no lead created");
    } else {
      await api("POST", `/api/leads/${leadId}/convert`);
      const conv2Res = await api("POST", `/api/leads/${leadId}/convert`);
      if (conv2Res.status === 400) ok("4. Convert lead 2× → 400");
      else fail("4. Convert lead 2× → 400", `got ${conv2Res.status}`);
      const lc = (await client.query("SELECT client_id FROM leads WHERE id = $1", [leadId])).rows[0]?.client_id;
      if (lc) await client.query("DELETE FROM clients WHERE id = $1", [lc]);
      await client.query("DELETE FROM lead_stage_history WHERE lead_id = $1", [leadId]);
      await client.query("DELETE FROM leads WHERE id = $1", [leadId]);
    }

    // 5. Archive doc → download doit 404
    const entId = sharedClientId;
    const docIns = await client.query(
      `INSERT INTO entity_documents (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url)
       VALUES ($1, 'client', $2, 'test.pdf', 0, 'application/pdf', 'fake/path', 'local') RETURNING id`,
      [orgId, entId]
    );
    const docId = docIns.rows[0]?.id;
    if (docId) {
      await api("PATCH", `/api/documents/${docId}/archive`);
      const dlRes = await api("GET", `/api/documents/${docId}/download`);
      if (dlRes.status === 404) ok("5. Archive doc → download 404");
      else fail("5. Archive doc → download 404", `got ${dlRes.status}`);
      await client.query("DELETE FROM entity_documents WHERE id = $1", [docId]);
    } else fail("5. Archive doc → download 404", "no doc");

    // 6. Delete doc : FORCE_DELETE_FAIL → DB rollback
    process.env.FORCE_DELETE_FAIL = "1";
    const docIns2 = await client.query(
      `INSERT INTO entity_documents (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url)
       VALUES ($1, 'client', $2, 'test2.pdf', 0, 'application/pdf', 'fake/path2', 'local') RETURNING id`,
      [orgId, entId]
    );
    const docId2 = docIns2.rows[0]?.id;
    if (docId2) {
      const { deleteDocument } = await import("../services/documents.service.js");
      try {
        await deleteDocument(docId2, orgId);
        fail("6. Delete doc rollback", "should have thrown");
      } catch (e) {
        const still = await client.query("SELECT id FROM entity_documents WHERE id = $1", [docId2]);
        if (still.rows.length > 0) ok("6. Delete doc rollback");
        else fail("6. Delete doc rollback", "doc removed from DB");
      }
      delete process.env.FORCE_DELETE_FAIL;
      await client.query("DELETE FROM entity_documents WHERE id = $1", [docId2]);
    } else fail("6. Delete doc rollback", "no doc");

    console.log("\n--- Résultat ---");
    console.log(`Passés: ${passed}, Échoués: ${failed}`);
    await client.query("DELETE FROM clients WHERE id = $1", [sharedClientId]);
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
