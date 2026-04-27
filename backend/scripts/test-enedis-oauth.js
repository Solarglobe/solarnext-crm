/**
 * Test automatique du module OAuth Enedis (local).
 * Valide que GET /api/enedis/connect renvoie 302 et que l’URL de redirection
 * contient client_id, redirect_uri, scope. N’appelle pas Enedis.
 *
 * Prérequis : backend lancé sur le port défini dans ENEDIS_REDIRECT_URI (ex: PORT=4000 npm run dev).
 */

import "../config/register-local-env.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");


const REDIRECT_URI = process.env.ENEDIS_REDIRECT_URI || "";

function getPortFromRedirectUri(uri) {
  if (!uri || !uri.trim()) return null;
  try {
    const u = new URL(uri);
    return u.port ? parseInt(u.port, 10) : (u.protocol === "https:" ? 443 : 80);
  } catch {
    return null;
  }
}

const portFromRedirect = getPortFromRedirectUri(REDIRECT_URI);
const portFromEnv = process.env.PORT ? parseInt(process.env.PORT, 10) : null;
const PORT = portFromRedirect ?? portFromEnv ?? 3000;
const BASE_URL = `http://localhost:${PORT}`;

console.log("--- Test OAuth Enedis (local) ---");
console.log("Port utilisé pour le test (ENEDIS_REDIRECT_URI ou PORT) :", PORT);
console.log("URL de test :", `${BASE_URL}/api/enedis/connect`);
console.log("");

async function run() {
  if (!REDIRECT_URI) {
    console.error("❌ ENEDIS_REDIRECT_URI manquant dans .env. Exemple : http://localhost:4000/api/enedis/callback");
    process.exit(1);
  }

  const connectUrl = `${BASE_URL}/api/enedis/connect`;

  let res;
  try {
    res = await fetch(connectUrl, { redirect: "manual" });
  } catch (err) {
    if (err.cause?.code === "ECONNREFUSED" || err.code === "ECONNREFUSED") {
console.error(`❌ Le serveur ne répond pas sur le port ${PORT}.`);
    console.error("   Lancez le backend sur ce port, ex: PORT=" + PORT + " npm run dev");
    } else {
      console.error("❌ Erreur réseau:", err.message);
    }
    process.exit(1);
  }

  if (res.status !== 302) {
    console.error(`❌ Statut attendu 302, reçu ${res.status}`);
    const text = await res.text().catch(() => "");
    if (text) console.error("   Corps:", text.slice(0, 300));
    process.exit(1);
  }

  const location = res.headers.get("Location");
  if (!location) {
    console.error("❌ Réponse 302 sans en-tête Location");
    process.exit(1);
  }

  // Log de l’URL de redirection (pas de client_secret dans l’authorize)
  console.log("✅ Redirection 302 reçue.");
  console.log("URL de redirection générée (authorize, sans secret) :", location);
  console.log("");

  let redirectUrl;
  try {
    redirectUrl = new URL(location);
  } catch {
    console.error("❌ URL de redirection invalide :", location);
    process.exit(1);
  }

  const params = redirectUrl.searchParams;
  const checks = [
    { name: "client_id", value: params.get("client_id") },
    { name: "redirect_uri", value: params.get("redirect_uri") },
    { name: "scope", value: params.get("scope") },
  ];

  let failed = false;
  for (const { name, value } of checks) {
    if (!value || !String(value).trim()) {
      console.error(`❌ Paramètre OAuth manquant ou vide : ${name}`);
      failed = true;
    }
  }
  if (failed) {
    console.error("   Paramètres reçus :", Object.fromEntries(params));
    process.exit(1);
  }

  console.log("✅ Paramètres OAuth présents dans l’URL :");
  console.log("   - client_id   :", params.get("client_id"));
  console.log("   - redirect_uri :", params.get("redirect_uri"));
  console.log("   - scope       :", params.get("scope"));
  console.log("");
  console.log("--- Test OAuth Enedis OK : URL correctement construite ---");
}

run().catch((err) => {
  console.error("❌ Erreur inattendue:", err.message);
  process.exit(1);
});
