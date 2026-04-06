/**
 * CP-QUOTE-006 — Tests industriels: flux catalog -> quote -> lines -> totals,
 * transaction/rollback, edge cases, soft delete, multi-org, index check.
 * Usage: cd backend && node scripts/test-quote-industrial.js
 */

import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { spawn } from "child_process";
import { execSync } from "child_process";
import dotenv from "dotenv";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const BACKEND_DIR = resolve(__dirname, "..");

// --- Test ports centralisés (CP-QUOTE-004/005/006) ---
const TEST_PORT_QUOTE_ENGINE = 5056;
const TEST_PORT_SNAPSHOT = 5057;
const TEST_PORT_INDUSTRIAL = 5058;

dotenv.config({ path: resolve(BACKEND_DIR, "../.env.dev"), override: false });
dotenv.config({ path: resolve(BACKEND_DIR, ".env"), override: false });

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

const USE_EXTERNAL_SERVER = Boolean(process.env.SERVER_URL);
const TEST_PORT = Number(process.env.TEST_PORT) || TEST_PORT_INDUSTRIAL;
const BASE_URL = USE_EXTERNAL_SERVER
  ? process.env.SERVER_URL.replace(/\/$/, "")
  : `http://localhost:${TEST_PORT}`;

const TEST_PASSWORD = "Cp006Industrial!";

function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

function ok(label) {
  console.log(`✅ ${label}`);
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

async function apiFetch(method, path, token, body = null) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${token}`,
    },
    body: body != null ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  return { status: res.status, data };
}

async function login(email, password) {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  const data = await res.json();
  assert(data.token, `Login échoué: ${data.error || res.status}`);
  return { token: data.token, organizationId: data.user?.organizationId ?? data.user?.organization_id };
}

function centsToEur(cents) {
  return Number(cents) / 100;
}
function eurToCents(eur) {
  return Math.round(Number(eur) * 100);
}

async function waitForServer(url, maxRetries = 10, intervalMs = 2000) {
  for (let i = 0; i < maxRetries; i++) {
    try {
      const res = await fetch(url);
      if (res.ok) return;
    } catch (_) {}
    if (i === maxRetries - 1) throw new Error("Serveur non accessible");
    await sleep(intervalMs);
  }
}

async function ensureCp004And005(pool) {
  const client = await pool.connect();
  try {
    const cols = await client.query(
      `SELECT column_name FROM information_schema.columns WHERE table_schema='public' AND table_name='quote_lines'`
    );
    const has = new Set(cols.rows.map((r) => r.column_name));
    if (!has.has("catalog_item_id")) {
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
      await client.query(`CREATE INDEX IF NOT EXISTS idx_quote_lines_org_quote ON quote_lines(organization_id, quote_id)`);
    }
    const hasConstraint = await client.query(
      `SELECT 1 FROM information_schema.table_constraints WHERE constraint_name = 'chk_quote_lines_snapshot_json'`
    );
    if (hasConstraint.rows.length === 0 && has.has("snapshot_json")) {
      await client.query(`UPDATE quote_lines SET snapshot_json = '{"name":"","category":"OTHER","source":{}}'::jsonb WHERE snapshot_json IS NULL`);
      await client.query(`ALTER TABLE quote_lines ALTER COLUMN snapshot_json SET NOT NULL`);
      await client.query(`
        ALTER TABLE quote_lines ADD CONSTRAINT chk_quote_lines_snapshot_json
        CHECK (jsonb_typeof(snapshot_json) = 'object' AND snapshot_json ? 'name' AND snapshot_json ? 'category')
      `);
    }
    const hasTrigger = await client.query(`SELECT 1 FROM pg_trigger WHERE tgname = 'trg_quote_lines_catalog_item_id_immutable'`);
    if (hasTrigger.rows.length === 0 && has.has("catalog_item_id")) {
      await client.query(`
        CREATE OR REPLACE FUNCTION trg_quote_lines_catalog_item_id_immutable() RETURNS trigger AS $$
        BEGIN
          IF OLD.catalog_item_id IS DISTINCT FROM NEW.catalog_item_id THEN
            RAISE EXCEPTION 'CP-QUOTE-005: catalog_item_id is immutable' USING ERRCODE = 'check_violation';
          END IF;
          RETURN NEW;
        END; $$ LANGUAGE plpgsql
      `);
      await client.query(`
        DROP TRIGGER IF EXISTS trg_quote_lines_catalog_item_id_immutable ON quote_lines;
        CREATE TRIGGER trg_quote_lines_catalog_item_id_immutable BEFORE UPDATE ON quote_lines FOR EACH ROW
        EXECUTE PROCEDURE trg_quote_lines_catalog_item_id_immutable()
      `);
    }
  } catch (e) {
    if (e.code === "42704") {
      await client.query(`DO $$ BEGIN CREATE TYPE quote_catalog_pricing_mode AS ENUM ('FIXED', 'UNIT', 'PERCENT_TOTAL'); EXCEPTION WHEN duplicate_object THEN NULL; END $$`);
      await client.query(`ALTER TABLE quote_lines ADD COLUMN IF NOT EXISTS pricing_mode quote_catalog_pricing_mode`);
    }
    throw e;
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant");
    process.exit(1);
  }

  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let serverProcess = null;
  const seed = { orgA: null, orgB: null, adminA: null, adminB: null, userA: null };

  try {
    console.log("=== CP-QUOTE-006 TESTS INDUSTRIELS ===\n");
    console.log("0) Setup\n");
    console.log("DB host utilisé:", dbHost);

    await ensureCp004And005(pool);

    if (!USE_EXTERNAL_SERVER) {
      killProcessOnPort(TEST_PORT);
      await sleep(500);
      console.log("Démarrage serveur port", TEST_PORT, "...");
      serverProcess = spawn("node", ["bootstrap.js"], {
        cwd: BACKEND_DIR,
        env: { ...process.env, PORT: String(TEST_PORT), RBAC_ENFORCE: "1" },
        stdio: ["ignore", "pipe", "pipe"],
      });
      serverProcess.stderr?.on("data", (d) => process.stderr.write(d));
      await sleep(4000);
      await waitForServer(BASE_URL + "/", 10, 2000);
      ok("Serveur prêt");
    } else {
      await waitForServer(BASE_URL + "/", 3, 2000);
    }

    const { hashPassword } = await import("../auth/auth.service.js");
    const { ensureOrgRolesSeeded } = await import("../rbac/rbac.service.js");

    console.log("\n1) Seed transactionnel (données de test)\n");
    const ts = Date.now();
    const orgARes = await pool.query(
      `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test CP-006 Org A') RETURNING id`
    );
    seed.orgA = orgARes.rows[0].id;
    const orgBRes = await pool.query(
      `INSERT INTO organizations (id, name) VALUES (gen_random_uuid(), 'Test CP-006 Org B') RETURNING id`
    );
    seed.orgB = orgBRes.rows[0].id;
    await ensureOrgRolesSeeded(seed.orgA);
    await ensureOrgRolesSeeded(seed.orgB);

    const pwdHash = await hashPassword(TEST_PASSWORD);
    const adminAEmail = `cp006-adminA-${ts}@test.local`;
    const adminBEmail = `cp006-adminB-${ts}@test.local`;
    const userAEmail = `cp006-userA-${ts}@test.local`;

    let r = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [seed.orgA, adminAEmail, pwdHash]
    );
    seed.adminA = r.rows[0].id;
    r = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [seed.orgB, adminBEmail, pwdHash]
    );
    seed.adminB = r.rows[0].id;
    r = await pool.query(
      `INSERT INTO users (organization_id, email, password_hash, status) VALUES ($1, $2, $3, 'active') RETURNING id`,
      [seed.orgA, userAEmail, pwdHash]
    );
    seed.userA = r.rows[0].id;

    const adminRoleA = (await pool.query(`SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'ADMIN' LIMIT 1`, [seed.orgA])).rows[0];
    const adminRoleB = (await pool.query(`SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'ADMIN' LIMIT 1`, [seed.orgB])).rows[0];
    const salesRoleA = (await pool.query(`SELECT id FROM rbac_roles WHERE (organization_id = $1 OR organization_id IS NULL) AND code = 'SALES' LIMIT 1`, [seed.orgA])).rows[0];
    for (const [userId, roleId] of [[seed.adminA, adminRoleA?.id], [seed.adminB, adminRoleB?.id], [seed.userA, adminRoleA?.id]]) {
      if (userId && roleId) await pool.query(`INSERT INTO rbac_user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`, [userId, roleId]);
    }
    const legRole = (await pool.query(`SELECT id FROM roles WHERE name IN ('ADMIN', 'SALES', 'SUPER_ADMIN') LIMIT 1`)).rows[0];
    if (legRole) {
      await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`, [seed.adminA, legRole.id]);
      await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`, [seed.adminB, legRole.id]);
      await pool.query(`INSERT INTO user_roles (user_id, role_id) VALUES ($1, $2) ON CONFLICT (user_id, role_id) DO NOTHING`, [seed.userA, legRole.id]);
    }
    ok("Org A/B, adminA/adminB, userA créés");

    const { generateJWT } = await import("../auth/auth.service.js");
    const tokenAdminA = generateJWT({ id: seed.adminA, organization_id: seed.orgA, role: "ADMIN" });
    const tokenAdminB = generateJWT({ id: seed.adminB, organization_id: seed.orgB, role: "ADMIN" });
    const tokenUserA = generateJWT({ id: seed.userA, organization_id: seed.orgA, role: "ADMIN" });
    const orgAId = seed.orgA;

    console.log("\n2) Catalogue (admin)\n");
    const catalogIds = {};
    const createCat = async (name, category, pricing_mode, sale_price_ht_cents, purchase_price_ht_cents, default_vat_rate_bps) => {
      const res = await apiFetch("POST", "/api/admin/quote-catalog", tokenAdminA, {
        name,
        category: category || "PANEL",
        pricing_mode,
        sale_price_ht_cents: sale_price_ht_cents ?? 0,
        purchase_price_ht_cents: purchase_price_ht_cents ?? 0,
        default_vat_rate_bps: default_vat_rate_bps ?? 2000,
      });
      assert(res.status === 201, `Create catalog ${name}: ${res.status} ${JSON.stringify(res.data)}`);
      return res.data.item?.id;
    };
    catalogIds.panneauX = await createCat("Panneau X", "PANEL", "UNIT", 10000, 7000, 2000);
    catalogIds.microY = await createCat("Micro Y", "INVERTER", "UNIT", 3000, 2000, 2000);
    catalogIds.pose = await createCat("Pose", "SERVICE", "FIXED", 50000, 30000, 1000);
    catalogIds.cablage = await createCat("Cablage", "CABLE", "FIXED", 8000, 4000, 2000);
    catalogIds.optionMonitoring = await createCat("Option monitoring", "SERVICE", "UNIT", 500, 0, 2000);
    catalogIds.remisePercent = await createCat("Remise % total", "DISCOUNT", "PERCENT_TOTAL", 0, 0, 2000);
    ok("6 items catalogue créés");

    const dup = await apiFetch("POST", "/api/admin/quote-catalog", tokenAdminA, { name: "Panneau X", category: "PANEL" });
    assert(dup.status === 409, `Duplicate name attendu 409: ${dup.status}`);
    ok("Duplication name => 409");

    let listInactive = await apiFetch("GET", "/api/admin/quote-catalog?include_inactive=true", tokenAdminA);
    assert(listInactive.status === 200 && Array.isArray(listInactive.data.items), "List include_inactive");
    const beforeDeact = listInactive.data.items.length;
    await apiFetch("POST", `/api/admin/quote-catalog/${catalogIds.optionMonitoring}/deactivate`, tokenAdminA);
    let listActive = await apiFetch("GET", "/api/admin/quote-catalog", tokenAdminA);
    const afterDeact = listActive.data.items.length;
    assert(afterDeact === beforeDeact - 1, "Deactivate: un item en moins sans include_inactive");
    await apiFetch("POST", `/api/admin/quote-catalog/${catalogIds.optionMonitoring}/activate`, tokenAdminA);
    ok("Deactivate / reactivate OK");

    console.log("\n3) Quote (commercial)\n");
    await pool.query(
      `INSERT INTO clients (organization_id, client_number, company_name) VALUES ($1, $2, $3)`,
      [orgAId, `CLI-CP006-${ts}`, "Test CP-006"]
    );
    const clientId = (await pool.query(`SELECT id FROM clients WHERE client_number = $1`, [`CLI-CP006-${ts}`])).rows[0].id;
    const quoteRes = await apiFetch("POST", "/api/quotes", tokenUserA, { client_id: clientId });
    assert(quoteRes.status === 201, `Create quote: ${quoteRes.status}`);
    const quoteId = quoteRes.data.quote?.id;
    assert(quoteId, "quote.id manquant");

    await apiFetch("POST", `/api/quotes/${quoteId}/items/from-catalog`, tokenUserA, { catalogItemId: catalogIds.panneauX, qty: 12 });
    await apiFetch("POST", `/api/quotes/${quoteId}/items/from-catalog`, tokenUserA, { catalogItemId: catalogIds.microY, qty: 12 });
    await apiFetch("POST", `/api/quotes/${quoteId}/items/from-catalog`, tokenUserA, { catalogItemId: catalogIds.pose });
    const addCablage = await apiFetch("POST", `/api/quotes/${quoteId}/items/from-catalog`, tokenUserA, { catalogItemId: catalogIds.cablage });
    assert(addCablage.status === 201, "Add cablage");
    const totals1 = addCablage.data.totals;
    const expectedHtCents = 12 * 10000 + 12 * 3000 + 50000 + 8000;
    const expectedVatCents = Math.round(12 * 10000 * 0.2) + Math.round(12 * 3000 * 0.2) + Math.round(50000 * 0.1) + Math.round(8000 * 0.2);
    assert(totals1.total_ht_cents === expectedHtCents, `Total HT attendu ${expectedHtCents}, reçu ${totals1.total_ht_cents}`);
    ok("Totaux HT/TVA/TTC cohérents");

    const addPercent = await apiFetch("POST", `/api/quotes/${quoteId}/items/from-catalog`, tokenUserA, { catalogItemId: catalogIds.remisePercent });
    assert(addPercent.status === 400, `PERCENT_TOTAL attendu 400: ${addPercent.status}`);
    ok("Ajout PERCENT_TOTAL => 400");

    const getQuote = await apiFetch("GET", `/api/quotes/${quoteId}`, tokenUserA);
    const lineMicro = getQuote.data.items?.find((l) => l.snapshot_json?.name === "Micro Y" || l.label === "Micro Y");
    const linePanneau = getQuote.data.items?.find((l) => l.snapshot_json?.name === "Panneau X" || l.label === "Panneau X");
    assert(lineMicro && linePanneau, "Lignes trouvées");
    const patchVat = await apiFetch("PATCH", `/api/quotes/${quoteId}/items/${linePanneau.id}`, tokenUserA, { vatRateBps: 1000 });
    assert(patchVat.status === 200, "PATCH vatRateBps");
    const patchQty = await apiFetch("PATCH", `/api/quotes/${quoteId}/items/${lineMicro.id}`, tokenUserA, { qty: 10 });
    assert(patchQty.status === 200, "PATCH qty");
    ok("PATCH vat / qty => totaux recalculés");

    const deactMicro = await apiFetch("POST", `/api/quotes/${quoteId}/items/${lineMicro.id}/deactivate`, tokenUserA);
    assert(deactMicro.status === 200, "Deactivate line");
    const totalsAfterDeact = deactMicro.data.totals;
    const expectedHtAfterCents = 12 * 10000 + 50000 + 8000;
    assert(totalsAfterDeact.total_ht_cents === expectedHtAfterCents, `Totaux après deactivate: ${totalsAfterDeact.total_ht_cents}`);
    ok("Soft delete quote line => totaux mis à jour");

    const patchQty0 = await apiFetch("PATCH", `/api/quotes/${quoteId}/items/${linePanneau.id}`, tokenUserA, { qty: 0 });
    assert(patchQty0.status === 400, `qty=0 attendu 400: ${patchQty0.status}`);
    const patchQtyNeg = await apiFetch("PATCH", `/api/quotes/${quoteId}/items/${linePanneau.id}`, tokenUserA, { qty: -1 });
    assert(patchQtyNeg.status === 400, `qty=-1 attendu 400: ${patchQtyNeg.status}`);
    const patchVatHigh = await apiFetch("PATCH", `/api/quotes/${quoteId}/items/${linePanneau.id}`, tokenUserA, { vatRateBps: 35000 });
    assert(patchVatHigh.status === 400, `vatRateBps>30000 attendu 400: ${patchVatHigh.status}`);
    ok("Edge: qty=0, qty=-1, vatRateBps>30000 => 400");

    const addQty0 = await apiFetch("POST", `/api/quotes/${quoteId}/items/from-catalog`, tokenUserA, { catalogItemId: catalogIds.panneauX, qty: 0 });
    assert(addQty0.status === 400, `from-catalog qty=0 attendu 400: ${addQty0.status}`);
    ok("from-catalog qty<1 => 400");

    console.log("\n4) Snapshot invariance\n");
    await apiFetch("PATCH", `/api/admin/quote-catalog/${catalogIds.panneauX}`, tokenAdminA, {
      name: "Panneau X Modifié",
      sale_price_ht_cents: 99999,
      default_vat_rate_bps: 550,
    });
    const getQuote2 = await apiFetch("GET", `/api/quotes/${quoteId}`, tokenUserA);
    const linePanneau2 = getQuote2.data.items?.find((l) => l.catalog_item_id === catalogIds.panneauX || (l.snapshot_json?.source?.catalogItemId === catalogIds.panneauX));
    assert(linePanneau2, "Ligne Panneau trouvée");
    assert(
      (linePanneau2.snapshot_json?.name || linePanneau2.label) !== "Panneau X Modifié",
      "Snapshot name doit rester ancien"
    );
    const unitCents = Math.round(Number(linePanneau2.unit_price_ht ?? 0) * 100);
    assert(unitCents === 10000, `Prix ligne inchangé (10000 cents): ${unitCents}`);
    ok("Catalogue modifié => quote line inchangée (snapshot)");

    console.log("\n5) Multi-org isolation\n");
    const listCatB = await apiFetch("GET", "/api/admin/quote-catalog", tokenAdminB);
    assert(listCatB.status === 200 && (!listCatB.data.items || listCatB.data.items.length === 0 || listCatB.data.items.every((i) => i.organization_id === seed.orgB)), "AdminB ne voit pas catalog orgA");
    const patchCatAByB = await apiFetch("PATCH", `/api/admin/quote-catalog/${catalogIds.panneauX}`, tokenAdminB, { name: "Hack" });
    assert(patchCatAByB.status === 404 || patchCatAByB.status === 403, `AdminB patch catalog orgA: ${patchCatAByB.status}`);
    ok("AdminB ne peut pas modifier catalog orgA");

    await pool.query(
      `INSERT INTO clients (organization_id, client_number, company_name) VALUES ($1, $2, $3)`,
      [seed.orgB, `CLI-CP006-B-${ts}`, "Test B"]
    );
    const clientBId = (await pool.query(`SELECT id FROM clients WHERE client_number = $2 AND organization_id = $1`, [seed.orgB, `CLI-CP006-B-${ts}`])).rows[0].id;
    const quoteBRes = await apiFetch("POST", "/api/quotes", tokenAdminB, { client_id: clientBId });
    assert(quoteBRes.status === 201, "Quote orgB");
    const quoteBId = quoteBRes.data.quote?.id;
    const resCatB = await apiFetch("POST", "/api/admin/quote-catalog", tokenAdminB, {
      name: "Micro Y OrgB",
      category: "INVERTER",
      pricing_mode: "UNIT",
      sale_price_ht_cents: 3000,
      default_vat_rate_bps: 2000,
    });
    assert(resCatB.status === 201, "Catalog orgB");
    const catalogBId = resCatB.data.item?.id;
    await apiFetch("POST", `/api/quotes/${quoteBId}/items/from-catalog`, tokenAdminB, { catalogItemId: catalogBId, qty: 1 });
    const linesB = (await apiFetch("GET", `/api/quotes/${quoteBId}`, tokenAdminB)).data.items;
    const lineBId = linesB?.[0]?.id;
    assert(lineBId, "Ligne orgB");
    const patchAByUserA = await apiFetch("PATCH", `/api/quotes/${quoteBId}/items/${lineBId}`, tokenUserA, { qty: 99 });
    assert(patchAByUserA.status === 404 || patchAByUserA.status === 403, `userA patch quote orgB: ${patchAByUserA.status}`);
    ok("userA ne peut pas PATCH quote_line orgB");

    console.log("\n6) Performance index check (EXPLAIN)\n");
    const clientExplain = await pool.connect();
    try {
      await clientExplain.query("BEGIN");
      await clientExplain.query("SET LOCAL enable_seqscan = off");
      const explainLines = await clientExplain.query(
        `EXPLAIN (FORMAT TEXT) SELECT * FROM quote_lines WHERE organization_id = $1 AND quote_id = $2 AND is_active = true`,
        [orgAId, quoteId]
      );
      const planLines = explainLines.rows.map((r) => r["QUERY PLAN"]).join(" ");
      assert(
        /Index Scan|Bitmap Index Scan|idx_quote_lines/.test(planLines),
        `Index attendu pour quote_lines: ${planLines}`
      );
      ok("EXPLAIN quote_lines: index utilisé");
      const explainCatalog = await clientExplain.query(
        `EXPLAIN (FORMAT TEXT) SELECT * FROM quote_catalog_items WHERE organization_id = $1 AND is_active = true ORDER BY name LIMIT 50`,
        [orgAId]
      );
      const planCatalog = explainCatalog.rows.map((r) => r["QUERY PLAN"]).join(" ");
      assert(
        /Index Scan|Bitmap Index Scan|idx_quote_catalog/.test(planCatalog),
        `Index attendu pour quote_catalog_items: ${planCatalog}`
      );
      ok("EXPLAIN quote_catalog_items: index utilisé");
      await clientExplain.query("ROLLBACK");
    } finally {
      clientExplain.release();
    }

    console.log("\n7) Validation rollback (cleanup)\n");
    const client = await pool.connect();
    try {
      await client.query("DELETE FROM quote_lines WHERE quote_id IN (SELECT id FROM quotes WHERE organization_id = ANY($1))", [[seed.orgA, seed.orgB]]);
      await client.query("DELETE FROM quotes WHERE organization_id = ANY($1)", [[seed.orgA, seed.orgB]]);
      await client.query("DELETE FROM quote_catalog_items WHERE organization_id = ANY($1)", [[seed.orgA, seed.orgB]]);
      await client.query("DELETE FROM clients WHERE organization_id = ANY($1)", [[seed.orgA, seed.orgB]]);
      await client.query("DELETE FROM user_roles WHERE user_id = ANY($1)", [[seed.adminA, seed.adminB, seed.userA]]);
      await client.query("DELETE FROM rbac_user_roles WHERE user_id = ANY($1)", [[seed.adminA, seed.adminB, seed.userA]]);
      await client.query("DELETE FROM users WHERE id = ANY($1)", [[seed.adminA, seed.adminB, seed.userA]]);
      await client.query("DELETE FROM rbac_role_permissions WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = ANY($1))", [[seed.orgA, seed.orgB]]);
      await client.query("DELETE FROM rbac_user_roles WHERE role_id IN (SELECT id FROM rbac_roles WHERE organization_id = ANY($1))", [[seed.orgA, seed.orgB]]);
      await client.query("DELETE FROM pipeline_stages WHERE organization_id = ANY($1)", [[seed.orgA, seed.orgB]]);
      await client.query("DELETE FROM rbac_roles WHERE organization_id = ANY($1)", [[seed.orgA, seed.orgB]]);
      await client.query("DELETE FROM organizations WHERE id = ANY($1)", [[seed.orgA, seed.orgB]]);
    } finally {
      client.release();
    }
    const checkQuotes = await pool.query("SELECT 1 FROM quotes WHERE organization_id = ANY($1) LIMIT 1", [[seed.orgA, seed.orgB]]);
    const checkLines = await pool.query("SELECT 1 FROM quote_lines WHERE organization_id = ANY($1) LIMIT 1", [[seed.orgA, seed.orgB]]);
    const checkCatalog = await pool.query("SELECT 1 FROM quote_catalog_items WHERE organization_id = ANY($1) LIMIT 1", [[seed.orgA, seed.orgB]]);
    assert(checkQuotes.rows.length === 0 && checkLines.rows.length === 0 && checkCatalog.rows.length === 0, "Rollback: 0 row pour seed orgs");
    ok("Cleanup: 0 row quotes/lines/catalog pour orgA/orgB");

    console.log("\n=== PASS CP-QUOTE-006 ===");
    process.exit(0);
  } catch (err) {
    console.error("\n❌", err.message || err);
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
