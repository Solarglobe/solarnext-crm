/**
 * Test HTTP réel : login → PUT purchase_price_ht → GET liste
 * Variables : TEST_LOGIN_EMAIL, TEST_LOGIN_PASSWORD, TEST_API_BASE (défaut http://localhost:3000)
 *
 * Usage : node scripts/test-pv-battery-purchase-price-api.js
 */
import "../config/register-local-env.js";
import "../config/script-env-tail.js";

const BASE = process.env.TEST_API_BASE || "http://127.0.0.1:3000";
const EMAIL = process.env.TEST_LOGIN_EMAIL || "";
const PASSWORD = process.env.TEST_LOGIN_PASSWORD || "";

async function main() {
  if (!EMAIL || !PASSWORD) {
    console.error("Définir TEST_LOGIN_EMAIL et TEST_LOGIN_PASSWORD");
    process.exit(1);
  }

  const loginRes = await fetch(`${BASE}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const loginText = await loginRes.text();
  const loginData = loginText ? JSON.parse(loginText) : {};
  if (!loginRes.ok || !loginData.token) {
    console.error("Login KO", loginRes.status, loginData);
    process.exit(1);
  }
  const token = loginData.token;
  console.log("OK login (token reçu)");

  const listRes = await fetch(`${BASE}/api/pv/batteries`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const listText = await listRes.text();
  const batteries = listText ? JSON.parse(listText) : [];
  if (!listRes.ok || !Array.isArray(batteries) || batteries.length === 0) {
    console.error("GET batteries KO", listRes.status, listText?.slice(0, 200));
    process.exit(1);
  }
  const bat = batteries[0];
  const id = bat.id;
  const prevPurchase = bat.purchase_price_ht;
  console.log("Batterie test id=", id, "purchase_price_ht avant=", prevPurchase);

  const testVal = 1234.56;
  const putRes = await fetch(`${BASE}/api/pv/batteries/${id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ purchase_price_ht: testVal }),
  });
  const putText = await putRes.text();
  const putData = putText ? JSON.parse(putText) : {};
  if (!putRes.ok) {
    console.error("PUT KO", putRes.status, putData);
    process.exit(1);
  }
  const saved = Number(putData.purchase_price_ht);
  if (Math.abs(saved - testVal) > 0.01) {
    console.error("Réponse PUT incohérente", putData);
    process.exit(1);
  }
  console.log("OK PUT", putRes.status, "purchase_price_ht=", saved);

  const list2Res = await fetch(`${BASE}/api/pv/batteries`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const list2 = JSON.parse(await list2Res.text());
  const again = list2.find((b) => b.id === id);
  const readNum = again?.purchase_price_ht != null ? Number(again.purchase_price_ht) : null;
  if (Math.abs(readNum - testVal) > 0.01) {
    console.error("GET après PUT incohérent", readNum);
    process.exit(1);
  }
  console.log("OK GET reload purchase_price_ht=", readNum);

  await fetch(`${BASE}/api/pv/batteries/${id}`, {
    method: "PUT",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ purchase_price_ht: prevPurchase ?? null }),
  });
  console.log("Restauré purchase_price_ht précédent:", prevPurchase ?? null);

  console.log("\n=== API purchase_price_ht OK ===");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
