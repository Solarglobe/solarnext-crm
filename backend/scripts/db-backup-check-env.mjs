#!/usr/bin/env node
/**
 * CP-073 — Vérification environnement (pg_dump, psql, Docker, DATABASE_URL parsée sans secret).
 */

import os from "os";
import { execFileSync } from "child_process";

import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import { applyResolvedDatabaseUrl } from "../config/database-url.js";
import {
  getPgConnectionFromEnv,
  formatConnLogLine,
  classifyDbTarget,
} from "./lib/pgConnFromEnv.mjs";
import {
  isCommandOnPath,
  isDockerAvailable,
  detectPostgresContainerName,
} from "./lib/pgToolsRunner.mjs";

function runCmd(cmd, args) {
  try {
    return execFileSync(cmd, args, { encoding: "utf8", timeout: 15000 }).trim();
  } catch (e) {
    return null;
  }
}

console.log("=== CP-073 — Vérification environnement ===");
console.log("OS :", os.type(), os.release(), os.platform());
console.log("");

console.log("1) pg_dump");
if (isCommandOnPath("pg_dump")) {
  const v = runCmd(process.platform === "win32" ? "pg_dump.exe" : "pg_dump", ["--version"]);
  console.log("   DISPONIBLE :", v || "(version non lue)");
} else {
  console.log("   NON trouvé dans le PATH — le backup utilisera le fallback Docker si possible.");
}

console.log("");
console.log("2) psql");
if (isCommandOnPath("psql")) {
  const v = runCmd(process.platform === "win32" ? "psql.exe" : "psql", ["--version"]);
  console.log("   DISPONIBLE :", v || "(version non lue)");
} else {
  console.log("   NON trouvé dans le PATH — restore utilisera le fallback Docker si possible.");
}

console.log("");
console.log("3) Docker");
if (isDockerAvailable()) {
  console.log("   DISPONIBLE");
  const c = detectPostgresContainerName();
  console.log("   Conteneur Postgres détecté :", c || "(aucun)");
} else {
  console.log("   Non disponible ou non démarré");
}

console.log("");
console.log("4) DATABASE_URL (sans mot de passe)");
applyResolvedDatabaseUrl();
try {
  const conn = getPgConnectionFromEnv();
  console.log("   ", formatConnLogLine(conn));
  console.log("   Catégorie cible :", classifyDbTarget(conn));
} catch (e) {
  console.log("   ERREUR :", e.message);
}

console.log("");
console.log("Installation rapide des outils client :");
console.log("  Windows : https://www.postgresql.org/download/windows/ (Command Line Tools)");
console.log("  macOS   : brew install libpq && brew link --force libpq");
console.log("  Debian  : sudo apt install postgresql-client");
