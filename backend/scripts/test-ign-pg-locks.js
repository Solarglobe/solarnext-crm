/**
 * Test IGN Dynamic Loader multi-process : locks PG + cache partagé.
 * Lance 2 workers qui appellent ensureIgnTileAvailable() sur le même point ;
 * vérifie un seul download réel, l'autre cache hit, index non corrompu.
 * Usage: node scripts/test-ign-pg-locks.js [--worker]
 * Env: DATABASE_URL, IGN_LOCK_MODE=PG (défaut pour ce test).
 */

import http from "http";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { fork } from "child_process";
import os from "os";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 7778;
const TILE_ID = "DTEST";

const FAKE_ASC = `ncols 2
nrows 2
xllcorner 650000
yllcorner 6860000
cellsize 1000
NODATA_value -9999
 100 101
 102 103
`;

// —— Worker : reçoit "go", appelle ensureIgnTileAvailable, renvoie le résultat
async function runWorker() {
  const { ensureIgnTileAvailable } = await import("../services/dsmDynamic/ignDynamicLoader.js");
  process.on("message", async (msg) => {
    if (msg !== "go") return;
    const lat = 41;
    const lon = -5.5;
    try {
      const r = await ensureIgnTileAvailable(lat, lon);
      process.send({
        ok: r.ok,
        existed: r.existed,
        downloaded: r.downloaded,
        tileId: r.tileId,
        error: r.error,
      });
    } catch (e) {
      process.send({
        ok: false,
        error: (e && e.message) || String(e),
        stack: e && e.stack,
      });
    }
  });
}

// —— Main : serveur HTTP + 2 workers + assertions
function startFakeServer() {
  return new Promise((resolve) => {
    const server = http.createServer((req, res) => {
      const u = new URL(req.url || "/", `http://localhost:${PORT}`);
      const p = u.pathname.replace(/^\/+/, "").replace(/^ign\/?/, "");
      if (p === `${TILE_ID}.asc` || p === "" && u.pathname.includes(TILE_ID)) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(FAKE_ASC);
      } else {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(FAKE_ASC);
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve(server));
  });
}

async function main() {
  if (process.argv.includes("--worker")) {
    await runWorker();
    return;
  }

  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL requis pour le test PG locks");
    process.exit(1);
  }

  const { acquirePgAdvisoryLock } = await import("../services/dsmDynamic/pgLocks.js");
  const probe = await acquirePgAdvisoryLock("ign:probe", 0).catch(() => null);
  if (!probe) {
    console.log("SKIP: Postgres non disponible (connexion refusée ou lock indisponible), test PG locks ignoré.");
    process.exit(0);
  }
  await probe.release();

  const tempDir = path.join(os.tmpdir(), `ign-pg-test-${Date.now()}`);
  const ignBase = path.join(tempDir, "ign");
  fs.mkdirSync(path.join(ignBase, "cache"), { recursive: true });
  fs.mkdirSync(path.join(ignBase, "locks"), { recursive: true });

  const childEnv = {
    ...process.env,
    IGN_DOWNLOAD_MODE: "HTTP",
    IGN_HTTP_BASE_URL: `http://127.0.0.1:${PORT}/ign`,
    IGN_TEST_TILE_ID: TILE_ID,
    IGN_LOCK_MODE: process.env.IGN_LOCK_MODE || "PG",
    IGN_SHARED_CACHE_ROOT: tempDir,
  };

  const server = await startFakeServer();

  const workerPath = fileURLToPath(import.meta.url);
  const cwd = path.resolve(path.dirname(workerPath), "..");
  const child1 = fork(workerPath, ["--worker"], { env: childEnv, stdio: ["pipe", "pipe", "pipe", "ipc"], cwd });
  const child2 = fork(workerPath, ["--worker"], { env: childEnv, stdio: ["pipe", "pipe", "pipe", "ipc"], cwd });

  const logs1 = [];
  const logs2 = [];
  const err1 = [];
  const err2 = [];
  child1.stdout.on("data", (c) => logs1.push(c.toString()));
  child2.stdout.on("data", (c) => logs2.push(c.toString()));
  child1.stderr.on("data", (c) => err1.push(c.toString()));
  child2.stderr.on("data", (c) => err2.push(c.toString()));

  const result1 = new Promise((resolve) => child1.on("message", resolve));
  const result2 = new Promise((resolve) => child2.on("message", resolve));

  child1.send("go");
  child2.send("go");

  const [r1, r2] = await Promise.all([result1, result2]);

  server.close();

  if (!r1.ok || !r2.ok) {
    console.error("FAIL: un worker a échoué", JSON.stringify({ r1, r2 }, null, 2));
    if (err1.length) console.error("Child1 stderr:", err1.join(""));
    if (err2.length) console.error("Child2 stderr:", err2.join(""));
    process.exit(1);
  }

  const downloaded = [r1.downloaded, r2.downloaded].filter(Boolean).length;
  const cacheHits = [r1.existed, r2.existed].filter(Boolean).length;
  if (downloaded !== 1) {
    console.error(`FAIL: attendu 1 download, obtenu ${downloaded}`, { r1, r2 });
    process.exit(1);
  }
  if (cacheHits < 1) {
    console.error(`FAIL: au moins un cache hit attendu`, { r1, r2 });
    process.exit(1);
  }

  const indexPath = path.join(ignBase, "index.json");
  if (fs.existsSync(indexPath)) {
    const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
    const hasTile = index.tiles && index.tiles.some((t) => (t.pathRel || "").includes(TILE_ID));
    if (!hasTile) {
      console.error("FAIL: index sans tuile", TILE_ID);
      process.exit(1);
    }
  }

  const downloadLogs = [...logs1, ...logs2].join("").split("\n").filter((l) => l.includes("Downloading tile"));
  if (downloadLogs.length !== 1) {
    console.error(`FAIL: attendu 1 log "Downloading tile", obtenu ${downloadLogs.length}`);
    process.exit(1);
  }

  try {
    fs.rmSync(tempDir, { recursive: true, force: true });
  } catch (_) {}

  console.log("PASS: un seul download, l'autre cache hit, index OK.");
}

if (process.argv.includes("--worker")) {
  runWorker().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
} else {
  main().catch((err) => {
    console.error(err?.message ?? err);
    process.exit(1);
  });
}
