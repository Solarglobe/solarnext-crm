/**
 * TEST C — Preuve : le backend ne référence plus nearShadingCore sous frontend/.
 * Parcours léger de backend/services/shading et backend/tests (*.js).
 * Usage: cd backend && node tests/shading-near-core-backend-dependency-audit.test.js
 */

import { readdirSync, readFileSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");
const FORBIDDEN_SNIPPETS = [
  "frontend/calpinage/shading/nearShadingCore",
  "frontend\\calpinage\\shading\\nearShadingCore",
];

const SCAN_DIRS = [
  path.join(repoRoot, "backend/services/shading"),
  path.join(repoRoot, "backend/tests"),
];

let passed = 0;
let failed = 0;

function ok(m) {
  console.log("✅ " + m);
  passed++;
}
function fail(m) {
  console.log("❌ " + m);
  failed++;
}

function scanFile(filePath) {
  const txt = readFileSync(filePath, "utf8");
  for (const s of FORBIDDEN_SNIPPETS) {
    if (txt.includes(s)) {
      fail(`${path.relative(repoRoot, filePath)} référence encore le chemin frontend nearShadingCore (${s})`);
      return;
    }
  }
}

const SKIP_SCAN = new Set([
  "shading-near-core-backend-dependency-audit.test.js",
  "shading-near-core-shared-regression.test.js",
]);

function main() {
  for (const dir of SCAN_DIRS) {
    for (const name of readdirSync(dir)) {
      if (!name.endsWith(".js") || SKIP_SCAN.has(name)) continue;
      scanFile(path.join(dir, name));
    }
  }

  const servicePath = path.join(repoRoot, "backend/services/shading/calpinageShading.service.js");
  const svc = readFileSync(servicePath, "utf8");
  if (!svc.includes("shared/shading/nearShadingCore.cjs")) {
    fail("calpinageShading.service.js doit require shared/shading/nearShadingCore.cjs");
  } else {
    ok("calpinageShading.service.js pointe vers shared/shading/nearShadingCore.cjs");
  }

  if (failed === 0) {
    ok("aucun fichier backend/services/shading ni backend/tests ne référence frontend/.../nearShadingCore");
  }

  console.log("\n--- RÉSUMÉ audit dépendances near core ---");
  console.log("Passed:", passed, "Failed:", failed);
  if (failed > 0) process.exit(1);
  process.exit(0);
}

main();
