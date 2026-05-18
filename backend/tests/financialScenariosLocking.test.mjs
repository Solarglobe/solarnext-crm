import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("financial scenario upsert never silently unlocks LOCKED rows", async () => {
  const source = await readFile(new URL("../services/financialScenarios.service.js", import.meta.url), "utf8");

  assert.match(source, /ON CONFLICT \(study_version_id, scenario_id\) DO UPDATE SET/);
  assert.match(source, /WHERE financial_scenarios\.status != 'LOCKED'/);
  assert.doesNotMatch(source, /WHEN financial_scenarios\.status = 'LOCKED' THEN 'DRAFT'/);
  assert.doesNotMatch(source, /WHEN financial_scenarios\.status = 'LOCKED' THEN NULL/);
});

