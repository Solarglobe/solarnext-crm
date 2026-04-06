/**
 * Validation complète OAuth Enedis — diagnostic 403 CloudFront
 * 1) Audit config
 * 2) Test GET authorize (status 302 vs 403)
 * 3) Test variantes redirect_uri
 * 4) Test endpoint token (dummy code)
 * 5) Conclusion et ENEDIS OAUTH READY
 *
 * Usage: depuis backend/ → node scripts/validate-enedis-oauth-full.js
 */

import dotenv from "dotenv";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");

dotenv.config({ path: resolve(BACKEND_DIR, "../.env.dev"), override: false });
dotenv.config({ path: resolve(BACKEND_DIR, ".env"), override: false });

const ENEDIS_SCOPE = "openid consommation_linky";
const SANDBOX_AUTH = "https://mon-compte-particulier-sandbox.enedis.fr/oauth2/v3/authorize";
const SANDBOX_TOKEN = "https://mon-compte-particulier-sandbox.enedis.fr/oauth2/v3/token";

function getPortFromRedirectUri(uri) {
  if (!uri || !uri.trim()) return null;
  try {
    const u = new URL(uri);
    return u.port ? parseInt(u.port, 10) : (u.protocol === "https:" ? 443 : 80);
  } catch {
    return null;
  }
}

function buildAuthorizeUrl(authBaseUrl, redirectUri, clientId, state = "test-state") {
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: ENEDIS_SCOPE,
    state,
  });
  return `${authBaseUrl}?${params.toString()}`;
}

async function main() {
  console.log("==== ENEDIS OAUTH AUDIT ====");
  console.log("ENEDIS_CLIENT_ID:", process.env.ENEDIS_CLIENT_ID);
  console.log("ENEDIS_CLIENT_SECRET:", process.env.ENEDIS_CLIENT_SECRET ? "SET" : "MISSING");
  console.log("ENEDIS_AUTH_URL:", process.env.ENEDIS_AUTH_URL);
  console.log("ENEDIS_TOKEN_URL:", process.env.ENEDIS_TOKEN_URL);
  console.log("ENEDIS_REDIRECT_URI:", process.env.ENEDIS_REDIRECT_URI);
  console.log("NODE_ENV:", process.env.NODE_ENV);
  console.log("============================\n");

  const clientId = process.env.ENEDIS_CLIENT_ID;
  const redirectUriEnv = process.env.ENEDIS_REDIRECT_URI || "";
  let authUrl = process.env.ENEDIS_AUTH_URL;
  let tokenUrl = process.env.ENEDIS_TOKEN_URL;
  if (process.env.ENEDIS_USE_SANDBOX === "1" || process.env.ENEDIS_ENV === "sandbox") {
    authUrl = SANDBOX_AUTH;
    tokenUrl = SANDBOX_TOKEN;
    console.log("[Sandbox] ENEDIS_USE_SANDBOX ou ENEDIS_ENV=sandbox → URLs sandbox forcées.\n");
  }

  if (!clientId || !redirectUriEnv) {
    console.error("❌ ENEDIS_CLIENT_ID ou ENEDIS_REDIRECT_URI manquant. Configure .env");
    process.exit(1);
  }

  const port = getPortFromRedirectUri(redirectUriEnv) || 3000;

  // ---- Étape 2 : test authorize avec redirect_uri actuelle ----
  const authorizeUrlCurrent = buildAuthorizeUrl(authUrl, redirectUriEnv, clientId);
  console.log("REDIRECT URI USED (env):", redirectUriEnv);
  console.log("AUTH BASE URL:", authUrl);
  console.log("ENEDIS AUTHORIZE URL (tronqué):", authorizeUrlCurrent.slice(0, 100) + "...\n");

  let res;
  try {
    res = await fetch(authorizeUrlCurrent, { method: "GET", redirect: "manual" });
  } catch (err) {
    console.error("❌ Erreur réseau vers Enedis:", err.message);
    process.exit(1);
  }

  console.log("AUTHORIZE STATUS (redirect_uri actuelle):", res.status);
  if (res.status === 302) {
    console.log("→ 302 OK : redirect_uri acceptée par Enedis.\n");
  } else if (res.status === 403) {
    console.log("→ 403 : problème config (redirect_uri non déclarée ou client_id / environnement incohérent).\n");
  } else {
    console.log("→ Attendu 302 ou 403. Location:", res.headers.get("Location") || "(aucune)\n");
  }

  // ---- Étape 4 : test variantes redirect_uri ----
  const variants = [
    redirectUriEnv,
    `http://localhost:${port}/api/enedis/callback`,
    `http://127.0.0.1:${port}/api/enedis/callback`,
    `https://localhost:${port}/api/enedis/callback`,
  ];
  const seen = new Set();
  const results = [];
  for (const ru of variants) {
    if (seen.has(ru)) continue;
    seen.add(ru);
    const url = buildAuthorizeUrl(authUrl, ru, clientId);
    try {
      const r = await fetch(url, { method: "GET", redirect: "manual" });
      results.push({ redirect_uri: ru, status: r.status });
      console.log("redirect_uri:", ru, "→ STATUS:", r.status);
    } catch (e) {
      results.push({ redirect_uri: ru, status: "ERR", error: e.message });
      console.log("redirect_uri:", ru, "→ ERR", e.message);
    }
  }

  const working = results.find((x) => x.status === 302);
  if (working) {
    console.log("\n✅ Candidat 302 trouvé :", working.redirect_uri);
    console.log("→ Mettez dans .env : ENEDIS_REDIRECT_URI=" + working.redirect_uri);
  } else {
    console.log("\n⚠️ Aucune variante n’a retourné 302. Vérifiez sur le portail Enedis que l’une de ces redirect_uri est déclarée (sandbox si bac à sable).");
  }

  // ---- Étape 5 : test token endpoint ----
  if (tokenUrl && process.env.ENEDIS_CLIENT_SECRET) {
    const body = new URLSearchParams({
      grant_type: "authorization_code",
      client_id: clientId,
      client_secret: process.env.ENEDIS_CLIENT_SECRET,
      redirect_uri: redirectUriEnv,
      code: "dummy",
    });
    try {
      const tokenRes = await fetch(tokenUrl, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: body.toString(),
      });
      console.log("\nTOKEN ENDPOINT STATUS:", tokenRes.status);
      if (tokenRes.status === 400) {
        console.log("→ 400 (invalid_grant avec code=dummy) : endpoint valide.");
      } else if (tokenRes.status === 403) {
        console.log("→ 403 : mauvais environnement ou client non autorisé.");
      } else {
        const text = await tokenRes.text();
        console.log("→ Corps:", text.slice(0, 200));
      }
    } catch (err) {
      console.log("\nTOKEN ENDPOINT: erreur réseau", err.message);
    }
  } else {
    console.log("\nTOKEN ENDPOINT: non testé (ENEDIS_TOKEN_URL ou ENEDIS_CLIENT_SECRET manquant).");
  }

  // ---- Étape 7 : conclusion ----
  console.log("\n========== CONCLUSION ==========");
  const authorizeOk = res.status === 302;
  const redirectMatch = redirectUriEnv && !redirectUriEnv.endsWith("/");
  const authIsSandbox = /sandbox/i.test(authUrl);
  const clientIdSet = !!clientId;

  if (authorizeOk && clientIdSet) {
    console.log("ENEDIS OAUTH READY");
    console.log("- AUTHORIZE retourne 302");
    console.log("- Pas de 403");
    console.log("- URL et environnement cohérents pour ce client_id / redirect_uri.");
  } else {
    console.log("ENEDIS OAUTH NON PRÊT");
    if (!authorizeOk) console.log("- Cause probable 403 : redirect_uri différente de celle déclarée sur le portail Enedis (exactement même protocole, host, port, pas de slash final).");
    if (!clientIdSet) console.log("- ENEDIS_CLIENT_ID manquant.");
    if (authIsSandbox) console.log("- Bac à sable : vérifier que le client_id est bien un client Sandbox et que la redirect_uri est déclarée dans l’environnement Sandbox.");
  }
  console.log("===============================\n");
}

main().catch((err) => {
  console.error("Erreur:", err.message);
  process.exit(1);
});
