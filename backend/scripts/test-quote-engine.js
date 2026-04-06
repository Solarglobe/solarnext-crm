/**
 * CP-QUOTE-004 — Tests moteur devis (snapshot catalogue, totaux cents/bps)
 * Test 100% autonome : DB localhost si host=db, serveur spawn si SERVER_URL non défini.
 * Usage: cd backend && node scripts/test-quote-engine.js
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

// --- Charger env AVANT tout accès DB ---
dotenv.config({ path: resolve(BACKEND_DIR, "../.env.dev"), override: false });
dotenv.config({ path: resolve(BACKEND_DIR, ".env"), override: false });

// --- ÉTAPE 1 : DB test autonome (uniquement dans ce script) ---
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
const TEST_PORT = Number(process.env.TEST_PORT) || 5056;
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
  return data.token;
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

// --- Unit tests (pur, sans DB) ---
function runUnitTests(computeQuoteTotals) {
  console.log("--- 1) Unit tests (computeQuoteTotals pur) ---\n");

  const items1 = [
    { qty: 10, unit_price_ht_cents: 1000, vat_rate_bps: 2000, pricing_mode: "UNIT" },
  ];
  const tot1 = computeQuoteTotals(items1);
  if (tot1.total_ht_cents !== 10000 || tot1.total_vat_cents !== 2000 || tot1.total_ttc_cents !== 12000) {
    fail("UNIT qty=10 unit=1000 vat=2000", `attendu ht=10000 vat=2000 ttc=12000, reçu ${JSON.stringify(tot1)}`);
    throw new Error("Unit test 1");
  }
  ok("UNIT qty=10 unit=1000 vat=2000 => ht=10000 vat=2000 ttc=12000");

  const items2 = [
    { qty: 1, unit_price_ht_cents: 50000, vat_rate_bps: 1000, pricing_mode: "FIXED" },
  ];
  const tot2 = computeQuoteTotals(items2);
  if (tot2.total_ht_cents !== 50000 || tot2.total_vat_cents !== 5000 || tot2.total_ttc_cents !== 55000) {
    fail("FIXED unit=50000 vat=1000", `attendu ht=50000 vat=5000 ttc=55000, reçu ${JSON.stringify(tot2)}`);
    throw new Error("Unit test 2");
  }
  ok("FIXED unit=50000 vat=1000 => ht=50000 vat=5000 ttc=55000");

  const items3 = [
    { qty: 10, unit_price_ht_cents: 1000, vat_rate_bps: 2000, pricing_mode: "UNIT" },
    { qty: 1, unit_price_ht_cents: 50000, vat_rate_bps: 1000, pricing_mode: "FIXED" },
  ];
  const tot3 = computeQuoteTotals(items3);
  if (tot3.total_ht_cents !== 60000 || tot3.total_vat_cents !== 7000 || tot3.total_ttc_cents !== 67000) {
    fail("Combiné", `attendu ht=60000 vat=7000 ttc=67000, reçu ${JSON.stringify(tot3)}`);
    throw new Error("Unit test 3");
  }
  ok("Combiné => ht=60000 vat=7000 ttc=67000");

  const items4 = [
    { qty: 1, unit_price_ht_cents: 999, vat_rate_bps: 550, pricing_mode: "FIXED" },
  ];
  const tot4 = computeQuoteTotals(items4);
  if (tot4.total_vat_cents !== 55) {
    fail("Arrondi TVA 999×550bps", `attendu vat=55, reçu ${tot4.total_vat_cents}`);
    throw new Error("Unit test 4");
  }
  ok("Arrondi TVA ht=999 vat_bps=550 => vat=55");

  const items5 = [
    { qty: 10, unit_price_ht_cents: 1000, vat_rate_bps: 2000, pricing_mode: "UNIT", is_active: true },
    { qty: 1, unit_price_ht_cents: 50000, vat_rate_bps: 1000, pricing_mode: "FIXED", is_active: false },
  ];
  const tot5 = computeQuoteTotals(items5);
  if (tot5.total_ht_cents !== 10000 || tot5.total_vat_cents !== 2000) {
    fail("Ligne inactive exclue", `attendu ht=10000 vat=2000, reçu ${tot5.total_ht_cents} ${tot5.total_vat_cents}`);
    throw new Error("Unit test 5");
  }
  ok("Ligne inactive exclue du total");

  console.log("");
}

/** Applique idempotemment les colonnes CP-QUOTE-004 sur quote_lines si absentes (test autonome). */
async function ensureQuoteLinesCp004Columns(pool) {
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

async function ensureTestData(pool) {
  const client = await pool.connect();
  try {
    const orgRes = await client.query("SELECT id FROM organizations LIMIT 1");
    if (orgRes.rows.length === 0) throw new Error("Aucune organisation");
    const orgId = orgRes.rows[0].id;

    const clientNum = `CLI-CP004-${Date.now()}`;
    await client.query(
      `INSERT INTO clients (organization_id, client_number, company_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [orgId, clientNum, "Test CP-QUOTE-004"]
    );
    const clientId = (await client.query(
      `SELECT id FROM clients WHERE organization_id = $1 AND client_number = $2`,
      [orgId, clientNum]
    )).rows[0].id;

    const nameUnit = `Cat UNIT ${Date.now()}`;
    const nameFixed = `Cat FIXED ${Date.now()}`;
    await client.query(
      `INSERT INTO quote_catalog_items (organization_id, name, category, pricing_mode, sale_price_ht_cents, purchase_price_ht_cents, default_vat_rate_bps)
       VALUES ($1, $2, 'PANEL', 'UNIT', 1000, 800, 2000)`,
      [orgId, nameUnit]
    );
    const rowUnit = (await client.query(
      `SELECT id FROM quote_catalog_items WHERE organization_id = $1 AND name = $2`,
      [orgId, nameUnit]
    )).rows[0];
    await client.query(
      `INSERT INTO quote_catalog_items (organization_id, name, category, pricing_mode, sale_price_ht_cents, purchase_price_ht_cents, default_vat_rate_bps)
       VALUES ($1, $2, 'SERVICE', 'FIXED', 50000, 40000, 1000)`,
      [orgId, nameFixed]
    );
    const rowFixed = (await client.query(
      `SELECT id FROM quote_catalog_items WHERE organization_id = $1 AND name = $2`,
      [orgId, nameFixed]
    )).rows[0];

    return {
      clientId,
      catalogUnitId: rowUnit.id,
      catalogFixedId: rowFixed.id,
      orgId,
    };
  } finally {
    client.release();
  }
}

async function cleanupTestData(pool, quoteId, catalogIds) {
  const client = await pool.connect();
  try {
    if (quoteId) {
      await client.query("DELETE FROM quote_lines WHERE quote_id = $1", [quoteId]);
      await client.query("DELETE FROM quotes WHERE id = $1", [quoteId]);
    }
    if (catalogIds?.length) {
      await client.query("DELETE FROM quote_catalog_items WHERE id = ANY($1)", [catalogIds]);
    }
    await client.query("DELETE FROM clients WHERE client_number LIKE 'CLI-CP004-%'");
  } finally {
    client.release();
  }
}

async function runIntegrationTests(pool, token) {
  console.log("--- 2) Integration (API quotes + from-catalog, PATCH, deactivate, snapshot) ---\n");

  await ensureQuoteLinesCp004Columns(pool);
  const testData = await ensureTestData(pool);
  const { clientId, catalogUnitId, catalogFixedId } = testData;

  let quoteId;
  let line1Id;
  let line2Id;

  try {
    // ✔ Création devis
    const createRes = await api(token, "POST", "/api/quotes", { client_id: clientId });
    if (createRes.status !== 201) {
      fail("POST /api/quotes", `${createRes.status}: ${JSON.stringify(createRes.data)}`);
      throw new Error("Création devis");
    }
    quoteId = createRes.data.quote?.id;
    if (!quoteId) {
      fail("POST /api/quotes", "quote.id manquant");
      throw new Error("quote.id manquant");
    }
    ok("Création devis");

    // ✔ Ajout ligne from-catalog + totaux
    const add1 = await api(token, "POST", `/api/quotes/${quoteId}/items/from-catalog`, {
      catalogItemId: catalogUnitId,
      qty: 10,
    });
    if (add1.status !== 201) {
      fail("POST from-catalog UNIT", `${add1.status}: ${JSON.stringify(add1.data)}`);
      throw new Error("Add from catalog");
    }
    line1Id = add1.data.item?.id;
    if (!line1Id) {
      fail("POST from-catalog", "item.id manquant");
      throw new Error("item.id manquant");
    }
    const t1 = add1.data.totals;
    if (t1.total_ht_cents !== 10000 || t1.total_vat_cents !== 2000 || t1.total_ttc_cents !== 12000) {
      fail("Totaux après ligne UNIT", `attendu 10000/2000/12000, reçu ${t1.total_ht_cents}/${t1.total_vat_cents}/${t1.total_ttc_cents}`);
      throw new Error("Totaux 1");
    }
    ok("Ajout ligne from-catalog + totaux 10000/2000/12000");

    // ✔ Snapshot correct (snapshot_json présent)
    const getAfterAdd1 = await api(token, "GET", `/api/quotes/${quoteId}`);
    if (getAfterAdd1.status !== 200 || !getAfterAdd1.data.items?.length) {
      fail("GET quote", "items manquants");
      throw new Error("GET quote");
    }
    const line1Snap = getAfterAdd1.data.items.find((i) => i.id === line1Id)?.snapshot_json;
    if (!line1Snap || typeof line1Snap.name !== "string" || !line1Snap.source?.catalogItemId) {
      fail("Snapshot", "snapshot_json incomplet (name, source.catalogItemId)");
      throw new Error("Snapshot");
    }
    ok("Snapshot correct (snapshot_json stable)");

    // ✔ Ajout 2e ligne FIXED => totaux 60000/7000/67000
    const add2 = await api(token, "POST", `/api/quotes/${quoteId}/items/from-catalog`, {
      catalogItemId: catalogFixedId,
    });
    if (add2.status !== 201) {
      fail("POST from-catalog FIXED", `${add2.status}: ${JSON.stringify(add2.data)}`);
      throw new Error("Add FIXED");
    }
    line2Id = add2.data.item?.id;
    const t2 = add2.data.totals;
    if (t2.total_ht_cents !== 60000 || t2.total_vat_cents !== 7000 || t2.total_ttc_cents !== 67000) {
      fail("Totaux après ligne FIXED", `attendu 60000/7000/67000, reçu ${t2.total_ht_cents}/${t2.total_vat_cents}/${t2.total_ttc_cents}`);
      throw new Error("Totaux 2");
    }
    ok("Ligne FIXED => totaux 60000/7000/67000");

    // ✔ PATCH qty / totaux recalculés
    const patchRes = await api(token, "PATCH", `/api/quotes/${quoteId}/items/${line1Id}`, { qty: 5 });
    if (patchRes.status !== 200) {
      fail("PATCH item qty", `${patchRes.status}: ${JSON.stringify(patchRes.data)}`);
      throw new Error("PATCH");
    }
    const t3 = patchRes.data.totals;
    if (t3.total_ht_cents !== 55000 || t3.total_vat_cents !== 6000 || t3.total_ttc_cents !== 61000) {
      fail("Totaux après PATCH qty=5", `attendu 55000/6000/61000, reçu ${t3.total_ht_cents}/${t3.total_vat_cents}/${t3.total_ttc_cents}`);
      throw new Error("Totaux 3");
    }
    ok("PATCH qty / totaux recalculés 55000/6000/61000");

    // ✔ Deactivate + totaux
    const deactRes = await api(token, "POST", `/api/quotes/${quoteId}/items/${line2Id}/deactivate`);
    if (deactRes.status !== 200) {
      fail("POST deactivate", `${deactRes.status}: ${JSON.stringify(deactRes.data)}`);
      throw new Error("Deactivate");
    }
    const t4 = deactRes.data.totals;
    if (t4.total_ht_cents !== 5000 || t4.total_vat_cents !== 1000 || t4.total_ttc_cents !== 6000) {
      fail("Totaux après deactivate", `attendu 5000/1000/6000, reçu ${t4.total_ht_cents}/${t4.total_vat_cents}/${t4.total_ttc_cents}`);
      throw new Error("Totaux 4");
    }
    ok("Deactivate => totaux 5000/1000/6000");

    // ✔ Modification du catalogue APRÈS ajout
    const client = await pool.connect();
    let originalCatalogName;
    try {
      const r = await client.query(
        "SELECT name FROM quote_catalog_items WHERE id = $1",
        [catalogUnitId]
      );
      originalCatalogName = r.rows[0]?.name;
      await client.query(
        "UPDATE quote_catalog_items SET name = $1, sale_price_ht_cents = 9999 WHERE id = $2",
        ["Cat UNIT renommé", catalogUnitId]
      );
    } finally {
      client.release();
    }

    // ✔ Vérifier que la ligne du devis NE change PAS
    const getQuote = await api(token, "GET", `/api/quotes/${quoteId}`);
    if (getQuote.status !== 200 || !getQuote.data.items?.length) {
      fail("GET quote", "items manquants");
      throw new Error("GET quote");
    }
    const line1 = getQuote.data.items.find((i) => i.id === line1Id);
    if (!line1) {
      fail("Snapshot", "ligne 1 introuvable");
      throw new Error("Snapshot");
    }
    const snap = line1.snapshot_json || {};
    if (snap.name === "Cat UNIT renommé") {
      fail("Snapshot", "la ligne devis a été mise à jour par le catalogue (snapshot doit rester inchangé)");
      throw new Error("Snapshot");
    }
    if (originalCatalogName && snap.name !== originalCatalogName) {
      fail("Snapshot", `attendu name=${originalCatalogName}, reçu ${snap.name}`);
      throw new Error("Snapshot");
    }
    const line1HtCents = Math.round(Number(line1.unit_price_ht ?? 0) * 100);
    if (line1HtCents !== 1000) {
      fail("Snapshot", `prix ligne doit rester 1000 cents, reçu ${line1HtCents}`);
      throw new Error("Snapshot");
    }
    ok("Modification catalogue APRÈS ajout : ligne devis inchangée");
  } finally {
    await cleanupTestData(pool, quoteId, [catalogUnitId, catalogFixedId]);
  }

  console.log("");
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

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant. Vérifiez .env.dev ou .env");
    process.exit(1);
  }

  const pg = (await import("pg")).default;
  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

  let serverProcess = null;

  try {
    console.log("=== CP-QUOTE-004 MOTEUR DEVIS (snapshot + totaux) ===\n");

    const { computeQuoteTotals } = await import("../services/quoteEngine.service.js");
    runUnitTests(computeQuoteTotals);

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
      console.log("Utilisation du serveur externe:", BASE_URL, "\n");
      await waitForServer(BASE_URL + "/", 3, 2000);
    }

    const token = await login(SUPER_ADMIN.email, SUPER_ADMIN.password);
    await runIntegrationTests(pool, token);

    console.log("=== PASS CP-QUOTE-004 ===");
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
