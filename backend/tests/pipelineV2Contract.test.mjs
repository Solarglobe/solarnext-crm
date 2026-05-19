import { readFileSync } from "node:fs";
import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

const root = process.cwd();

test("pipeline V2 seed contains coded canonical stages for new organizations", () => {
  const migration = readFileSync(
    path.join(root, "migrations", "1781700000000_fix_pipeline_v2_seed_and_codes.js"),
    "utf8"
  );

  for (const code of [
    "NEW",
    "QUALIFIED",
    "APPOINTMENT",
    "STUDY",
    "OFFER_SENT",
    "FOLLOW_UP",
    "SIGNED",
    "LOST",
    "CONTACTED",
  ]) {
    assert.match(migration, new RegExp(`'${code}'`), `missing ${code}`);
  }
  assert.match(migration, /'Perdu', 8, true, 'LOST'/);
  assert.match(migration, /'LOST', 'Perdu', true, 8/);
  assert.match(migration, /CREATE OR REPLACE FUNCTION sg_seed_default_pipeline_for_org/);
});

test("lead stage move still converts only the SIGNED pipeline code", () => {
  const route = readFileSync(path.join(root, "routes", "leads", "detail.js"), "utf8");
  const conversion = readFileSync(path.join(root, "services", "leadClientConversion.service.js"), "utf8");

  assert.match(route, /const isSignedStage = stageCode === "SIGNED"/);
  assert.match(route, /ensureClientWhenSignedStage\(client, id, org, "SIGNE"\)/);
  assert.match(conversion, /SET status = 'CLIENT'/);
  assert.match(conversion, /client_id = \$1/);
});
