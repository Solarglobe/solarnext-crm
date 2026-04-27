/**
 * Test HTTP réel : endpoint OAuth Enedis authorize (sandbox) avec le client_id actuel.
 * Usage: depuis backend/ → node scripts/test-enedis-authorize.js
 */

import "../config/register-local-env.js";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const BACKEND_DIR = resolve(__dirname, "..");


const clientId = process.env.ENEDIS_CLIENT_ID;
const redirectUri = process.env.ENEDIS_REDIRECT_URI;
const authUrl = process.env.ENEDIS_AUTH_URL;

const params = new URLSearchParams({
  response_type: "code",
  client_id: clientId,
  redirect_uri: redirectUri,
  scope: "openid profile",
  state: "test123",
});

const url = `${authUrl}?${params.toString()}`;

console.log("Testing AUTHORIZE URL:");
console.log(url);

try {
  const res = await fetch(url, {
    method: "GET",
    redirect: "manual",
  });

  console.log("HTTP STATUS:", res.status);
  console.log("HEADERS:", Object.fromEntries(res.headers.entries()));

  if (res.status === 302) {
    console.log("OAUTH AUTHORIZE OK (REDIRECT RECEIVED)");
    console.log("RESULT: OAUTH SANDBOX WORKING");
  } else if (res.status === 403) {
    console.log("OAUTH BLOCKED (403) — CLIENT NOT AUTHORIZED FOR THIS ENDPOINT");
    console.log("RESULT: CLIENT SANDBOX NOT AUTHORIZED FOR OAUTH");
  } else {
    console.log("RESULT: UNEXPECTED STATUS (expected 302 or 403)");
  }
} catch (err) {
  console.error("ERROR:", err.message);
  console.log("RESULT: CLIENT SANDBOX NOT AUTHORIZED FOR OAUTH (or network error)");
}
