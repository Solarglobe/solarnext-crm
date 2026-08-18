import { spawn } from "node:child_process";

const testDatabaseUrl = String(process.env.CALPINAGE_TEST_DATABASE_URL || "").trim();

function assertSafeNonProductionDatabaseUrl(url) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("Refus: NODE_ENV=production");
  }
  if (!url) {
    throw new Error("CALPINAGE_TEST_DATABASE_URL requis pour le test PostgreSQL optionnel");
  }

  const parsed = new URL(url);
  const dbName = parsed.pathname.replace(/^\//, "");
  const identity = `${parsed.hostname}/${dbName}`.toLowerCase();
  if (!/(test|ci|preview|staging|sandbox)/i.test(identity)) {
    throw new Error("Refus: aucun marqueur test/ci/preview/staging/sandbox dans l'identité PostgreSQL");
  }
  if (process.env.DATABASE_URL && process.env.DATABASE_URL === url) {
    throw new Error("Refus: CALPINAGE_TEST_DATABASE_URL est identique à DATABASE_URL");
  }
}

function run(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: new URL("..", import.meta.url),
      stdio: "inherit",
      shell: process.platform === "win32",
      env: {
        ...process.env,
        DATABASE_URL: testDatabaseUrl,
        NODE_ENV: "test",
      },
    });
    child.on("exit", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with ${code}`));
    });
  });
}

assertSafeNonProductionDatabaseUrl(testDatabaseUrl);
await run("npm", ["run", "migrate:up"]);
await run("node", ["tests/calpinage-validate.integration.test.js"]);
