#!/usr/bin/env node
/**
 * Lance node-pg-migrate avec DATABASE_URL résolu (localhost vs db) via config/database.cjs.
 */
const { spawnSync } = require("child_process");
const path = require("path");

const backendRoot = path.join(__dirname, "..");
const { getConnectionString } = require(path.join(backendRoot, "config/database.cjs"));
process.env.DATABASE_URL = getConnectionString();

const migrateBin = path.join(backendRoot, "node_modules", "node-pg-migrate", "bin", "node-pg-migrate.js");
const args = process.argv.slice(2);
const r = spawnSync(process.execPath, [migrateBin, ...args], {
  stdio: "inherit",
  cwd: backendRoot,
  env: process.env,
});

process.exit(r.status === null ? 1 : r.status);
