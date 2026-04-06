/**
 * Module OAuth Enedis — échange de code contre token (fetch natif Node 18)
 */

const ENEDIS_SCOPE = "openid consommation_linky";

const ENEDIS_SANDBOX_AUTH_URL = "https://mon-compte-particulier-sandbox.enedis.fr/oauth2/v3/authorize";
const ENEDIS_SANDBOX_TOKEN_URL = "https://mon-compte-particulier-sandbox.enedis.fr/oauth2/v3/token";

/**
 * Génère l’URL de redirection vers Enedis (authorize).
 * @returns {{ url: string, state: string }}
 */
export function buildAuthUrl() {
  const clientId = process.env.ENEDIS_CLIENT_ID;
  const redirectUri = process.env.ENEDIS_REDIRECT_URI;
  let authUrl = process.env.ENEDIS_AUTH_URL;
  if (process.env.ENEDIS_USE_SANDBOX === "1" || process.env.ENEDIS_ENV === "sandbox") {
    authUrl = ENEDIS_SANDBOX_AUTH_URL;
  }

  if (!clientId || !redirectUri || !authUrl) {
    throw new Error("ENEDIS: configuration manquante (ENEDIS_CLIENT_ID, ENEDIS_REDIRECT_URI, ENEDIS_AUTH_URL)");
  }

  const state = crypto.randomUUID();
  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: ENEDIS_SCOPE,
    state,
  });
  const url = `${authUrl}?${params.toString()}`;
  return { url, state };
}

/**
 * Échange le code d’autorisation contre un access_token (POST vers ENEDIS_TOKEN_URL).
 * @param {string} code - Code reçu dans le callback
 * @returns {Promise<{ access_token: string, [key: string]: unknown }>}
 */
export async function exchangeCodeForToken(code) {
  const clientId = process.env.ENEDIS_CLIENT_ID;
  const clientSecret = process.env.ENEDIS_CLIENT_SECRET;
  const redirectUri = process.env.ENEDIS_REDIRECT_URI;
  let tokenUrl = process.env.ENEDIS_TOKEN_URL;
  if (process.env.ENEDIS_USE_SANDBOX === "1" || process.env.ENEDIS_ENV === "sandbox") {
    tokenUrl = ENEDIS_SANDBOX_TOKEN_URL;
  }

  if (!clientId || !clientSecret || !redirectUri || !tokenUrl) {
    throw new Error("ENEDIS: configuration manquante pour l’échange de token");
  }

  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: clientId,
    client_secret: clientSecret,
    redirect_uri: redirectUri,
    code,
  });

  console.log("[Enedis] échange code contre token — POST", tokenUrl);
  const res = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  const rawText = await res.text();
  let data = {};
  try {
    data = JSON.parse(rawText);
  } catch {
    data = {};
  }

  if (!res.ok) {
    console.error("[Enedis] token error — statut:", res.status);
    console.error("[Enedis] réponse brute Enedis:", rawText);
    const msg = data.error_description || data.error || res.statusText;
    const err = new Error(`ENEDIS token: ${res.status} — ${msg}`);
    err.rawResponse = rawText;
    err.status = res.status;
    throw err;
  }

  if (!data.access_token) {
    console.error("[Enedis] réponse token sans access_token. Réponse brute:", rawText);
    const err = new Error("ENEDIS token: réponse sans access_token");
    err.rawResponse = rawText;
    throw err;
  }

  return data;
}
