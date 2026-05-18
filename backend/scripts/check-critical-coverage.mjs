import { spawnSync } from "node:child_process";

const MIN_LINE_COVERAGE = 70;
const targets = new Map([
  ["domains/studies/geometry/pv-calculator.js", "pv-calculator.js"],
  ["domains/studies/financial/energyCalculator.js", "energyCalculator.js"],
  ["domains/studies/financial/roiCalculator.js", "roiCalculator.js"],
]);

const testFiles = [
  "domains/studies/geometry/__tests__/pv-calculator.test.js",
  "domains/studies/financial/__tests__/energyCalculator.test.js",
  "domains/studies/financial/__tests__/roiCalculator.test.js",
];

const run = spawnSync(
  process.execPath,
  ["--test", "--experimental-test-coverage", ...testFiles],
  { cwd: new URL("..", import.meta.url), encoding: "utf8" }
);

const output = `${run.stdout || ""}${run.stderr || ""}`;
process.stdout.write(output);

if (run.status !== 0) {
  process.exit(run.status ?? 1);
}

const found = new Map();
for (const [, fileName] of targets) {
  const pattern = new RegExp(`\\b${fileName.replace(".", "\\.")}\\s+\\|\\s+([0-9]+(?:\\.[0-9]+)?)`);
  const match = output.match(pattern);
  if (match) found.set(fileName, Number(match[1]));
}

const failures = [];
for (const [fullPath, fileName] of targets) {
  const pct = found.get(fileName);
  if (!Number.isFinite(pct)) {
    failures.push(`${fullPath}: coverage row missing`);
  } else if (pct < MIN_LINE_COVERAGE) {
    failures.push(`${fullPath}: ${pct}% line coverage < ${MIN_LINE_COVERAGE}%`);
  }
}

if (failures.length > 0) {
  console.error(`\nCritical coverage gate failed:\n- ${failures.join("\n- ")}`);
  process.exit(1);
}

console.log(`\nCritical coverage gate passed: all target modules are >= ${MIN_LINE_COVERAGE}% line coverage.`);
