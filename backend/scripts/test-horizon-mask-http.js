/**
 * CP-DSM-PDF-006 — Test HTTP route horizon-mask (serveur doit être démarré)
 * Usage: cd backend && node scripts/test-horizon-mask-http.js
 * Prérequis: backend tourne sur port 3000, DB avec au moins 1 study+lead+address (lat/lon)
 */

import "../config/register-local-env.js";
import { dirname } from "path";
import { fileURLToPath } from "url";
import { pool } from "../config/db.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const BASE = process.env.API_BASE || "http://localhost:3000";

async function authHeaderForInternalPdf() {
  const email = process.env.TEST_ADMIN_EMAIL || process.env.TEST_LOGIN_EMAIL || process.env.CP077_ADMIN_EMAIL;
  const password = process.env.TEST_ADMIN_PASSWORD || process.env.TEST_LOGIN_PASSWORD || process.env.CP077_ADMIN_PASSWORD;
  if (!email || !password) return {};
  const r = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.token) return {};
  return { Authorization: `Bearer ${j.token}` };
}

async function run() {
  console.log("\n=== Test HTTP /internal/pdf/horizon-mask ===\n");

  let studyId, orgId;
  const r = await pool.query(
    `SELECT s.id as study_id, s.organization_id
     FROM studies s
     JOIN leads l ON l.id = s.lead_id AND l.organization_id = s.organization_id
     JOIN addresses a ON a.id = l.site_address_id AND a.lat IS NOT NULL AND a.lon IS NOT NULL
     WHERE s.organization_id = l.organization_id
     LIMIT 1`
  );
  if (r.rows.length === 0) {
    console.log("⚠ Aucune study avec lead+address géolocalisée — skip test HTTP");
    await pool.end();
    return;
  }
  studyId = r.rows[0].study_id;
  orgId = r.rows[0].organization_id;

  const url = `${BASE}/internal/pdf/horizon-mask/${studyId}?orgId=${orgId}&version=1`;
  console.log("GET", url);

  const auth = await authHeaderForInternalPdf();
  if (!auth.Authorization) {
    console.log("⚠ TEST_ADMIN_EMAIL + TEST_ADMIN_PASSWORD (ou équivalent) requis pour JWT — skip test HTTP");
    await pool.end();
    return;
  }

  const res = await fetch(url, { headers: auth });
  const contentType = res.headers.get("content-type") || "";
  const buf = await res.arrayBuffer();
  const size = buf.byteLength;

  if (!res.ok) {
    const text = new TextDecoder().decode(buf);
    console.log("❌ FAIL — Status:", res.status, "Body:", text.slice(0, 200));
    await pool.end();
    process.exit(1);
  }

  if (!contentType.includes("application/pdf")) {
    console.log("❌ FAIL — Content-Type attendu application/pdf, reçu:", contentType);
    await pool.end();
    process.exit(1);
  }

  const header = new TextDecoder("ascii").decode(new Uint8Array(buf).slice(0, 5));
  if (header !== "%PDF-") {
    console.log("❌ FAIL — Magic PDF invalide:", header);
    await pool.end();
    process.exit(1);
  }

  if (size < 20 * 1024) {
    console.log("⚠ PDF < 20 KB:", Math.round(size / 1024), "KB");
  }

  console.log("✅ PASS — Status 200, Content-Type application/pdf, taille", Math.round(size / 1024), "KB");
  await pool.end();
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
