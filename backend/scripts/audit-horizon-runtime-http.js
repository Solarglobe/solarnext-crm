/**
 * AUDIT — Flux HTTP réel pour horizon mask
 * Usage: cd backend && STUDY_ID=xxx ORG_ID=yyy BASE_URL=http://localhost:3000 node scripts/audit-horizon-runtime-http.js
 * Prérequis: serveur backend démarré sur BASE_URL
 */

import { writeFileSync, mkdirSync } from "fs";
import { join } from "path";
import { createHash } from "crypto";

const OUT_DIR = join(process.cwd(), "scripts", "output");

const studyId = process.env.STUDY_ID || process.argv[2];
const orgId = process.env.ORG_ID || process.argv[3];
const baseUrl = (process.env.BASE_URL || "http://localhost:3000").replace(/\/$/, "");
const version = process.env.VERSION || "1";
const useHorizonMask = process.env.USE_HORIZON_MASK === "1" || process.argv.includes("--horizon-mask");

function sha1(content) {
  return createHash("sha1").update(typeof content === "string" ? content : content).digest("hex");
}

if (!studyId || !orgId) {
  console.error("Usage: STUDY_ID=xxx ORG_ID=yyy BASE_URL=http://localhost:3000 node audit-horizon-runtime-http.js");
  process.exit(1);
}

mkdirSync(OUT_DIR, { recursive: true });

const path = useHorizonMask ? "horizon-mask" : "dsm-analysis";
const url = `${baseUrl}/internal/pdf/${path}/${studyId}?orgId=${orgId}&version=${version}`;
console.log("\n=== AUDIT HTTP —", url, "===\n");

let pdfBuffer;
let headersObj = {};
const pdfName = useHorizonMask ? "http-runtime-horizon.pdf" : "http-runtime.pdf";
try {
  const res = await fetch(url);
  headersObj = Object.fromEntries(res.headers.entries());
  const arr = await res.arrayBuffer();
  pdfBuffer = Buffer.from(arr);

  writeFileSync(join(OUT_DIR, pdfName), pdfBuffer);
  writeFileSync(
    join(OUT_DIR, "http-runtime-headers.txt"),
    `HTTP ${res.status} ${res.statusText}\n` +
      [...res.headers.entries()].map(([k, v]) => `${k}: ${v}`).join("\n"),
    "utf8"
  );
  console.log("Status:", res.status, res.statusText);
  console.log("Content-Type:", headersObj["content-type"] || "(absent)");
} catch (e) {
  console.error("fetch échoué:", e.message);
  pdfBuffer = Buffer.alloc(0);
}

console.log("\nSHA1", pdfName + ":", sha1(pdfBuffer));
console.log("Taille PDF:", pdfBuffer.length, "octets");
if (pdfBuffer.length > 4) {
  const magic = pdfBuffer.slice(0, 4).toString("utf8");
  console.log("Magic PDF:", magic, magic === "%PDF" ? "(valide)" : "(invalide?)");
}
