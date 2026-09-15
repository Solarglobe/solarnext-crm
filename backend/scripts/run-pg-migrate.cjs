#!/usr/bin/env node
/** Explicit migration runner; integrity is checked before ANY pending migration. */
const { spawnSync } = require("node:child_process");
const path = require("node:path");
const { pathToFileURL } = require("node:url");
const backendRoot = path.join(__dirname, "..");
const args = process.argv.slice(2);
async function main() {
  // Direction must come first. Reject layouts that could bypass the up guard.
  if (!["up", "down", "create", "--help", "--version", "-h", "-v"].includes(args[0])) throw new Error("MIGRATION_COMMAND_REQUIRED");
  const { getConnectionString } = require(path.join(backendRoot, "config/database.cjs"));
  process.env.DATABASE_URL = getConnectionString();
  const migrateBin = path.join(backendRoot, "node_modules/node-pg-migrate/bin/node-pg-migrate.js");
  let client, before, integrity;
  const directory = path.join(backendRoot, "migrations");
  try {
    if (args[0] === "up") {
      const { Client } = require("pg");
      client = new Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000, statement_timeout: 15000 });
      await client.connect();
      integrity = await import(pathToFileURL(path.join(backendRoot, "services/system/migrationIntegrity.js")).href);
      before = await integrity.prepareMigrationRun(client, directory);
    }
    const result = spawnSync(process.execPath, [migrateBin, ...args], { stdio: "inherit", cwd: backendRoot, env: process.env });
    if (result.status !== 0) { process.exitCode = result.status || 1; return; }
    if (client) await integrity.recordNewMigrationChecksums(client, directory, before);
  } finally {
    if (client) await client.end();
  }
}
main().catch(() => {
  console.error("MIGRATION_RUN_REFUSED: inspect existing history before retrying; no automatic checksum repair.");
  process.exitCode = 1;
});
