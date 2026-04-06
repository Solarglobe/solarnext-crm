/**
 * Hit GET /api/rbac/me en tant que sales@test.com
 * Usage: node scripts/hit-rbac-me-as-sales.js
 * Prérequis: serveur démarré (npm run dev)
 */

import dotenv from "dotenv";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

dotenv.config({ path: resolve(__dirname, "../../.env.dev") });

const BASE_URL = process.env.BASE_URL || "http://localhost:3000";

async function run() {
  console.log("🔐 Login sales@test.com / Test1234!\n");

  const loginRes = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sales@test.com",
      password: "Test1234!"
    })
  });

  const loginData = await loginRes.json();
  if (loginRes.status !== 200 || !loginData.token) {
    console.error("Login échoué:", loginRes.status, loginData);
    process.exit(1);
  }

  console.log("Login OK, token reçu\n");
  console.log("GET /api/rbac/me...\n");

  const rbacRes = await fetch(`${BASE_URL}/api/rbac/me`, {
    headers: { Authorization: `Bearer ${loginData.token}` }
  });

  const body = await rbacRes.json();
  console.log("Status:", rbacRes.status);
  console.log("Body:", JSON.stringify(body, null, 2));
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
