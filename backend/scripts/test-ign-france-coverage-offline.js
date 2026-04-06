/**
 * Test offline du script run-ign-france-coverage.
 * Mini serveur HTTP, 3 tuiles fictives (DTEST1..3), bbox réduit, vérifie rapport JSON et ignOk > 0.
 * Ne modifie pas computeHorizonMaskAuto ni moteur shading.
 */

import http from "http";
import fs from "fs";
import path from "path";
import os from "os";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = 7781;
const TEMP_CACHE = path.join(os.tmpdir(), `ign-coverage-offline-${Date.now()}`);

const FAKE_ASC = `ncols 3
nrows 3
xllcorner 618000
yllcorner 6322000
cellsize 1000
NODATA_value -9999
 100 200 150
 250 300 280
 120 180 160
`;

let server = null;

function startFakeServer() {
  return new Promise((resolve) => {
    server = http.createServer((req, res) => {
      const u = new URL(req.url || "/", `http://localhost:${PORT}`);
      const p = u.pathname.replace(/^\//, "").replace(/^ign\/?/, "");
      const tileId = p.replace(/\.asc$/, "");
      if (["DTEST1", "DTEST2", "DTEST3", "DTEST"].includes(tileId)) {
        res.writeHead(200, { "Content-Type": "text/plain" });
        res.end(FAKE_ASC);
      } else {
        res.writeHead(404);
        res.end("Not found");
      }
    });
    server.listen(PORT, "127.0.0.1", () => resolve());
  });
}

function stopFakeServer() {
  return new Promise((resolve) => {
    if (!server) return resolve();
    server.close(() => resolve());
  });
}

function runCoverageScript() {
  return new Promise((resolve, reject) => {
    const cwd = path.resolve(__dirname, "..");
    const ignRoot = path.join(TEMP_CACHE, "ign");
    fs.mkdirSync(path.join(ignRoot, "cache"), { recursive: true });
    fs.mkdirSync(path.join(ignRoot, "locks"), { recursive: true });
    const env = {
      ...process.env,
      IGN_DOWNLOAD_MODE: "HTTP",
      IGN_HTTP_BASE_URL: `http://127.0.0.1:${PORT}/ign`,
      IGN_DSM_DATA_DIR: ignRoot,
      IGN_TEST_TILE_ID: "DTEST1",
      IGN_COVERAGE_MAX_POINTS: "30",
      IGN_COVERAGE_STEP_DEG: "2.0",
      IGN_COVERAGE_BBOX: "44,46,2,5",
      IGN_SHARED_CACHE_ROOT: TEMP_CACHE,
    };
    const child = spawn("node", ["scripts/run-ign-france-coverage.js"], {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => { stdout += d.toString(); });
    child.stderr.on("data", (d) => { stderr += d.toString(); });
    child.on("close", (code) => {
      resolve({ code, stdout, stderr });
    });
    child.on("error", reject);
  });
}

function getLatestReport() {
  const reportsDir = path.join(__dirname, "..", "reports");
  if (!fs.existsSync(reportsDir)) return null;
  const files = fs.readdirSync(reportsDir)
    .filter((f) => f.startsWith("ign-coverage-france-") && f.endsWith(".json"))
    .map((f) => ({ name: f, mtime: fs.statSync(path.join(reportsDir, f)).mtime.getTime() }));
  if (files.length === 0) return null;
  files.sort((a, b) => b.mtime - a.mtime);
  return path.join(reportsDir, files[0].name);
}

async function main() {
  await startFakeServer();

  try {
    const { code, stdout, stderr } = await runCoverageScript();
    if (stdout) console.log(stdout);
    if (stderr) console.error(stderr);

    const reportPath = getLatestReport();
    if (!reportPath) {
      console.error("FAIL: aucun rapport JSON trouvé dans backend/reports/");
      process.exit(1);
    }

    const report = JSON.parse(fs.readFileSync(reportPath, "utf8"));
    if (!report.summary || typeof report.summary.ignOk !== "number") {
      console.error("FAIL: rapport invalide (summary.ignOk manquant)");
      process.exit(1);
    }
    if (report.summary.ignOk <= 0) {
      console.error("FAIL: summary.ignOk attendu > 0, obtenu", report.summary.ignOk);
      process.exit(1);
    }

    console.log("PASS: rapport écrit, ignOk =", report.summary.ignOk);
  } finally {
    await stopFakeServer();
    try {
      fs.rmSync(TEMP_CACHE, { recursive: true, force: true });
    } catch (_) {}
  }
}

main().catch((err) => {
  console.error(err?.message ?? err);
  process.exit(1);
});
