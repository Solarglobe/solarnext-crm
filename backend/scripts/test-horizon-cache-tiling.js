/**
 * CP-FAR-006 — Tests cache horizon par tuile
 * Usage: cd backend && npm run test-horizon-cache-tiling
 */

import { spawn } from "child_process";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import { execSync } from "child_process";
import fetch from "node-fetch";

import {
  getOrComputeHorizonMask,
  __testGetStats,
  __testResetStats,
  __testClearCache,
  tileKey,
} from "../services/horizon/horizonMaskCache.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const BACKEND_DIR = resolve(__dirname, "..");
const PORT = 5056;
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

async function runHttpTests(envOverrides = {}) {
  killProcessOnPort(PORT);
  await sleep(500);

  const serverProcess = spawn("node", ["bootstrap.js"], {
    cwd: BACKEND_DIR,
    env: { ...process.env, PORT: String(PORT), ...envOverrides },
    stdio: ["ignore", "pipe", "pipe"],
  });

  const ready = await waitForServer();
  if (!ready) {
    fail("Start", "Serveur non accessible");
    return null;
  }
  ok("Serveur démarré sur port " + PORT);

  return serverProcess;
}

async function main() {
  let serverProcess = null;

  try {
    // --- Test direct: même tuile (sans serveur) ---
    console.log("\n--- 1) Même tuile => 2e call cached=true ---");
    process.env.HORIZON_CACHE_TILE_DEG = "0.01";
    __testClearCache();
    __testResetStats();

    const computeFn = () => ({
      source: "RELIEF_ONLY",
      mask: [{ az: 0, elev: 1 }],
    });

    const r1 = await getOrComputeHorizonMask(
      { lat: 48.8566, lon: 2.3522, radius_m: 500, step_deg: 2 },
      computeFn
    );
    assert(!r1.cached, "1er call cached=false");

    const r2 = await getOrComputeHorizonMask(
      { lat: 48.85665, lon: 2.35225, radius_m: 500, step_deg: 2 },
      computeFn
    );
    assert(r2.cached, "2e call (même tuile) cached=true");

    const k1 = tileKey(48.8566, 2.3522, 500, 2, 0.01, "public");
    const k2 = tileKey(48.85665, 2.35225, 500, 2, 0.01, "public");
    assert(k1 === k2, "clés tuile identiques pour points proches");

    // --- 2) HTTP: deux points proches (même tuile) => 2e cached=true ---
    console.log("\n--- 2) HTTP: deux points proches => 2e cached=true ---");
    serverProcess = await runHttpTests({ HORIZON_CACHE_TILE_DEG: "0.01" });
    if (!serverProcess) process.exit(1);

    const url1 = `${BASE_URL}/api/horizon-mask?lat=48.856600&lon=2.352200&radius=500&step=2`;
    const url2 = `${BASE_URL}/api/horizon-mask?lat=48.856650&lon=2.352250&radius=500&step=2`;

    const resClose1 = await fetch(url1);
    assert(resClose1.status === 200, "GET point 1 → 200");
    const jsonClose1 = await resClose1.json();
    assert(jsonClose1.cached === false, "1er call cached=false");

    const resClose2 = await fetch(url2);
    assert(resClose2.status === 200, "GET point 2 (même tuile) → 200");
    const jsonClose2 = await resClose2.json();
    assert(jsonClose2.cached === true, "2e call (même tuile) cached=true");

    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
    serverProcess = null;

    // --- 3) Point loin (autre tuile) ---
    console.log("\n--- 3) Point loin => cached=false au 1er call ---");
    serverProcess = await runHttpTests({ HORIZON_CACHE_TILE_DEG: "0.01" });
    if (!serverProcess) process.exit(1);

    const urlFar = `${BASE_URL}/api/horizon-mask?lat=48.87&lon=2.37&radius=500&step=2`;
    const resFar = await fetch(urlFar);
    assert(resFar.status === 200, "GET point loin → 200");
    const jsonFar = await resFar.json();
    assert(jsonFar.cached === false, "1er call tuile loin cached=false");

    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
    serverProcess = null;

    // --- 4) Test TTL (10ms) ---
    console.log("\n--- 4) Test TTL (10ms) ---");
    serverProcess = await runHttpTests({
      HORIZON_CACHE_TTL_MS: "10",
    });
    if (!serverProcess) process.exit(1);

    const urlTtl = `${BASE_URL}/api/horizon-mask?lat=48.85&lon=2.35&radius=500&step=2`;
    const resTtl1 = await fetch(urlTtl);
    assert(resTtl1.status === 200, "GET TTL call 1 → 200");
    const jsonTtl1 = await resTtl1.json();
    assert(jsonTtl1.cached === false, "call 1 cached=false");

    await sleep(20);

    const resTtl2 = await fetch(urlTtl);
    assert(resTtl2.status === 200, "GET TTL call 2 → 200");
    const jsonTtl2 = await resTtl2.json();
    assert(jsonTtl2.cached === false, "call 2 après 20ms cached=false (expiré)");

    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      await sleep(500);
      if (serverProcess.exitCode === null) serverProcess.kill("SIGKILL");
    }
    serverProcess = null;

    // --- 5) Test inflight dedupe (direct, pas HTTP) ---
    console.log("\n--- 5) Inflight dedupe: 10 requêtes parallèles => 1 compute ---");
    process.env.HORIZON_CACHE_TILE_DEG = "0.01";
    __testClearCache();
    __testResetStats();

    let computeCount = 0;
    const slowComputeFn = async () => {
      computeCount++;
      await sleep(5);
      return { source: "RELIEF_ONLY", mask: [] };
    };

    const promises = [];
    for (let i = 0; i < 10; i++) {
      promises.push(
        getOrComputeHorizonMask(
          { lat: 48.8566, lon: 2.3522, radius_m: 500, step_deg: 2 },
          slowComputeFn
        )
      );
    }
    const results = await Promise.all(promises);

    assert(results.every((r) => r !== null), "toutes les requêtes ont répondu");
    const stats = __testGetStats();
    assert(stats.computes === 1, "computeFn appelée 1 seule fois");
    assert(stats.inflightWaits >= 9, "9+ requêtes ont attendu (inflight)");
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

  // --- Résumé ---
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
