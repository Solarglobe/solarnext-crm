/**
 * Test manuel POST /auth/login (npm run test-login)
 * Variables : TEST_LOGIN_EMAIL, TEST_LOGIN_PASSWORD (backend/.env ou env)
 */
import "../config/register-local-env.js";
import "../config/script-env-tail.js";
import fetch from "node-fetch";

const BASE_URL = process.env.TEST_LOGIN_BASE_URL || "http://localhost:3000";
const EMAIL = process.env.TEST_LOGIN_EMAIL || "";
const PASSWORD = process.env.TEST_LOGIN_PASSWORD || "";

async function testLogin() {
  if (!EMAIL || !PASSWORD) {
    console.error("Définir TEST_LOGIN_EMAIL et TEST_LOGIN_PASSWORD (ex. dans backend/.env)");
    process.exit(1);
  }
  try {
    const response = await fetch(`${BASE_URL}/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        email: EMAIL,
        password: PASSWORD,
      }),
    });

    const text = await response.text();
    let data = {};
    try {
      data = text ? JSON.parse(text) : {};
    } catch {
      console.log("STATUS:", response.status);
      console.log("RAW (non-JSON):", text?.slice(0, 500));
      console.log("LOGIN FAILED ❌");
      return;
    }

    console.log("STATUS:", response.status);
    console.log("RESPONSE:", data);
    if (data.token) {
      console.log("token (préfixe):", String(data.token).slice(0, 24) + "…");
    }

    if (response.status === 200 && data.token) {
      console.log("LOGIN SUCCESS ✅");
    } else {
      console.log("LOGIN FAILED ❌");
    }
  } catch (err) {
    console.error("ERROR:", err.message);
  }
}

testLogin();
