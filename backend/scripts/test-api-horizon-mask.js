/**
 * CP-FAR-002 — Tests API /api/horizon-mask
 * Usage: cd backend && npm run test-api-horizon-mask
 *
 * Lance le serveur sur port 5055, appelle l'endpoint, vérifie cache et validation.
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BACKEND_DIR = resolve(__dirname, "..");
const PORT = 5055;
const BASE_URL = `http://localhost:${PORT}`;

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

async function waitForServer(maxAttempts = 15) {
  for (let i = 0; i < maxAttempts; i++) {
    try {
      const res = await fetch(`${BASE_URL}/`);
      if (res.ok) return true;
    } catch (_) {}
    await sleep(500);
  }
  return false;
}

async function main() {
  let serverProcess = null;
  let passed = 0;
  let failed = 0;

  try {
    killProcessOnPort(PORT);
    await sleep(500);

    serverProcess = spawn("node", ["bootstrap.js"], {
      cwd: BACKEND_DIR,
      env: { ...process.env, PORT: String(PORT) },
      stdio: ["ignore", "pipe", "pipe"],
    });

    const ready = await waitForServer();
    if (!ready) {
      fail("Start", "Serveur non accessible après 15 tentatives");
      process.exit(1);
    }
    ok("Serveur démarré sur port " + PORT);

    // --- 1) Premier appel (cached=false) ---
    const url1 = `${BASE_URL}/api/horizon-mask?lat=48.8566&lon=2.3522&radius=500&step=2`;
    const res1 = await fetch(url1);

    if (res1.status !== 200) {
      fail("GET valid params", `status ${res1.status} au lieu de 200`);
      failed++;
    } else {
      passed++;
      ok("GET valid params → 200");
    }

    const json1 = await res1.json();

    if (json1.source !== "RELIEF_ONLY") {
      fail("source", `got ${json1.source}`);
      failed++;
    } else {
      passed++;
      ok("json.source === RELIEF_ONLY");
    }

    if (!Array.isArray(json1.mask) || json1.mask.length !== 180) {
      fail("mask.length", `got ${json1.mask?.length}`);
      failed++;
    } else {
      passed++;
      ok("json.mask.length === 180");
    }

    if (json1.cached !== false) {
      fail("cached (1er call)", `got ${json1.cached}`);
      failed++;
    } else {
      passed++;
      ok("json.cached === false (premier call)");
    }

    // --- 2) Deuxième appel identique (cached=true) ---
    const res2 = await fetch(url1);

    if (res2.status !== 200) {
      fail("GET 2e call", `status ${res2.status}`);
      failed++;
    } else {
      passed++;
      ok("2e GET → 200");
    }

    const json2 = await res2.json();

    if (json2.cached !== true) {
      fail("cached (2e call)", `got ${json2.cached}`);
      failed++;
    } else {
      passed++;
      ok("json.cached === true (deuxième call)");
    }

    if (JSON.stringify(json1.mask) !== JSON.stringify(json2.mask)) {
      fail("mask identique", "masks différents entre les deux appels");
      failed++;
    } else {
      passed++;
      ok("mask identique entre les deux appels");
    }

    // --- 3) Invalid params (lat=999) ---
    const urlInvalid = `${BASE_URL}/api/horizon-mask?lat=999&lon=2`;
    const resInvalid = await fetch(urlInvalid);

    if (resInvalid.status !== 400) {
      fail("GET invalid params", `status ${resInvalid.status} au lieu de 400`);
      failed++;
    } else {
      passed++;
      ok("GET invalid params → 400");
    }

    const jsonInvalid = await resInvalid.json();

    if (jsonInvalid?.error?.code !== "INVALID_PARAMS") {
      fail("error.code", `got ${jsonInvalid?.error?.code}`);
      failed++;
    } else {
      passed++;
      ok("error.code === INVALID_PARAMS");
    }
  } catch (err) {
    console.error("Erreur:", err.message);
    failed++;
  } finally {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
      }
      ok("Serveur arrêté proprement");
    }
  }

  // --- Résumé ---
  console.log("\n--- RÉSUMÉ ---");
  console.log(`Passed: ${passed}, Failed: ${failed}`);

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
}

main();
