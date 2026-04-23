#!/usr/bin/env node
/**
 * Envoie verify-entity-documents-storage.mjs sur le conteneur (stdin → cat) puis l’exécute.
 * Même principe d’appel à la CLI que railway-restore-storage.mjs.
 *
 *   node backend/scripts/railway-run-verify-remote.mjs
 *   (RAILWAY_SERVICE — défaut solarnext-crm)
 */
import { execFile, execSync, spawn } from "child_process";
import { createReadStream } from "fs";
import { existsSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

function resolveRailwayMainAndArgs() {
  if (process.env.RAILWAY_CLI_JS?.trim()) {
    const js = process.env.RAILWAY_CLI_JS.trim();
    if (existsSync(js)) return { cmd: process.execPath, argsPrefix: [js] };
  }
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    const js = path.join(root, "@railway", "cli", "bin", "railway.js");
    if (existsSync(js)) return { cmd: process.execPath, argsPrefix: [js] };
  } catch {
    /* ignore */
  }
  return { cmd: "railway", argsPrefix: [] };
}
const RAILWAY = resolveRailwayMainAndArgs();
const RAILWAY_SERVICE = (process.env.RAILWAY_SERVICE || "solarnext-crm").trim();

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const verifyPath = path.join(__dirname, "verify-entity-documents-storage.mjs");
/* Le fichier est placé sous /app pour la résolution de `node_modules` (`import pg` depuis /tmp ne marche pas). */
const script = `cat > /app/.verify-entity-documents-storage.mjs && cd /app && STORAGE_ROOT=/app/storage node /app/.verify-entity-documents-storage.mjs --json; ec=$?; rm -f /app/.verify-entity-documents-storage.mjs; exit $ec`;

const { cmd, argsPrefix } = RAILWAY;
const ssh = execFile(
  cmd,
  [...argsPrefix, "ssh", "sh", "-c", script],
  { stdio: ["pipe", "inherit", "inherit"], env: { ...process.env, RAILWAY_SERVICE } }
);

createReadStream(verifyPath).pipe(ssh.stdin);
ssh.on("close", (code) => process.exit(code ?? 1));
ssh.on("error", (e) => {
  console.error(e);
  process.exit(1);
});
