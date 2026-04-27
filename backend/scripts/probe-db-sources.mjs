#!/usr/bin/env node
/**
 * Affiche DATABASE_URL / PG* avant chargement env, puis après register + résolution URL.
 */
import pg from "pg";
import path from "path";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function mask(u) {
  try {
    const x = new URL(u.replace(/^postgresql:\/\//, "http://"));
    if (x.password) x.password = "****";
    return "postgresql://" + x.toString().replace(/^http:\/\//, "");
  } catch {
    return u;
  }
}

async function tryUrl(label, connectionString, ssl) {
  const pool = new pg.Pool({
    connectionString,
    ...(ssl ? { ssl: { rejectUnauthorized: false } } : {}),
  });
  try {
    const r = await pool.query(
      "SELECT count(*)::text AS leads, (SELECT count(*)::text FROM quotes) AS quotes, (SELECT count(*)::text FROM entity_documents) AS docs FROM leads"
    );
    await pool.end();
    return { ok: true, label, row: r.rows[0] };
  } catch (e) {
    try {
      await pool.end();
    } catch (_) {}
    return { ok: false, label, err: e.code || e.message };
  }
}

console.log("=== Avant import config env ===");
console.log("DATABASE_URL=", process.env.DATABASE_URL ? mask(process.env.DATABASE_URL) : "(absent)");
console.log("PGHOST=", process.env.PGHOST ?? "(absent)");
console.log("PGPORT=", process.env.PGPORT ?? "(absent)");

await import("../config/register-local-env.js");
await import("../config/script-env-tail.js");

console.log("\n=== Après register-local-env + script-env-tail ===");
console.log("DATABASE_URL=", process.env.DATABASE_URL ? mask(process.env.DATABASE_URL) : "(absent)");
console.log("PGHOST=", process.env.PGHOST ?? "(absent)");

const backendEnvPath = path.join(__dirname, "..", ".env");
const rootEnvDevPath = path.join(__dirname, "..", "..", ".env.dev");

function parseEnvFile(path) {
  const out = {};
  try {
    const text = readFileSync(path, "utf8");
    for (const line of text.split("\n")) {
      const m = /^([^#=]+)=(.*)$/.exec(line.trim());
      if (!m) continue;
      const k = m[1].trim();
      let v = m[2].trim().replace(/^["']|["']$/g, "");
      out[k] = v;
    }
  } catch {
    /* missing */
  }
  return out;
}

const fromDev = parseEnvFile(rootEnvDevPath);
const fromBackend = parseEnvFile(backendEnvPath);
const railwayPass = fromBackend.DATABASE_URL?.match(/postgres:([^@]+)@/)?.[1];
const railwayDecoded = railwayPass ? decodeURIComponent(railwayPass) : null;

const candidates = [];

if (process.env.DATABASE_URL) {
  candidates.push({
    label: "process.env.DATABASE_URL (après env config)",
    url: process.env.DATABASE_URL,
    ssl: /proxy\.rlwy\.net|rlwy\.net/i.test(process.env.DATABASE_URL),
  });
}

if (fromDev.DATABASE_URL) {
  candidates.push({
    label: ".env.dev DATABASE_URL (fichier)",
    url: fromDev.DATABASE_URL,
    ssl: false,
  });
}

if (fromBackend.DATABASE_URL && railwayDecoded) {
  const u = new URL(fromBackend.DATABASE_URL.replace(/^postgresql:\/\//, "http://"));
  candidates.push({
    label: "Railway TCP localhost:48466 (mot de passe backend/.env)",
    url: `postgresql://postgres:${encodeURIComponent(railwayDecoded)}@127.0.0.1:48466/railway`,
    ssl: true,
  });
  candidates.push({
    label: "Railway TCP nozomi.proxy.rlwy.net:48466",
    url: `postgresql://postgres:${encodeURIComponent(railwayDecoded)}@nozomi.proxy.rlwy.net:48466/railway`,
    ssl: true,
  });
}

// Dédupliquer par URL
const seen = new Set();
const uniq = [];
for (const c of candidates) {
  const k = c.url + String(c.ssl);
  if (seen.has(k)) continue;
  seen.add(k);
  uniq.push(c);
}

console.log("\n=== Tests de connexion (première base avec leads>0 ou docs>0 gagne) ===\n");
const results = [];
for (const c of uniq) {
  const r = await tryUrl(c.label, c.url, c.ssl);
  results.push(r);
  if (r.ok) {
    console.log(`OK  ${c.label}`);
    console.log(`    leads=${r.row.leads} quotes=${r.row.quotes} entity_documents=${r.row.docs}`);
  } else {
    console.log(`FAIL ${c.label} → ${r.err}`);
  }
}

const winner = results.find((r) => r.ok && (Number(r.row.leads) > 0 || Number(r.row.docs) > 0));
console.log("\n=== Gagnant (données métier) ===");
if (winner) {
  console.log(winner.label, winner.row);
} else {
  console.log("Aucune base candidate avec leads>0 ou docs>0 (toutes à 0 ou erreurs).");
}
