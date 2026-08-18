import { spawnSync } from "node:child_process";

function run(label, command, args, env = {}) {
  console.log(`\n[calpinage-p2b] ${label}`);
  const result = spawnSync(command, args, {
    stdio: "inherit",
    shell: process.platform === "win32",
    env: { ...process.env, ...env },
  });
  if (result.error) {
    console.error(`[calpinage-p2b] ${label} failed to start`, result.error);
    process.exit(1);
  }
  if ((result.status ?? 1) !== 0) {
    process.exit(result.status ?? 1);
  }
}

const spec = "tests/visual/calpinage-real-path-stress.spec.ts";
const cycles = process.env.CALPINAGE_STRESS_CYCLES || "20";

run("stress dev Vite", "npx", ["playwright", "test", "-c", "playwright.visual.config.ts", spec], {
  CALPINAGE_STRESS_MODE: "dev",
  CALPINAGE_STRESS_CYCLES: cycles,
});
run("build local", "npm", ["run", "build"]);
run("stress build preview", "npx", ["playwright", "test", "-c", "playwright.visual.prod.config.ts", spec], {
  CALPINAGE_STRESS_MODE: "build",
  CALPINAGE_STRESS_CYCLES: cycles,
});
