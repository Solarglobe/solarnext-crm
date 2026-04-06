/**
 * CP-FAR-007 — Tests DSM fallback (RELIEF_ONLY vs SURFACE_DSM)
 * Usage: cd backend && npm run test-horizon-dsm-fallback
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BACKEND_DIR = resolve(__dirname, "..");
const PORT = 5057;
const BASE_URL = `http://localhost:${PORT}`;

let passed = 0;
let failed = 0;

function ok(label) {
  console.log("✅ " + label);
  passed++;
}

function fail(label, msg) {
  console.log("❌ " + label + ": " + msg);
  failed++;
}

function assert(cond, label, msg) {
  if (cond) ok(label);
  else fail(label, msg || "assertion failed");
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

async function runServer(envOverrides = {}) {
  killProcessOnPort(PORT);
  await sleep(500);
  const serverProcess = spawn("node", ["bootstrap.js"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: String(PORT), ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const ready = await waitForServer();
  return ready ? serverProcess : null;
}

async function main() {
  let serverProcess = null;

  try {
    // --- A) DSM disabled (par défaut) ---
    console.log("\n--- A) DSM disabled: source RELIEF_ONLY, dataCoverage ---");
    serverProcess = await runServer({ HORIZON_DSM_ENABLED: "false" });
    if (!serverProcess) {
      fail("Start", "Serveur non accessible");
      process.exit(1);
    }
    ok("Serveur démarré (DSM disabled)");

    const url = `${BASE_URL}/api/horizon-mask?lat=48.8566&lon=2.3522&radius=500&step=2`;
    const resA = await fetch(url);
    assert(resA.status === 200, "GET → 200");
    const jsonA = await resA.json();

    assert(jsonA.source === "RELIEF_ONLY", "source === RELIEF_ONLY");
    assert(jsonA.dataCoverage != null, "dataCoverage présent");
    assert(jsonA.dataCoverage.mode === "RELIEF_ONLY", "dataCoverage.mode === RELIEF_ONLY");
    assert(jsonA.dataCoverage.available === true, "dataCoverage.available === true");
    assert(
      Array.isArray(jsonA.dataCoverage.notes) &&
        jsonA.dataCoverage.notes.some((n) => n.includes("SURFACE_DSM") || n.includes("DSM")),
      "dataCoverage.notes indique DSM indispo"
    );
    assert(typeof jsonA.confidence === "number", "confidence cohérent");

    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
    serverProcess = null;

    // --- B) DSM enabled ---
    console.log("\n--- B) DSM enabled: source SURFACE_DSM ---");
    serverProcess = await runServer({
      HORIZON_DSM_ENABLED: "true",
      HORIZON_DSM_RESOLUTION_M: "1",
    });
    if (!serverProcess) process.exit(1);
    ok("Serveur démarré (DSM enabled)");

    const resB1 = await fetch(url);
    assert(resB1.status === 200, "GET → 200");
    const jsonB1 = await resB1.json();

    assert(jsonB1.source === "SURFACE_DSM", "source === SURFACE_DSM");
    assert(jsonB1.resolution_m === 1, "resolution_m === 1");
    assert(jsonB1.dataCoverage?.available === true, "dataCoverage.available === true");
    assert(jsonB1.cached === false, "1er call cached=false");

    const resB2 = await fetch(url);
    const jsonB2 = await resB2.json();
    assert(jsonB2.cached === true, "2e call cached=true");

    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
    serverProcess = null;

    // --- C) Cache key safety: DSM disabled puis enabled ---
    console.log("\n--- C) Cache key safety: DSM disabled vs enabled ---");
    serverProcess = await runServer({ HORIZON_DSM_ENABLED: "false" });
    if (!serverProcess) process.exit(1);

    const resC1 = await fetch(url);
    const jsonC1 = await resC1.json();
    assert(jsonC1.source === "RELIEF_ONLY", "run 1 (DSM off): source RELIEF_ONLY");

    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
    serverProcess = null;

    serverProcess = await runServer({ HORIZON_DSM_ENABLED: "true" });
    if (!serverProcess) process.exit(1);

    const resC2 = await fetch(url);
    const jsonC2 = await resC2.json();
    assert(jsonC2.source === "SURFACE_DSM", "run 2 (DSM on): source SURFACE_DSM (clé cache diff)");

    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
  } catch (err) {
    console.error("Erreur:", err.message);
    failed++;
  } finally {
    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess?.exitCode === null) serverProcess.kill("SIGKILL");
    }
  }

  console.log("\n--- RÉSUMÉ ---");
  console.log("Passed: " + passed + ", Failed: " + failed);

  if (failed > 0) {
    console.log("\n❌ FAIL");
    process.exit(1);
  }
  console.log("\n✅ PASS");
  process.exit(0);
}

main();
