/**
 * CP-032 — Tests Upload Documents (Stockage Local VPS)
 * Usage: cd backend && node scripts/test-document-upload-local.js
 *
 * Teste :
 * - Création client
 * - Upload fichier test
 * - Vérification fichier existe physiquement
 * - Téléchargement via API
 * - Suppression
 * - Vérification suppression disque + DB
 */

import "../config/register-local-env.js";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import path from "path";
import { execSync } from "child_process";
import fs from "fs/promises";
import fetch from "node-fetch";
import FormData from "form-data";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const BACKEND_DIR = path.resolve(__dirname, "..");
const STORAGE_ROOT = path.resolve(BACKEND_DIR, "storage");
const BASE_URL = "http://localhost:3000";
const PORT = 3000;


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

async function ensureTestClient(pool) {
  const client = await pool.connect();
  try {
    const orgRes = await client.query("SELECT id FROM organizations LIMIT 1");
    if (orgRes.rows.length === 0) throw new Error("Aucune organisation");
    const orgId = orgRes.rows[0].id;

    const clientNum = `CLI-DOC-${Date.now()}`;
    const ins = await client.query(
      `INSERT INTO clients (organization_id, client_number, company_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [orgId, clientNum, "Test Document Local"]
    );
    return { clientId: ins.rows[0].id, orgId };
  } finally {
    client.release();
  }
}

async function cleanupTestClient(pool, clientId) {
  const client = await pool.connect();
  try {
    if (clientId) {
      await client.query("DELETE FROM entity_documents WHERE entity_type = 'client' AND entity_id = $1", [clientId]);
    }
    await client.query("DELETE FROM clients WHERE client_number LIKE 'CLI-DOC-%'");
  } finally {
    client.release();
  }
}

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("❌ DATABASE_URL manquant. Vérifiez .env.dev");
    process.exit(1);
  }

  const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
  let serverProcess = null;

  try {
    killProcessOnPort(PORT);
    await sleep(500);

    serverProcess = spawn("node", ["bootstrap.js"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, RBAC_ENFORCE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await sleep(3000);

    const health = await fetch(`${BASE_URL}/`);
    if (!health.ok) throw new Error("Serveur non accessible");

    let testData;
    try {
      testData = await ensureTestClient(pool);
    } catch (e) {
      console.error("Erreur setup:", e.message);
      throw e;
    }

    const token = await login(SUPER_ADMIN.email, SUPER_ADMIN.password);

    const formData = new FormData();
    formData.append("entityType", "client");
    formData.append("entityId", testData.clientId);
    formData.append("file", Buffer.from("Contenu fichier test CP-032 stockage local"), {
      filename: "test-cp032-local.txt",
      contentType: "text/plain",
    });

    const uploadRes = await fetch(`${BASE_URL}/api/documents`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        ...formData.getHeaders(),
      },
      body: formData,
    });

    if (uploadRes.status !== 201) {
      const errData = await uploadRes.json().catch(() => ({}));
      fail("Upload", `status ${uploadRes.status}: ${JSON.stringify(errData)}`);
      await cleanupTestClient(pool, testData.clientId);
      throw new Error("Upload échoué");
    }

    const docData = await uploadRes.json();
    ok("Upload fichier test");

    if (!docData.id) {
      fail("Upload", "Réponse sans id");
      throw new Error("Réponse invalide");
    }

    const dbCheck = await pool.query(
      "SELECT id, storage_key FROM entity_documents WHERE id = $1",
      [docData.id]
    );
    if (dbCheck.rows.length === 0) {
      fail("DB", "Document non trouvé en base");
      throw new Error("Document absent en DB");
    }
    ok("Document présent en DB");

    const storageKey = dbCheck.rows[0].storage_key;
    const physicalPath = path.resolve(STORAGE_ROOT, storageKey.replace(/\//g, path.sep));
    try {
      await fs.access(physicalPath);
      ok("Fichier existe physiquement sur le disque");
    } catch (e) {
      fail("Fichier physique", `Non trouvé: ${physicalPath}`);
      throw new Error("Fichier absent sur disque");
    }

    const downloadRes = await fetch(`${BASE_URL}/api/documents/${docData.id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (downloadRes.status !== 200) {
      fail("Téléchargement", `status ${downloadRes.status}`);
      throw new Error("Téléchargement échoué");
    }
    const downloadedContent = await downloadRes.text();
    if (!downloadedContent.includes("Contenu fichier test CP-032 stockage local")) {
      fail("Téléchargement", "Contenu incorrect");
      throw new Error("Contenu téléchargé invalide");
    }
    ok("Téléchargement via API OK");

    const delRes = await fetch(`${BASE_URL}/api/documents/${docData.id}`, {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
    });
    if (delRes.status !== 204) {
      const errData = await delRes.json().catch(() => ({}));
      fail("Suppression", `status ${delRes.status}: ${JSON.stringify(errData)}`);
      throw new Error("Suppression échouée");
    }
    ok("Suppression document");

    const dbAfter = await pool.query("SELECT id FROM entity_documents WHERE id = $1", [docData.id]);
    if (dbAfter.rows.length > 0) {
      fail("DB après suppression", "Document encore présent");
      throw new Error("Document non supprimé de la DB");
    }
    ok("Document supprimé de la DB");

    try {
      await fs.access(physicalPath);
      fail("Fichier après suppression", "Fichier encore présent sur disque");
      throw new Error("Fichier non supprimé du disque");
    } catch (e) {
      if (e.code === "ENOENT") {
        ok("Fichier supprimé du disque");
      } else {
        throw e;
      }
    }

    await cleanupTestClient(pool, testData.clientId);
  } catch (err) {
    console.error("Erreur:", err.message || err);
    throw err;
  } finally {
    await pool.end();
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch(() => process.exit(1));
