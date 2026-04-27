import "../config/register-local-env.js";
import { fileURLToPath } from "url";
import { dirname, resolve } from "path";
import fetch from "node-fetch";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);


const BASE_URL = "http://localhost:3000";

async function run() {
  console.log("🔐 Test login SALES...\n");

  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      email: "sales@test.com",
      password: "Test1234!"
    })
  });

  console.log("Status:", res.status);

  const text = await res.text();
  console.log("Response:", text);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
