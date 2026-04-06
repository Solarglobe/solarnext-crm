/**
 * Script de diagnostic 500 /api/leads
 * 1. Login pour obtenir un token
 * 2. GET /api/leads
 * 3. GET /api/leads/meta
 * Affiche l'erreur exacte retournée par l'API
 */

import fetch from "node-fetch";

const BASE = process.env.API_BASE || "http://localhost:3000";

async function main() {
  console.log("=== DIAGNOSTIC 500 /api/leads ===\n");
  console.log("Base URL:", BASE);

  // 1. Login
  const loginBody = {
    email: process.env.TEST_EMAIL || "b.letren@solarglobe.fr",
    password: process.env.TEST_PASSWORD || "@Goofy29041997"
  };
  console.log("\n1. Login...");
  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(loginBody)
  });
  const loginData = await loginRes.json();
  if (loginRes.status !== 200 || !loginData.token) {
    console.error("Login échoué:", loginRes.status, loginData);
    process.exit(1);
  }
  const token = loginData.token;
  console.log("   OK - Token obtenu");

  const headers = {
    Authorization: `Bearer ${token}`,
    "Content-Type": "application/json"
  };

  // 2. GET /api/leads
  console.log("\n2. GET /api/leads...");
  const leadsRes = await fetch(`${BASE}/api/leads`, { headers });
  const leadsData = await leadsRes.json().catch(() => leadsRes.text());
  console.log("   Status:", leadsRes.status);
  if (leadsRes.status !== 200) {
    console.log("   Erreur:", JSON.stringify(leadsData, null, 2));
  } else {
    console.log("   OK -", Array.isArray(leadsData) ? leadsData.length : 0, "leads");
  }

  // 3. GET /api/leads/meta
  console.log("\n3. GET /api/leads/meta...");
  const metaRes = await fetch(`${BASE}/api/leads/meta`, { headers });
  const metaData = await metaRes.json().catch(() => metaRes.text());
  console.log("   Status:", metaRes.status);
  if (metaRes.status !== 200) {
    console.log("   Erreur:", JSON.stringify(metaData, null, 2));
  } else {
    console.log("   OK - stages:", metaData.stages?.length ?? 0, ", users:", metaData.users?.length ?? 0);
  }

  console.log("\n=== FIN DIAGNOSTIC ===");
}

main().catch((e) => {
  console.error("Erreur script:", e);
  process.exit(1);
});
