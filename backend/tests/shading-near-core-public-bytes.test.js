/**
 * TEST 1 (étendu) — Alignement shared ↔ frontend/public pour tout le paquet calpinage shading.
 * Délègue à frontend/scripts/verify-calpinage-shading-from-shared.cjs (octets + transform shadingEngine).
 * Usage: cd backend && node tests/shading-near-core-public-bytes.test.js
 */

import { execSync } from "child_process";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.join(__dirname, "../..");
const verifyScript = path.join(repoRoot, "frontend/scripts/verify-calpinage-shading-from-shared.cjs");

try {
  execSync(`node "${verifyScript}"`, { stdio: "inherit", cwd: repoRoot });
} catch {
  process.exit(1);
}
console.log("✅ shading-near-core-public-bytes (verify calpinage shading complet)");
process.exit(0);
