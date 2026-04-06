/**
 * Test RÉEL de l'API horizon-mask via HTTP.
 * Usage: node scripts/test-horizon-api-http.js
 * Prérequis: backend lancé (npm run dev)
 */

const BASE = process.env.API_BASE || "http://localhost:3000";
const URL = `${BASE}/api/horizon-mask?lat=48.85&lon=2.35&radius=500&step=2`;

async function main() {
  console.log("[TEST] GET", URL);
  const res = await fetch(URL);
  const text = await res.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    console.error("[TEST] Réponse non-JSON:", text.slice(0, 500));
    process.exit(1);
  }

  console.log("\n--- RÉPONSE BRUTE (extrait) ---");
  console.log(JSON.stringify(json, null, 2).slice(0, 2000));
  if (JSON.stringify(json).length > 2000) console.log("... (tronqué)");

  const mask = json?.mask;
  const meta = json?.meta;

  const maskOk = Array.isArray(mask) && mask.length > 0;
  const metaOk = meta?.source === "DSM_REAL" || meta?.source === "RELIEF_ONLY";

  console.log("\n--- VALIDATION ---");
  console.log("mask is array:", Array.isArray(mask));
  console.log("mask.length:", mask?.length ?? "N/A");
  console.log("meta.source:", meta?.source ?? "N/A");
  console.log("mask.length > 0:", maskOk);
  console.log("meta.source OK:", metaOk);

  if (!maskOk) {
    console.error("\n❌ ÉCHEC: mask.length === 0 ou absent");
    process.exit(1);
  }
  console.log("\n✅ PASS: mask.length =", mask.length);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
