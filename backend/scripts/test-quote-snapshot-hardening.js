/**
 * CP-QUOTE-005 — Tests sécurisation snapshot (anti rétroactif) + multi-org
 * A) Snapshot immuable si catalogue change
 * B) PATCH malveillant (snapshot_json / catalog_item_id) => 400
 * C) catalog_item_id immuable en DB (trigger)
 * D) Multi-org isolation
 * Usage: cd backend && node scripts/test-quote-snapshot-hardening.js
 */

import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { spawn } from "child_process";
import { execSync } from "child_process";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_DIR = resolve(__dirname, "..");


process.env.PGHOST = process.env.PGHOST || "localhost";
let dbHost = process.env.PGHOST;
if (process.env.DATABASE_URL) {
  try {
    const url = new URL(process.env.DATABASE_URL);
    if (url.hostname === "db" || url.hostname === "postgres") {
      url.hostname = "localhost";
      process.env.DATABASE_URL = url.toString();
    }
    dbHost = url.hostname;
  } catch (_) {}
}
console.log("DB host utilisé:", dbHost);

const USE_EXTERNAL_SERVER = Boolean(process.env.SERVER_URL);
const TEST_PORT = Number(process.env.TEST_PORT) || 5057;
const BASE_URL = USE_EXTERNAL_SERVER
  ? process.env.SERVER_URL.replace(/\/$/, "")
  : `http://localhost:${TEST_PORT}`;

const SUPER_ADMIN = {
  email: (process.env.TEST_SUPER_ADMIN_EMAIL || process.env.TEST_EMAIL || "b.letren@solarglobe.fr").trim(),
  password: (process.env.TEST_SUPER_ADMIN_PASSWORD || process.env.TEST_PASSWORD || "@Goofy29041997").trim(),
};

function ok(label) {
  console.log(`✅ ${label}`);
}
function fail(label, msg) {
  console.log(`❌ ${label}: ${msg}`);
}

function killProcessOnPort(port) {
  const isWin = process.platform === "win32";
  try {
    if (isWin) {
      const out = execSync(`netstat -ano | findstr :${port}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const lines = out.trim().split("\n").filter((l) => l.includes("LISTENING"));
      const pids = new Set();
      for (const line of lines) {
        const parts = line.trim().split(/\s+/);
        const pid = parts[parts.length - 1];
        if (pid && pid !== "0" && /^\d+$/.test(pid)) pids.add(pid);
      }
      for (const pid of pids) {
        execSync(`taskkill /PID ${pid} /F`, { stdio: "ignore" });
      }
    } else {
      const out = execSync(`lsof -ti :${port}`, {
        encoding: "utf8",
        stdio: ["pipe", "pipe", "pipe"],
      });
      const pids = out.trim().split(/\s+/).filter(Boolean);
      for (const pid of pids) {
        execSync(`kill -9 ${pid}`, { stdio: "ignore" });
      }
    }
  } catch (_) {}
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  if (!data.token) {
    throw new Error(`Login échoué (${res.status}): ${data.error || JSON.stringify(data)}`);
  }
  return { token: data.token, organizationId: data.user?.organizationId ?? data.user?.organization_id };
}

async function api(token, method, path, body) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function ensureCp004Columns(pool) {
  const client = await pool.connect();
  try {
    const res = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines'`
    );
    const existing = new Set(res.rows.map((r) => r.column_name));
    if (existing.has("catalog_item_id")) return;
    await client.query(`
      ALTER TABLE quote_lines
        ADD COLUMN IF NOT EXISTS catalog_item_id uuid REFERENCES quote_catalog_items(id) ON DELETE SET NULL,
        ADD COLUMN IF NOT EXISTS snapshot_json jsonb,
        ADD COLUMN IF NOT EXISTS purchase_unit_price_ht_cents integer,
        ADD COLUMN IF NOT EXISTS vat_rate_bps integer,
        ADD COLUMN IF NOT EXISTS pricing_mode quote_catalog_pricing_mode,
        ADD COLUMN IF NOT EXISTS is_optional boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS is_active boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS updated_at timestamptz DEFAULT now()
    `);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_quote_lines_quote_id ON quote_lines(quote_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_quote_lines_organization_id ON quote_lines(organization_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_quote_lines_catalog_item_id ON quote_lines(catalog_item_id)`);
  } catch (e) {
    if (e.code === "42704" || e.message?.includes("quote_catalog_pricing_mode")) {
      await client.query(`DO $$ BEGIN CREATE TYPE quote_catalog_pricing_mode AS ENUM ('FIXED', 'UNIT', 'PERCENT_TOTAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await client.query(`ALTER TABLE quote_lines ADD COLUMN IF NOT EXISTS pricing_mode quote_catalog_pricing_mode`);
    } else {
      throw e;
    }
  } finally {
    client.release();
  }
}

/** Applique idempotemment le hardening CP-QUOTE-005 (trigger + CHECK + NOT NULL). */
async function ensureCp005Hardening(pool) {
  const client = await pool.connect();
  try {
    const col = await client.query(
      `SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'quote_lines' AND column_name = 'snapshot_json'`
    );
    if (col.rows.length === 0) {
      client.release();
      return;
    }

    const hasConstraint = await client.query(
      `SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'chk_quote_lines_snapshot_json' AND table_name = 'quote_lines'`
    );
    if (hasConstraint.rows.length === 0) {
      await client.query(`
        UPDATE quote_lines SET snapshot_json = '{"name":"","description":"","category":"OTHER","source":{}}'::jsonb WHERE snapshot_json IS NULL
      `);
      await client.query(`ALTER TABLE quote_lines ALTER COLUMN snapshot_json SET NOT NULL`);
      await client.query(`
        ALTER TABLE quote_lines ADD CONSTRAINT chk_quote_lines_snapshot_json
        CHECK (jsonb_typeof(snapshot_json) = 'object' AND snapshot_json ? 'name' AND snapshot_json ? 'category')
      `);
    }

    const hasTrigger = await client.query(
      `SELECT 1 FROM pg_trigger WHERE tgname = 'trg_quote_lines_catalog_item_id_immutable'`
    );
    if (hasTrigger.rows.length === 0) {
      await client.query(`
        CREATE OR REPLACE FUNCTION trg_quote_lines_catalog_item_id_immutable()
        RETURNS trigger AS $$
        BEGIN
          IF OLD.catalog_item_id IS DISTINCT FROM NEW.catalog_item_id THEN
            RAISE EXCEPTION 'CP-QUOTE-005: catalog_item_id is immutable on quote_lines' USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END;
        $$ LANGUAGE plpgsql
      `);
      await client.query(`
        DROP TRIGGER IF EXISTS trg_quote_lines_catalog_item_id_immutable ON quote_lines;
        CREATE TRIGGER trg_quote_lines_catalog_item_id_immutable
        BEFORE UPDATE ON quote_lines FOR EACH ROW
        EXECUTE PROCEDURE trg_quote_lines_catalog_item_id_immutable()
      `);
    }

    await client.query(`CREATE INDEX IF NOT EXISTS idx_quote_lines_org_quote ON quote_lines(organization_id, quote_id)`);
    await client.query(`CREATE INDEX IF NOT EXISTS idx_quote_lines_org_catalog ON quote_lines(organization_id, catalog_item_id)`);
  } finally {
    client.release();
  }
}

async function waitForServer(url, maxRetries = 10, intervalMs = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_) {}
    if (i === maxRetries - 1) throw new Error(`Serveur non accessible après ${maxRetries} tentatives`);
    await sleep(intervalMs);
  }
}

// --- A) Snapshot immuable si catalogue change ---
async function testA_SnapshotImmuable(pool, token, userOrgId) {
  console.log("--- A) Snapshot immuable si catalogue change ---\n");
  const client = await pool.connect();
  let orgId, clientId, catalogId, quoteId, lineId, nameBefore, unitPriceBefore, totalsBefore;
  try {
    orgId = userOrgId || (await client.query("SELECT id FROM organizations LIMIT 1")).rows[0]?.id;
    if (!orgId) throw new Error("Aucune organisation");

    await client.query(
      `INSERT INTO clients (organization_id, client_number, company_name) VALUES ($1, $2, $3) RETURNING id`,
      [orgId, `CLI-CP005-A-${Date.now()}`, "Test CP-005 A"]
    );
    clientId = (await client.query(`SELECT id FROM clients WHERE client_number LIKE 'CLI-CP005-A-%' ORDER BY created_at DESC LIMIT 1`)).rows[0].id;

    const catName = `Cat CP005-A ${Date.now()}`;
    await client.query(
      `INSERT INTO quote_catalog_items (organization_id, name, category, pricing_mode, sale_price_ht_cents, default_vat_rate_bps)
       VALUES ($1, $2, 'PANEL', 'UNIT', 2000, 2000)`,
      [orgId, catName]
    );
    catalogId = (await client.query(`SELECT id FROM quote_catalog_items WHERE organization_id = $1 AND name = $2`, [orgId, catName])).rows[0].id;

    const createRes = await api(token, "POST", "/api/quotes", { client_id: clientId });
    if (createRes.status !== 201) {
      fail("A", `Create quote: ${createRes.status} ${JSON.stringify(createRes.data)}`);
      throw new Error(`Create quote: ${createRes.status}`);
    }
    quoteId = createRes.data.quote?.id;
    if (!quoteId) throw new Error("quote.id manquant");

    const addRes = await api(token, "POST", `/api/quotes/${quoteId}/items/from-catalog`, { catalogItemId: catalogId, qty: 5 });
    if (addRes.status !== 201) throw new Error(`Add from catalog: ${addRes.status}`);
    lineId = addRes.data.item?.id;
    totalsBefore = addRes.data.totals;

    const get0 = await api(token, "GET", `/api/quotes/${quoteId}`);
    const line0 = get0.data.items?.find((i) => i.id === lineId);
    nameBefore = line0?.snapshot_json?.name ?? line0?.label;
    unitPriceBefore = line0?.unit_price_ht;

    await client.query(
      `UPDATE quote_catalog_items SET name = $1, sale_price_ht_cents = 99999, default_vat_rate_bps = 550 WHERE id = $2`,
      ["Cat CP005-A RENOMMÉ", catalogId]
    );

    const get1 = await api(token, "GET", `/api/quotes/${quoteId}`);
    const line1 = get1.data.items?.find((i) => i.id === lineId);
    const nameAfter = line1?.snapshot_json?.name ?? line1?.label;
    const unitPriceAfter = line1?.unit_price_ht;

    if (nameAfter === "Cat CP005-A RENOMMÉ") {
      fail("A", "snapshot name a été mis à jour par le catalogue");
      throw new Error("Snapshot non immuable");
    }
    if (Math.abs(Number(unitPriceAfter) - Number(unitPriceBefore)) > 0.001) {
      fail("A", `unit_price a changé: ${unitPriceBefore} -> ${unitPriceAfter}`);
      throw new Error("Prix ligne modifié par catalogue");
    }
    const totalsAfter = get1.data.quote;
    const expectedHt = (totalsBefore?.total_ht_cents ?? 0) / 100;
    if (Math.abs(Number(totalsAfter?.total_ht ?? 0) - expectedHt) > 0.01) {
      fail("A", `totaux devis ont changé: attendu HT=${expectedHt}, reçu ${totalsAfter?.total_ht}`);
      throw new Error("Totaux modifiés");
    }
    ok("Snapshot immuable : catalogue modifié, quote_line et totaux inchangés");
  } finally {
    if (quoteId) {
      await client.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
      await client.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    }
    if (catalogId) await client.query("DELETE FROM quote_catalog_items WHERE id = $1", [catalogId]);
    await client.query("DELETE FROM clients WHERE client_number LIKE 'CLI-CP005-A-%'");
    client.release();
  }
  console.log("");
}

// --- B) PATCH malveillant => 400 ---
async function testB_PatchMalveillantInterdit(pool, token, userOrgId) {
  console.log("--- B) PATCH malveillant interdit ---\n");
  const client = await pool.connect();
  let orgId, clientId, catalogId, quoteId, lineId;
  try {
    orgId = userOrgId || (await client.query("SELECT id FROM organizations LIMIT 1")).rows[0].id;
    await client.query(
      `INSERT INTO clients (organization_id, client_number, company_name) VALUES ($1, $2, $3)`,
      [orgId, `CLI-CP005-B-${Date.now()}`, "Test B"]
    );
    clientId = (await client.query(`SELECT id FROM clients WHERE client_number LIKE 'CLI-CP005-B-%' ORDER BY created_at DESC LIMIT 1`)).rows[0].id;
    const catName = `Cat CP005-B ${Date.now()}`;
    await client.query(
      `INSERT INTO quote_catalog_items (organization_id, name, category, pricing_mode, sale_price_ht_cents) VALUES ($1, $2, 'PANEL', 'UNIT', 1000)`,
      [orgId, catName]
    );
    catalogId = (await client.query(`SELECT id FROM quote_catalog_items WHERE organization_id = $1 AND name = $2`, [orgId, catName])).rows[0].id;

    const createRes = await api(token, "POST", "/api/quotes", { client_id: clientId });
    quoteId = createRes.data.quote?.id;
    const addRes = await api(token, "POST", `/api/quotes/${quoteId}/items/from-catalog`, { catalogItemId: catalogId });
    lineId = addRes.data.item?.id;

    const patchSnap = await api(token, "PATCH", `/api/quotes/${quoteId}/items/${lineId}`, { snapshot_json: { name: "HACK" } });
    if (patchSnap.status !== 400) {
      fail("B", `PATCH avec snapshot_json attendu 400, reçu ${patchSnap.status}`);
      throw new Error("B");
    }
    if (!(patchSnap.data.error || "").toLowerCase().includes("immutable")) {
      fail("B", "Message doit contenir 'immutable'");
      throw new Error("B");
    }
    ok("PATCH avec snapshot_json => 400 (snapshot is immutable)");

    const lineBefore = await client.query(`SELECT snapshot_json FROM quote_lines WHERE id = $1`, [lineId]);
    const patchCatalog = await api(token, "PATCH", `/api/quotes/${quoteId}/items/${lineId}`, { catalog_item_id: "00000000-0000-0000-0000-000000000000" });
    if (patchCatalog.status !== 400) {
      fail("B", `PATCH avec catalog_item_id attendu 400, reçu ${patchCatalog.status}`);
      throw new Error("B");
    }
    const lineAfter = await client.query(`SELECT snapshot_json FROM quote_lines WHERE id = $1`, [lineId]);
    if (JSON.stringify(lineBefore.rows[0]?.snapshot_json) !== JSON.stringify(lineAfter.rows[0]?.snapshot_json)) {
      fail("B", "DB modifiée après PATCH rejeté");
      throw new Error("B");
    }
    ok("PATCH avec catalog_item_id => 400, DB inchangée");
  } finally {
    if (quoteId) {
      await client.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
      await client.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    }
    if (catalogId) await client.query("DELETE FROM quote_catalog_items WHERE id = $1", [catalogId]);
    await client.query("DELETE FROM clients WHERE client_number LIKE 'CLI-CP005-B-%'");
    client.release();
  }
  console.log("");
}

// --- C) catalog_item_id immuable en DB (trigger) ---
async function testC_TriggerCatalogItemIdImmuable(pool) {
  console.log("--- C) catalog_item_id immuable en DB (trigger) ---\n");
  const client = await pool.connect();
  let quoteId;
  try {
    const orgRes = await client.query("SELECT id FROM organizations LIMIT 1");
    const orgId = orgRes.rows[0].id;
    const catRes = await client.query(
      `INSERT INTO quote_catalog_items (organization_id, name, category, pricing_mode) VALUES ($1, $2, 'PANEL', 'UNIT') RETURNING id`,
      [orgId, `Cat CP005-C-${Date.now()}`]
    );
    const catalogId = catRes.rows[0].id;
    await client.query(
      `INSERT INTO clients (organization_id, client_number, company_name) VALUES ($1, $2, $3)`,
      [orgId, `CLI-CP005-C-${Date.now()}`, "Test C"]
    );
    const clientId = (await client.query(`SELECT id FROM clients WHERE client_number LIKE 'CLI-CP005-C-%' ORDER BY created_at DESC LIMIT 1`)).rows[0].id;
    const quoteRes = await client.query(
      `INSERT INTO quotes (organization_id, client_id, quote_number, status) VALUES ($1, $2, $3, 'draft') RETURNING id`,
      [orgId, clientId, `Q-C-${Date.now()}`]
    );
    quoteId = quoteRes.rows[0].id;
    const lineRes = await client.query(
      `INSERT INTO quote_lines (organization_id, quote_id, catalog_item_id, snapshot_json, label, description, quantity, unit_price_ht, vat_rate, total_line_ht, total_line_vat, total_line_ttc, position)
       VALUES ($1, $2, $3, '{"name":"x","category":"PANEL","source":{}}'::jsonb, 'x', '', 1, 10, 20, 10, 2, 12, 1) RETURNING id`,
      [orgId, quoteId, catalogId]
    );
    const quoteLineId = lineRes.rows[0].id;

    let raised = false;
    try {
      await client.query(
        `UPDATE quote_lines SET catalog_item_id = '00000000-0000-0000-0000-000000000000' WHERE id = $1`,
        [quoteLineId]
      );
    } catch (e) {
      if (e.message?.includes("immutable") || e.message?.includes("catalog_item_id")) raised = true;
    }
    if (!raised) {
      fail("C", "UPDATE catalog_item_id aurait dû lever une exception (trigger)");
      throw new Error("C");
    }
    ok("UPDATE direct catalog_item_id => trigger lève exception");
  } finally {
    if (quoteId) {
      await client.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
      await client.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    }
    await client.query("DELETE FROM quote_catalog_items WHERE name LIKE 'Cat CP005-C-%'");
    await client.query("DELETE FROM clients WHERE client_number LIKE 'CLI-CP005-C-%'");
    client.release();
  }
  console.log("");
}

// --- D) Multi-org isolation ---
async function testD_MultiOrgIsolation(pool, tokenA, tokenB, orgAId, orgBId, quoteAId, lineAId, catalogAId) {
  console.log("--- D) Multi-org isolation ---\n");

  const patchCatalogAsB = await api(tokenB, "PATCH", `/api/admin/quote-catalog/${catalogAId}`, { name: "HACK" });
  if (patchCatalogAsB.status !== 404 && patchCatalogAsB.status !== 403) {
    fail("D", `orgB PATCH catalogue orgA attendu 403/404, reçu ${patchCatalogAsB.status}`);
    throw new Error("D");
  }
  ok("orgB ne peut pas modifier le catalogue orgA => 403/404");

  const patchQuoteAsB = await api(tokenB, "PATCH", `/api/quotes/${quoteAId}/items/${lineAId}`, { qty: 999 });
  if (patchQuoteAsB.status !== 404 && patchQuoteAsB.status !== 403) {
    fail("D", `orgB PATCH quote orgA attendu 403/404, reçu ${patchQuoteAsB.status}`);
    throw new Error("D");
  }
  ok("orgB ne peut pas PATCH une ligne devis orgA => 403/404");

  const getAsA = await api(tokenA, "GET", `/api/quotes/${quoteAId}`);
  const lineA = getAsA.data.items?.find((i) => i.id === lineAId);
  const qtyA = lineA?.quantity;
  if (Number(qtyA) === 999) {
    fail("D", "quote orgA a été modifié par orgB");
    throw new Error("D");
  }
  ok("Devis orgA inchangé après tentative orgB");
  console.log("");
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant");
    process.exit(1);
  }

  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let serverProcess = null;

  /**
   * Nettoyage d'urgence — appelé sur SIGINT/SIGTERM pour éviter
   * de laisser des données de test orphelines en base si le script
   * est interrompu (Ctrl+C, crash, kill).
   */
  async function emergencyCleanup(signal) {
    console.warn(`\n⚠️  Signal ${signal} reçu — nettoyage des données de test en cours…`);
    const cl = await pool.connect().catch(() => null);
    if (cl) {
      try {
        await cl.query("DELETE FROM quote_catalog_items WHERE name LIKE 'Cat CP005-%'");
        await cl.query("DELETE FROM clients WHERE client_number LIKE 'CLI-CP005-%'");
        const orgRes = await cl.query(
          `SELECT id FROM organizations WHERE name = 'Test CP-005 Org B'`
        );
        for (const org of orgRes.rows) {
          await cl.query(`DELETE FROM rbac_role_permissions WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)`, [org.id]);
          await cl.query(`DELETE FROM rbac_user_roles WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)`, [org.id]);
          await cl.query(`DELETE FROM pipeline_stages WHERE organization_id = $1`, [org.id]);
          await cl.query(`DELETE FROM rbac_roles WHERE organization_id = $1`, [org.id]);
          await cl.query(`DELETE FROM organizations WHERE id = $1`, [org.id]);
        }
        console.warn("✅ Données de test nettoyées.");
      } catch (e) {
        console.error("❌ Erreur nettoyage d'urgence :", e.message);
      } finally {
        cl.release();
      }
    }
    await pool.end().catch(() => {});
    if (serverProcess) serverProcess.kill("SIGKILL");
    process.exit(1);
  }

  process.once("SIGINT", () => emergencyCleanup("SIGINT"));
  process.once("SIGTERM", () => emergencyCleanup("SIGTERM"));

  try {
    console.log("=== CP-QUOTE-005 SNAPSHOT HARDENING ===\n");

    await ensureCp004Columns(pool);
    await ensureCp005Hardening(pool);

    if (!USE_EXTERNAL_SERVER) {
      killProcessOnPort(TEST_PORT);
      await sleep(500);
      console.log("Démarrage du serveur sur port", TEST_PORT, "...");
      serverProcess = spawn("node", ["bootstrap.js"], {
        cwd: BACKEND_DIR,
        env: { ...process.env, PORT: String(TEST_PORT), RBAC_ENFORCE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      serverProcess.stderr?.on("data", (d) => process.stderr.write(d));
      await sleep(4000);
      await waitForServer(BASE_URL + "/", 10, 2000);
      console.log("Serveur prêt.\n");
    } else {
      await waitForServer(BASE_URL + "/", 3, 2000);
    }

    const loginA = await login(SUPER_ADMIN.email, SUPER_ADMIN.password);
    const tokenA = loginA.token;
    const orgAIdFromUser = loginA.organizationId;

    await testA_SnapshotImmuable(pool, tokenA, orgAIdFromUser);
    await testB_PatchMalveillantInterdit(pool, tokenA, orgAIdFromUser);
    await testC_TriggerCatalogItemIdImmuable(pool);

    // D) Multi-org: create orgB, userB, catalogA in orgA, quoteA with line from catalogA, then tokenB tries to patch
    const orgAId = orgAIdFromUser;
    const client = await pool.connect();
    let orgBId, userBEmail, quoteAId, lineAId, catalogAId, clientAId;
    try {

      const orgBRes = await client.query(
        `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test CP-005 Org B') RETURNING id`
      );
      orgBId = orgBRes.rows[0].id;

      const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");
      const { hashPassword } = await import("../auth/auth.service.js");
      await ensureOrgRolesSeeded(orgBId);

      userBEmail = `cp005-userb-${Date.now()}@test.local`;
      const pwdHash = await hashPassword("Cp005UserB!");
      await client.query(
        `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active')`,
        [orgBId, userBEmail, pwdHash]
      );
      const userBId = (await client.query(`SELECT id FROM users WHERE email = $1`, [userBEmail])).rows[0].id;
      const salesRole = await client.query(
        `SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'SALES' LIMIT 1`,
        [orgBId]
      );
      if (salesRole.rows[0]) {
        await client.query(
          `INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userBId, salesRole.rows[0].id]
        );
      }
      const legRole = await client.query(`SELECT id FROM roles WHERE name IN ('SALES', 'ADMIN') LIMIT 1`);
      if (legRole.rows[0]) {
        await client.query(
          `INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`,
          [userBId, legRole.rows[0].id]
        );
      }

      await client.query(
        `INSERT INTO clients (organization_id, client_number, company_name) VALUES ($1, $2, $3)`,
        [orgAId, `CLI-CP005-D-${Date.now()}`, "Test D"]
      );
      clientAId = (await client.query(`SELECT id FROM clients WHERE client_number LIKE 'CLI-CP005-D-%' ORDER BY created_at DESC LIMIT 1`)).rows[0].id;
      const catName = `Cat CP005-D-A ${Date.now()}`;
      await client.query(
        `INSERT INTO quote_catalog_items (organization_id, name, category, pricing_mode, sale_price_ht_cents) VALUES ($1, $2, 'PANEL', 'UNIT', 1000)`,
        [orgAId, catName]
      );
      catalogAId = (await client.query(`SELECT id FROM quote_catalog_items WHERE organization_id = $1 AND name = $2`, [orgAId, catName])).rows[0].id;

      const createRes = await api(tokenA, "POST", "/api/quotes", { client_id: clientAId });
      quoteAId = createRes.data.quote?.id;
      const addRes = await api(tokenA, "POST", `/api/quotes/${quoteAId}/items/from-catalog`, { catalogItemId: catalogAId });
      lineAId = addRes.data.item?.id;
    } finally {
      client.release();
    }

    const tokenB = (await login(userBEmail, "Cp005UserB!")).token;
    await testD_MultiOrgIsolation(pool, tokenA, tokenB, orgAId, orgBId, quoteAId, lineAId, catalogAId);

    // Cleanup D
    const cl = await pool.connect();
    try {
      if (quoteAId) {
        await cl.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteAId]);
        await cl.query("DELETE FROM quotes WHERE id = $1", [quoteAId]);
      }
      if (catalogAId) await cl.query("DELETE FROM quote_catalog_items WHERE id = $1", [catalogAId]);
      if (clientAId) await cl.query("DELETE FROM clients WHERE id = $1", [clientAId]);
      await cl.query("DELETE FROM user_roles WHERE user_id IN (SELECT id FROM users WHERE email = $1)", [userBEmail]);
      await cl.query("DELETE FROM rbac_user_roles WHERE user_id IN (SELECT id FROM users WHERE email = $1)", [userBEmail]);
      await cl.query("DELETE FROM users WHERE email = $1", [userBEmail]);
      await cl.query("DELETE FROM rbac_role_permissions WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)", [orgBId]);
      await cl.query("DELETE FROM rbac_user_roles WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = $1)", [orgBId]);
      await cl.query("DELETE FROM pipeline_stages WHERE organization_id = $1", [orgBId]);
      await cl.query("DELETE FROM rbac_roles WHERE organization_id = $1", [orgBId]);
      await cl.query("DELETE FROM organizations WHERE id = $1", [orgBId]);
    } finally {
      cl.release();
    }

    console.log("=== PASS CP-QUOTE-005 ===");
    process.exit(0);
  } catch (err) {
    console.error("\n❌ Erreur:", err.message || err);
    process.exit(1);
  } finally {
    await pool.end();
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
  }
}

main();
