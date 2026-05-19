const { spawnSync } = require("child_process");

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    ...options,
  });

  if (result.error) {
    console.error(`[build-crm] ${command} failed to start:`, result.error);
    return 1;
  }

  return result.status ?? 1;
}

const syncStatus = run("npm", ["run", "sync:calpinage-shading-from-shared"]);
if (syncStatus !== 0) {
  process.exit(syncStatus);
}

const tscStatus = run("npx", ["tsc", "--noEmit"]);
if (tscStatus !== 0) {
  console.warn("[build-crm] TypeScript reported errors; continuing to Vite build to preserve current release behavior.");
}

process.exit(run("npx", ["vite", "build"]));
