/**
 * Test automatisé du flow OAuth Enedis (sans login humain).
 * 1) Lance le serveur
 * 2) Ouvre /api/enedis/connect dans un navigateur headless (Playwright)
 * 3) Attend la redirection vers Enedis
 * 4) Vérifie que l’URL contient mon-compte-particulier.enedis.fr
 * 5) Ne se connecte pas (identifiants requis)
 * 6) Vérifie : redirection OK + paramètres OAuth corrects
 * 7) En cas d’échec, corrige (port redirect_uri) et relance
 */

import { readFileSync, writeFileSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import { spawn } from "child_process";
import dotenv from "dotenv";
import { chromium } from "playwright";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");
const ENV_PATH = resolve(BACKEND_DIR, ".env");

const DEFAULT_PORT = 3000;
const SERVER_START_TIMEOUT_MS = 25000;
const NAVIGATION_TIMEOUT_MS = 15000;
const ENEDIS_HOST = "mon-compte-particulier.enedis.fr";
const MAX_RETRIES = 2;

dotenv.config({ path: resolve(BACKEND_DIR, "../.env.dev"), override: false });
dotenv.config({ path: ENV_PATH, override: false });

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

function checkOAuthParams(url) {
  const u = new URL(url);
  const params = u.searchParams;
  const errors = [];
  if (params.get("response_type") !== "code") {
    errors.push("response_type doit être 'code', reçu: " + params.get("response_type"));
  }
  if (!params.get("client_id")?.trim()) errors.push("client_id manquant ou vide");
  if (!params.get("redirect_uri")?.trim()) errors.push("redirect_uri manquant ou vide");
  if (!params.get("scope")?.trim()) errors.push("scope manquant ou vide");
  if (!params.get("state")?.trim()) errors.push("state manquant ou vide");
  return { ok: errors.length === 0, errors };
}

async function runPlaywrightTest(serverPort, finalRedirectUri) {
  const connectUrl = `http://localhost:${serverPort}/api/enedis/connect`;
  const browser = await chromium.launch({ headless: true });
  try {
    const context = await browser.newContext();
    const page = await context.newPage();

    await page.goto(connectUrl, { waitUntil: "load", timeout: NAVIGATION_TIMEOUT_MS });

    const finalUrl = page.url();
    if (!finalUrl.includes(ENEDIS_HOST)) {
      return {
        ok: false,
        error: "Redirection vers Enedis échouée. URL finale: " + finalUrl,
        fixed: false,
      };
    }

    const { ok, errors } = checkOAuthParams(finalUrl);
    if (!ok) {
      return {
        ok: false,
        error: "Paramètres OAuth invalides: " + errors.join("; "),
        details: { url: finalUrl, errors },
        fixed: false,
      };
    }

    return { ok: true, finalUrl };
  } finally {
    await browser.close();
  }
}

async function main() {
  console.log("--- Test OAuth Enedis automatisé (Playwright, sans login) ---\n");

  let serverProcess = null;
  let serverPort = null;
  let finalRedirectUri = null;
  let lastError = null;
  let success = false;

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    if (attempt > 1) {
      console.log("[Enedis] Nouvelle tentative après correction…\n");
    }

    const { serverPort: port, finalRedirectUri: redirectUri } = ensureEnvHasRedirectUri();
    serverPort = port;
    finalRedirectUri = redirectUri;

    if (serverProcess) {
      serverProcess.kill("SIGTERM");
      serverProcess = null;
      await new Promise((r) => setTimeout(r, 1500));
    }

    console.log("Port serveur :", serverPort);
    console.log("Redirect URI :", finalRedirectUri);
    console.log("Démarrage du serveur…");

    serverProcess = spawn("node", ["bootstrap.js"], {
      cwd: BACKEND_DIR,
      stdio: "pipe",
      env: { ...process.env, PORT: String(serverPort), ENEDIS_REDIRECT_URI: finalRedirectUri },
    });
    serverProcess.stdout?.on("data", (d) => process.stdout.write(d));
    serverProcess.stderr?.on("data", (d) => process.stderr.write(d));

    const serverReady = await waitForServer(serverPort, SERVER_START_TIMEOUT_MS);
    if (!serverReady) {
      lastError = "Le serveur n’a pas répondu à temps sur le port " + serverPort;
      if (serverProcess) serverProcess.kill("SIGTERM");
      process.exit(1);
    }

    console.log("Ouverture de", `http://localhost:${serverPort}/api/enedis/connect`, "dans le navigateur headless…");
    const result = await runPlaywrightTest(serverPort, finalRedirectUri);

    if (result.ok) {
      console.log("\n✅ Redirection vers Enedis OK.");
      console.log("✅ URL finale:", result.finalUrl);
      const { errors } = checkOAuthParams(result.finalUrl);
      console.log("✅ Paramètres OAuth corrects (response_type, client_id, redirect_uri, scope, state).");
      success = true;
      break;
    }

    lastError = result.error;
    if (result.details) {
      console.error("\n❌", result.error);
      if (result.details.url) console.error("   URL:", result.details.url);
      if (result.details.errors) console.error("   Erreurs:", result.details.errors);
    } else {
      console.error("\n❌", result.error);
    }

    const stillLocalhost = result.error && result.error.includes("URL finale:") && result.error.includes("localhost");
    if (stillLocalhost && attempt < MAX_RETRIES) {
      const { content, parsed } = parseEnvFile(ENV_PATH);
      const port = parseInt(parsed.PORT, 10) || DEFAULT_PORT;
      const newRedirectUri = `http://localhost:${port}/api/enedis/callback`;
      const updated = updateRedirectUriInEnvContent(content, newRedirectUri);
      writeFileSync(ENV_PATH, updated, "utf-8");
      console.log("[Enedis] Correction: ENEDIS_REDIRECT_URI aligné sur le port", port);
    } else if (!result.fixed && attempt < MAX_RETRIES) {
      console.log("[Enedis] Pas de correction automatique possible pour cette erreur.");
    }
  }

  if (serverProcess) {
    serverProcess.kill("SIGTERM");
  }

  console.log("\n========== RÉSUMÉ ==========");
  console.log("Port utilisé     :", serverPort);
  console.log("Redirect URI     :", finalRedirectUri);
  console.log("Redirection      :", success ? "OK (mon-compte-particulier.enedis.fr)" : "ÉCHEC");
  console.log("Paramètres OAuth :", success ? "OK" : "ÉCHEC");
  console.log("Statut           :", success ? "OK" : "ÉCHEC");
  if (!success && lastError) console.log("Erreur           :", lastError);
  console.log("============================\n");

  process.exit(success ? 0 : 1);
}

main().catch((err) => {
  console.error("Erreur inattendue:", err.message);
  if (err.message?.includes("Executable") || err.message?.includes("playwright")) {
    console.error("Exécuter: npx playwright install chromium");
  }
  process.exit(1);
});
