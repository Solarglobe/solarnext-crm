/**
 * Scan heuristique : extraits SQL des appels pool.query / client.query sans "organization_id".
 * Revue humaine obligatoire (faux positifs : migrations, healthcheck, etc.).
 *
 * Usage : node scripts/sql-org-isolation-scan.mjs
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.join(__dirname, "..");
const REPORT = path.join(ROOT, "reports", "sql-org-isolation-scan.txt");

const SKIP_DIR = new Set([
  "node_modules",
  "migrations",
  "tests",
  "coverage",
  ".git",
  "dist",
  "backups",
]);

const ALLOW_IF_INCLUDES = [
  "organization_id",
  "INSERT INTO organizations",
  "FROM organizations",
  "JOIN organizations",
  "pg_",
  "information_schema",
  "SELECT 1",
  "SELECT tablename",
  "rbac_roles",
  "roles ",
  "user_roles",
  "lead_stage_history", // child table, scoped by lead_id in app
];

/**
 * @param {string} text
 * @param {number} openParenIndex index of '(' after .query
 */
function extractSqlTemplate(text, openParenIndex) {
  let pos = openParenIndex + 1;
  while (pos < text.length && /\s/.test(text[pos])) pos++;
  if (text[pos] !== "`") return null;
  pos++;
  let out = "";
  while (pos < text.length) {
    const c = text[pos];
    if (c === "\\") {
      out += c + text[pos + 1];
      pos += 2;
      continue;
    }
    if (c === "$" && text[pos + 1] === "{") {
      pos += 2;
      let depth = 1;
      while (pos < text.length && depth > 0) {
        if (text[pos] === "{") depth++;
        else if (text[pos] === "}") depth--;
        pos++;
      }
      out += "${...}";
      continue;
    }
    if (c === "`") return out;
    out += c;
    pos++;
  }
  return null;
}

function walk(dir, out = []) {
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, ent.name);
    if (ent.isDirectory()) {
      if (SKIP_DIR.has(ent.name)) continue;
      walk(p, out);
    } else if (ent.isFile() && ent.name.endsWith(".js")) {
      out.push(p);
    }
  }
  return out;
}

function scanFile(filePath) {
  const text = fs.readFileSync(filePath, "utf8");
  const hits = [];
  const re = /\b(pool|client)\.query\s*\(/g;
  let m;
  while ((m = re.exec(text)) !== null) {
    const openParen = m.index + m[0].length - 1;
    const sql = extractSqlTemplate(text, openParen);
    if (!sql) continue;
    const compact = sql.replace(/\s+/g, " ").trim();
    if (compact.length < 16) continue;
    if (ALLOW_IF_INCLUDES.some((s) => compact.includes(s))) continue;
    const line = text.slice(0, m.index).split("\n").length;
    hits.push({ line, preview: compact.slice(0, 220) });
  }
  return hits;
}

function main() {
  const files = walk(ROOT);
  const linesOut = [`SQL org isolation scan — ${new Date().toISOString()} (template literals .query(\`...\`) uniquement)\n`];
  let total = 0;

  for (const f of files.sort()) {
    const rel = path.relative(ROOT, f);
    const hits = scanFile(f);
    if (hits.length === 0) continue;
    linesOut.push(`\n## ${rel} (${hits.length})\n`);
    for (const h of hits) {
      linesOut.push(`  L${h.line}: ${h.preview}\n`);
      total += 1;
    }
  }

  linesOut.push(`\nTotal fragments suspects: ${total}\n`);
  const out = linesOut.join("");
  console.log(out);
  fs.mkdirSync(path.dirname(REPORT), { recursive: true });
  fs.writeFileSync(REPORT, out, "utf8");
  console.log("\nRapport :", REPORT);
}

main();
