/**
 * CP-031 — Tests moteur Studies + versioning strict
 * Usage: cd backend && node scripts/test-study-versioning.js
 *
 * Teste :
 * - Création client
 * - Création study
 * - Vérifier version 1
 * - Création version 2
 * - Vérifier current_version = 2
 * - Vérifier version 1 toujours intacte
 * - Cross-org rejetée
 */

import "../config/register-local-env.js";
import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
import fetch from "node-fetch";
import pg from "pg";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BACKEND_DIR = resolve(__dirname, "..");
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

async function ensureTestData(pool) {
  const client = await pool.connect();
  try {
    const orgRes = await client.query("SELECT id FROM organizations LIMIT 1");
    if (orgRes.rows.length === 0) throw new Error("Aucune organisation");
    const orgId = orgRes.rows[0].id;

    const clientNum = `CLI-STUDY-${Date.now()}`;
    const ins = await client.query(
      `INSERT INTO clients (organization_id, client_number, company_name)
       VALUES ($1, $2, $3) RETURNING id`,
      [orgId, clientNum, "Test Study Client"]
    );
    return { clientId: ins.rows[0].id, orgId };
  } finally {
    client.release();
  }
}

async function getOtherOrgId(pool, excludeOrgId) {
  const res = await pool.query(
    "SELECT id FROM organizations WHERE id != $1 LIMIT 1",
    [excludeOrgId]
  );
  return res.rows.length > 0 ? res.rows[0].id : null;
}

async function cleanupTestData(pool, studyId, clientId) {
  const client = await pool.connect();
  try {
    if (studyId) {
      await client.query("DELETE FROM study_versions WHERE study_id = $1", [studyId]);
      await client.query("DELETE FROM studies WHERE id = $1", [studyId]);
    }
    if (clientId) {
      await client.query("DELETE FROM clients WHERE id = $1", [clientId]);
    }
    await client.query("DELETE FROM clients WHERE client_number LIKE 'CLI-STUDY-%'");
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
    console.log("=== CP-031 MOTEUR STUDIES + VERSIONING TESTS ===\n");

    killProcessOnPort(PORT);
    await sleep(500);

    console.log("Démarrage du serveur...");
    serverProcess = spawn("node", ["bootstrap.js"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, RBAC_ENFORCE: "1" },
      stdio: ["ignore", "pipe", "pipe"],
    });

    await sleep(3000);

    const health = await fetch(`${BASE_URL}/`);
    if (!health.ok) throw new Error("Serveur non accessible");
    console.log("Serveur prêt.\n");

    let testData;
    try {
      testData = await ensureTestData(pool);
    } catch (e) {
      console.error("Erreur setup:", e.message);
      throw e;
    }

    const token = await login(SUPER_ADMIN.email, SUPER_ADMIN.password);

    // 1. Création study
    const createRes = await api(token, "POST", "/api/studies", {
      client_id: testData.clientId,
      title: "Étude test CP-031",
    });

    if (createRes.status !== 201) {
      fail("Création study", `status ${createRes.status}: ${JSON.stringify(createRes.data)}`);
      throw new Error("Création study échouée");
    }
    ok("Création study");

    const studyId = createRes.data.study?.id;
    if (!studyId) {
      fail("Création study", "study.id manquant");
      throw new Error("study.id manquant");
    }

    // 2. Vérifier version 1
    const study1 = createRes.data;
    if (!study1.versions || study1.versions.length !== 1) {
      fail("Version 1", `attendu 1 version, reçu ${study1.versions?.length ?? 0}`);
      throw new Error("Version 1 manquante");
    }
    if (study1.versions[0].version_number !== 1) {
      fail("Version 1", `version_number attendu 1, reçu ${study1.versions[0].version_number}`);
      throw new Error("version_number incorrect");
    }
    ok("Version 1 présente");

    const version1Data = study1.versions[0].data;
    if (version1Data === undefined || (typeof version1Data === "object" && Object.keys(version1Data || {}).length !== 0)) {
      // data doit être {} ou équivalent vide
      const isEmpty = version1Data && typeof version1Data === "object" && Object.keys(version1Data).length === 0;
      if (!isEmpty && version1Data !== undefined) {
        fail("Version 1 data", `attendu {} vide, reçu ${JSON.stringify(version1Data)}`);
      }
    }
    ok("Version 1 data vide {}");

    if (study1.study.current_version !== 1) {
      fail("current_version", `attendu 1, reçu ${study1.study.current_version}`);
      throw new Error("current_version incorrect");
    }
    ok("current_version = 1");

    // 3. Numérotation SGS-YYYY-NNNN
    if (!/^SGS-\d{4}-\d{4}$/.test(study1.study.study_number)) {
      fail("Numéro study", `format attendu SGS-YYYY-NNNN, reçu ${study1.study.study_number}`);
    } else {
      ok(`Numéro study ${study1.study.study_number}`);
    }

    // 4. Création version 2
    const version2Res = await api(token, "POST", `/api/studies/${studyId}/versions`, {
      data: { test: "v2" },
    });

    if (version2Res.status !== 201) {
      fail("Création version 2", `status ${version2Res.status}: ${JSON.stringify(version2Res.data)}`);
      throw new Error("Création version 2 échouée");
    }
    ok("Création version 2");

    // 5. Vérifier current_version = 2
    const study2 = version2Res.data;
    if (study2.study.current_version !== 2) {
      fail("current_version après v2", `attendu 2, reçu ${study2.study.current_version}`);
      throw new Error("current_version incorrect");
    }
    ok("current_version = 2");

    // 6. Vérifier version 1 toujours intacte
    const getRes = await api(token, "GET", `/api/studies/${studyId}/version/1`);
    if (getRes.status !== 200) {
      fail("Récupération version 1", `status ${getRes.status}`);
      throw new Error("Version 1 inaccessible");
    }
    const v1 = getRes.data;
    if (v1.version_number !== 1) {
      fail("Version 1 intacte", `version_number attendu 1, reçu ${v1.version_number}`);
    } else {
      ok("Version 1 toujours intacte (récupérable)");
    }

    // Vérifier que v1 a bien data vide (pas modifié par v2)
    const v1DataKeys = v1.data && typeof v1.data === "object" ? Object.keys(v1.data) : [];
    if (v1DataKeys.length > 0) {
      fail("Version 1 immuable", `data aurait dû rester vide, reçu ${JSON.stringify(v1.data)}`);
    } else {
      ok("Version 1 data inchangée (immuable)");
    }

    // Vérifier v2 a bien data { test: "v2" }
    const getV2Res = await api(token, "GET", `/api/studies/${studyId}/version/2`);
    if (getV2Res.status !== 200) {
      fail("Récupération version 2", `status ${getV2Res.status}`);
    } else if (getV2Res.data?.data?.test !== "v2") {
      fail("Version 2 data", `attendu { test: 'v2' }, reçu ${JSON.stringify(getV2Res.data?.data)}`);
    } else {
      ok("Version 2 data correcte");
    }

    // 7. Cross-org rejetée — tenter d'accéder à une study avec un autre org
    const otherOrgId = await getOtherOrgId(pool, testData.orgId);
    if (otherOrgId) {
      // Créer un client dans l'autre org et une study
      const client2Res = await pool.query(
        `INSERT INTO clients (organization_id, client_number, company_name)
         VALUES ($1, $2, $3) RETURNING id`,
        [otherOrgId, `CLI-OTHER-${Date.now()}`, "Autre org client"]
      );
      const otherClientId = client2Res.rows[0].id;

      const otherStudyRes = await pool.query(
        `INSERT INTO studies (organization_id, client_id, study_number, current_version)
         VALUES ($1, $2, $3, 1) RETURNING id`,
        [otherOrgId, otherClientId, `SGS-${new Date().getFullYear()}-9999`]
      );
      const otherStudyId = otherStudyRes.rows[0].id;

      const crossGet = await api(token, "GET", `/api/studies/${otherStudyId}`);
      if (crossGet.status !== 404) {
        fail("Cross-org rejetée", `attendu 404, reçu ${crossGet.status}`);
        throw new Error("Cross-org aurait dû être rejetée");
      }
      ok("Cross-org rejetée (404)");

      await pool.query("DELETE FROM study_versions WHERE study_id = $1", [otherStudyId]);
      await pool.query("DELETE FROM studies WHERE id = $1", [otherStudyId]);
      await pool.query("DELETE FROM clients WHERE id = $1", [otherClientId]);
    } else {
      ok("Cross-org (1 seule org, test ignoré)");
    }

    await cleanupTestData(pool, studyId, testData.clientId);

    console.log("\n=== MOTEUR STUDIES + VERSIONING VALIDÉ ✅ ===\n");
  } catch (err) {
    console.error("\n❌ Erreur:", err.message || err);
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
