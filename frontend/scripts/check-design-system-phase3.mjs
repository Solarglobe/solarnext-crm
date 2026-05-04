import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const srcRoot = path.join(root, "src");
const primitivesPath = path.join(srcRoot, "design-system", "primitives.css");

const ignoredPathParts = [
  `${path.sep}dist-crm${path.sep}`,
  `${path.sep}node_modules${path.sep}`,
  `${path.sep}pages${path.sep}pdf${path.sep}`,
  `${path.sep}components${path.sep}pdf${path.sep}`,
  `${path.sep}modules${path.sep}calpinage${path.sep}`,
  `${path.sep}__tests__${path.sep}`,
];

const requiredPrimitives = [
  "--sn-ui-table-row-min-h",
  "--sn-ui-table-header-fs",
  "--sn-ui-table-row-hover",
  ".sn-ui-table",
  ".sn-saas-table",
  ".sn-table",
  ".sn-leads-table",
  ".sn-dashboard-table",
  ".scenarios-table",
  ".org-tab-table",
  ".admin-users-table",
  ".admin-catalog-table",
  ".qb-table",
  ".qb-table.qb-lines-edit",
  ".sn-table-finance",
  ".sn-ui-table__row-actions",
  ".qb-btn-line-remove",
  ".qb-table-wrap",
  ".sn-leads-table-wrapper",
  ".sn-dashboard-table-wrap",
  ".scenarios-table-wrapper",
  ".org-tab-table-wrap",
  "--sn-badge-neutral-bg",
  "--sn-badge-info-bg",
  "--sn-badge-success-bg",
  "--sn-badge-warn-bg",
  "--sn-badge-danger-bg",
  ".crm-status-badge",
  ".sn-leads-badge",
  ".sn-leads-list-badge",
  ".badge-project",
  ".crm-badge-project--client-list",
  ".mairie-badge",
  ".lead-mairie-badge",
  ".clients-portfolio-archive-badge",
  ".admin-catalog-badge",
  ".org-tab-badge",
  ".sn-org-badge",
  ".scenario-pill",
  ".scenario-selected-pill",
  ".study-card-sg-badge",
  ".sn-global-search__badge",
  ".sn-dashboard-coverage-badge--high",
  ".sn-dashboard-coverage-badge--medium",
  ".sn-dashboard-coverage-badge--low",
  ".sn-ui-badge--neutral",
  ".sn-ui-badge--info",
  ".sn-ui-badge--success",
  ".sn-ui-badge--warn",
  ".sn-ui-badge--danger",
];

const moduleTokenLocks = [
  {
    file: path.join(srcRoot, "components", "entityDocuments", "EntityDocumentsHub.module.css"),
    required: [
      "var(--sn-badge-neutral-bg)",
      "var(--sn-badge-info-bg)",
      "var(--sn-badge-success-bg)",
      "var(--sn-badge-warn-bg)",
      "var(--sn-ui-focus-ring",
    ],
    forbidden: [
      "#f0fdf4",
      "#166534",
      "#f8fafc",
      "#fffbeb",
      "#ecfdf5",
      "rgba(5, 150, 105",
      "rgba(217, 119, 6",
    ],
  },
  {
    file: path.join(srcRoot, "components", "visiteTechnique", "VisiteTechniqueV2.module.css"),
    required: [
      "var(--sn-badge-neutral-bg)",
      "var(--sn-badge-success-bg)",
      "var(--sn-badge-warn-bg)",
      "var(--sn-badge-danger-bg)",
    ],
    forbidden: [
      "rgba(22, 163, 74",
      "rgba(234, 88, 12",
      "rgba(220, 38, 38",
      "#15803d",
      "#c2410c",
      "#b91c1c",
    ],
  },
];

function normalize(value) {
  return value.replaceAll("\\", "/");
}

/** Phase 3 badge policy: docs/design-system-theme-convention.md § BADGES POLICY — PHASE 3 LOCK */
function isBadgePolicyExcludedPath(relativeNorm) {
  if (/pages\/pdf\//i.test(relativeNorm)) return true;
  if (/components\/pdf\//i.test(relativeNorm)) return true;
  if (/modules\/calpinage\//i.test(relativeNorm)) return true;
  if (/modules\/planning\//i.test(relativeNorm)) return true;
  return false;
}

const badgePolicyLineAllowSubstrings = [
  "quick-chips",
  "tag-filter",
  "tagline",
  "timeline-dot",
  "recent-dot",
  "mission-dot",
  "color-dot",
  "hubChipRow",
  "hubChipBtn",
  "stage-tile__bar",
  "cell-bar",
  "__bar--",
  "--radius-pill",
  "radius-pill",
  "planning-searchable-dropdown",
  "month-mission",
];

/**
 * Heuristic: legacy pill/tag/chip class tokens on JSX lines without sn-badge.
 * Skips dots, bars, planning module, radius tokens, and layout wrappers (see allowlist).
 */
function lineViolatesBadgePolicyPhase3Lock(line, relativeFileNorm) {
  if (!relativeFileNorm.endsWith(".tsx")) return null;
  if (isBadgePolicyExcludedPath(relativeFileNorm)) return null;

  const trimmed = line.trim();
  if (!/(className|\bstyles\.)/.test(trimmed)) return null;
  if (/sn-badge/.test(line)) return null;
  if (badgePolicyLineAllowSubstrings.some((s) => line.includes(s))) return null;

  if (/[-_]dot\b|__dot\b/i.test(line)) return null;
  if (/stage-tile__bar|cell-bar|sn-dashboard-cell-bar/i.test(line)) return null;

  const legacyPill =
    /fi-status-pill|p12-pill|pill-violet|pill-gold|pill-green|pill-cyan|p-msg-scope__chip|\bp-msg-[\w-]*__chip\b/.test(line) ||
    /(?:["'`])pill(?:["'`\s])/.test(line) ||
    /-pill(?:["'\s>`]|$)/.test(line);

  const legacyChip = /-chip\b|__chip\b/.test(line);
  const legacyTag = /-tag\b|__tag\b/.test(line);

  if (!(legacyPill || legacyChip || legacyTag)) return null;

  return "badge-policy Use sn-badge for business status";
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

const failures = [];
const primitives = readFileSync(primitivesPath, "utf8");

for (const snippet of requiredPrimitives) {
  if (!primitives.includes(snippet)) {
    failures.push(`missing primitive ${snippet}`);
  }
}

for (const lock of moduleTokenLocks) {
  const css = readFileSync(lock.file, "utf8");
  const relativeFile = normalize(path.relative(root, lock.file));
  for (const snippet of lock.required) {
    if (!css.includes(snippet)) {
      failures.push(`missing module token ${relativeFile} ${snippet}`);
    }
  }
  for (const snippet of lock.forbidden) {
    if (css.includes(snippet)) {
      failures.push(`forbidden module badge literal ${relativeFile} ${snippet}`);
    }
  }
}

if (/220px/.test(primitives)) {
  failures.push("sidebar must stay locked at 200px; found 220px in primitives.css");
}

for (const file of walk(srcRoot)) {
  const relativeFile = normalize(path.relative(root, file));
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    if (/data-theme|\[data-theme/i.test(line)) {
      failures.push(`legacy data-theme ${relativeFile}:${index + 1} ${line.trim()}`);
    }
  });
}

for (const file of walk(srcRoot)) {
  const relativeFile = normalize(path.relative(root, file));
  const relativeNorm = normalize(path.relative(srcRoot, file));
  const lines = readFileSync(file, "utf8").split(/\r?\n/);
  lines.forEach((line, index) => {
    const policyHit = lineViolatesBadgePolicyPhase3Lock(line, relativeNorm);
    if (policyHit) {
      failures.push(`${policyHit} ${relativeFile}:${index + 1} ${line.trim()}`);
    }
  });
}

if (failures.length > 0) {
  console.error(`Phase 3 design system check: ${failures.length} failure(s).`);
  for (const failure of failures) {
    console.error(`debt ${failure}`);
  }
  process.exit(1);
}

console.log("Phase 3 design system check: OK");
