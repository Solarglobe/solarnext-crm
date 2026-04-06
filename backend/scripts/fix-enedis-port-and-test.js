/**
 * Corrige automatiquement le port OAuth Enedis et lance le test.
 * 1) Détecte le port réel du serveur (server.js / process.env.PORT)
 * 2) Aligne ENEDIS_REDIRECT_URI sur ce port dans .env
 * 3) Démarre le serveur, attend qu’il réponde, lance test:enedis-oauth
 * 4) En cas d’échec : corrige et relance jusqu’à ce que le test passe
 * 5) Affiche un résumé final (port, redirect URI, statut)
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");
const ENV_PATH = resolve(BACKEND_DIR, ".env");

const DEFAULT_PORT = 3000;
const MAX_RETRIES = 5;
const RETRY_DELAY_MS = 2000;
const SERVER_START_TIMEOUT_MS = 25000;

function parseEnvFile(path) {
  const content = readFileSync(path, "utf-8");
  const out = {};
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return { content, parsed: out };
}

function getPortFromUri(uri) {
  if (!uri || !uri.trim()) return null;
  try {
    const u = new URL(uri);
    if (u.port) return parseInt(u.port, 10);
    return u.protocol === "https:" ? 443 : 80;
  } catch {
    return null;
  }
}

function updateRedirectUriInEnvContent(content, newRedirectUri) {
  const lines = content.split(/\r?\n/);
  let found = false;
  const out = lines.map((line) => {
    if (line.trimStart().startsWith("ENEDIS_REDIRECT_URI=")) {
      found = true;
      return `ENEDIS_REDIRECT_URI=${newRedirectUri}`;
    }
    return line;
  });
  if (!found) {
    if (out[out.length - 1] !== "" && out.length) out.push("");
    out.push(`ENEDIS_REDIRECT_URI=${newRedirectUri}`);
  }
  return out.join("\n");
}

function ensureEnvHasRedirectUri() {
  let { content, parsed } = parseEnvFile(ENV_PATH);
  const serverPort = parseInt(parsed.PORT, 10) || DEFAULT_PORT;
  const currentRedirect = parsed.ENEDIS_REDIRECT_URI || "";
  const currentPort = getPortFromUri(currentRedirect);

  let finalRedirectUri = currentRedirect;
  if (currentPort !== serverPort) {
    try {
      const base = currentRedirect ? new URL(currentRedirect) : null;
      const pathname = base ? base.pathname : "/api/enedis/callback";
      finalRedirectUri = `http://localhost:${serverPort}${pathname.startsWith("/") ? pathname : "/" + pathname}`;
    } catch {
      finalRedirectUri = `http://localhost:${serverPort}/api/enedis/callback`;
    }
    content = updateRedirectUriInEnvContent(content, finalRedirectUri);
    writeFileSync(ENV_PATH, content, "utf-8");
    console.log("[Enedis] ENEDIS_REDIRECT_URI mis à jour dans .env :", finalRedirectUri);
  }

  return { serverPort, finalRedirectUri };
}

function waitForServer(port, timeoutMs) {
  const baseUrl = `http://localhost:${port}`;
  const start = Date.now();
  return new Promise((resolve) => {
    function attempt() {
      fetch(`${baseUrl}/api/enedis/connect`, { redirect: "manual" })
        .then((res) => {
          if (res.status === 302 || res.status === 200) {
            resolve(true);
            return;
          }
          if (Date.now() - start >= timeoutMs) {
            resolve(false);
            return;
          }
          setTimeout(attempt, 500);
        })
        .catch(() => {
          if (Date.now() - start >= timeoutMs) {
            resolve(false);
            return;
          }
          setTimeout(attempt, 500);
        });
    }
    attempt();
  });
}

function runTestScript() {
  return new Promise((resolve) => {
    const child = spawn("node", ["scripts/test-enedis-oauth.js"], {
      cwd: BACKEND_DIR,
      stdio: "inherit",
      env: { ...process.env },
    });
    child.on("close", (code) => resolve(code === 0));
  });
}

async function main() {
  console.log("--- Correction port OAuth Enedis + test automatique ---\n");

  const { serverPort, finalRedirectUri } = ensureEnvHasRedirectUri();
  console.log("Port serveur utilisé (server.js / .env PORT) :", serverPort);
  console.log("Redirect URI finale :", finalRedirectUri);
  console.log("");

  let serverProcess = null;
  try {
    serverProcess = spawn("node", ["bootstrap.js"], {
      cwd: BACKEND_DIR,
      stdio: "pipe",
      env: { ...process.env, PORT: String(serverPort), ENEDIS_REDIRECT_URI: finalRedirectUri },
    });
    serverProcess.stdout?.on("data", (d) => process.stdout.write(d));
    serverProcess.stderr?.on("data", (d) => process.stderr.write(d));
  } catch (err) {
    console.error("Impossible de démarrer le serveur :", err.message);
    process.exit(1);
  }

  const serverReady = await waitForServer(serverPort, SERVER_START_TIMEOUT_MS);
  if (!serverReady) {
    serverProcess.kill("SIGTERM");
    console.error("Le serveur n’a pas répondu à temps sur le port", serverPort);
    process.exit(1);
  }

  console.log("Serveur prêt. Lancement du test OAuth Enedis...\n");

  let testOk = false;
  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    testOk = await runTestScript();
    if (testOk) break;
    if (attempt < MAX_RETRIES) {
      console.log("\nÉchec du test, nouvelle tentative dans", RETRY_DELAY_MS / 1000, "s...\n");
      await new Promise((r) => setTimeout(r, RETRY_DELAY_MS));
    }
  }

  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }

  console.log("\n========== RÉSUMÉ FINAL ==========");
  console.log("Port utilisé          :", serverPort);
  console.log("Redirect URI finale    :", finalRedirectUri);
  console.log("Statut du test         :", testOk ? "OK" : "ÉCHEC");
  console.log("===================================\n");

  process.exit(testOk ? 0 : 1);
}

main().catch((err) => {
  console.error("Erreur :", err.message);
  process.exit(1);
});
