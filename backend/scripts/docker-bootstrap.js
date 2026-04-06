#!/usr/bin/env node
/**
 * Bootstrap Docker : attend Postgres, migrations, org, admin, puis démarre le serveur.
 * Idempotent : relançable sans casser.
 */
import { spawn } from "child_process";

async function run(cmd, args = []) {
  return new Promise((resolve, reject) => {
    const p = spawn(cmd, args, { stdio: "inherit", shell: true, cwd: process.cwd() });
    p.on("exit", (code) => (code === 0 ? resolve() : reject(new Error(`Exit ${code}`))));
  });
}

async function runOptional(cmd, args = []) {
  try {
    await run(cmd, args);
  } catch {
    console.log(`[bootstrap] ${cmd} terminé (optionnel)`);
  }
}

async function main() {
  console.log("[bootstrap] Attente de PostgreSQL...");
  await run("node", ["scripts/wait-for-db.js"]);

  console.log("[bootstrap] Lancement des migrations...");
  await runOptional("npm", ["run", "migrate:up"]);

  console.log("[bootstrap] Création de l'organisation si absente...");
  await runOptional("node", ["scripts/create-first-organization.js"]);

  console.log("[bootstrap] Création de l'admin fondateur si absent...");
  await runOptional("node", ["scripts/create-founder-admin.js"]);

  console.log("[bootstrap] Démarrage du serveur...");
  const server = spawn("node", ["bootstrap.js"], { stdio: "inherit", cwd: process.cwd() });
  server.on("exit", (code) => process.exit(code || 0));
}

main().catch((err) => {
  console.error("[bootstrap] Erreur:", err.message);
  process.exit(1);
});
