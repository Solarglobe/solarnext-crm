/**
 * Proxy racine — exécute la batterie de tests BATTERY_VIRTUAL côté backend.
 * Usage: node scripts/test-battery-virtual.js
 */
const { spawnSync } = require("node:child_process");
const path = require("node:path");

const backendScript = path.join(__dirname, "..", "backend", "scripts", "test-battery-virtual.js");
const r = spawnSync(process.execPath, [backendScript], {
  stdio: "inherit",
  cwd: path.join(__dirname, "..", "backend"),
  env: process.env,
});
process.exit(r.status === null ? 1 : r.status);
