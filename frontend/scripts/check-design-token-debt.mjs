import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcRoot = path.join(root, "src");
const strict = !process.argv.includes("--no-strict");

const ignoredPathParts = [
  `${path.sep}dist-crm${path.sep}`,
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}pages${path.sep}pdf${path.sep}`,
  `${path.sep}components${path.sep}pdf${path.sep}`,
  `${path.sep}modules${path.sep}calpinage${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
];

const allowedFiles = new Set([
  "src/design-system/tokens.css",
  "src/pages/mail/mailHtmlEditorConstants.ts",
]);

const rules = [
  { name: "hardcoded-brand-gold", pattern: /#C39847/gi },
  { name: "legacy-gold-accent", pattern: /gold-accent/gi },
  { name: "legacy-data-theme", pattern: /\[data-theme=/gi },
  { name: "hardcoded-gold-rgba", pattern: /rgba\(195,\s*152,\s*71,/gi },
];

function normalize(value) {
  return value.replaceAll("\\", "/");
}

function walk(dir) {
  const files = [];
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (ignoredPathParts.some((part) => full.includes(part))) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      files.push(...walk(full));
    } else if (/\.(css|ts|tsx)$/.test(entry)) {
      files.push(full);
    }
  }
  return files;
}

const findings = [];

for (const file of walk(srcRoot)) {
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    for (const rule of rules) {
      rule.pattern.lastIndex = 0;
      if (!rule.pattern.test(line)) continue;
      const trimmed = line.trim();
      const relativeFile = normalize(path.relative(root, file));
      findings.push({
        file: relativeFile,
        line: index + 1,
        rule: rule.name,
        text: trimmed,
        allowed: allowedFiles.has(relativeFile),
      });
    }
  });
}

if (findings.length === 0) {
  console.log("Design token debt check: OK");
  process.exit(0);
}

console.log("Design token debt check: findings");
for (const finding of findings) {
  const marker = finding.allowed ? "allowed" : "debt";
  console.log(`${marker} ${finding.rule} ${finding.file}:${finding.line} ${finding.text}`);
}

const blocking = findings.filter((finding) => !finding.allowed);

if (strict && blocking.length > 0) {
  console.error(`Design token debt check: ${blocking.length} blocking debt finding(s).`);
  process.exit(1);
}

console.log(`Design token debt check: ${blocking.length} debt finding(s), ${findings.length - blocking.length} allowed.`);
if (strict) {
  console.log("Design token debt check: strict zero-debt CRM OK.");
}
