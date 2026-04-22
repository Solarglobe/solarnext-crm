/**
 * Régression : study.read n'est pas une permission seedée en base (seul study.manage l'est).
 * requirePermission("study.read") provoquait 403 MISSING_PERMISSION en RBAC_ENFORCE=1.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("GET /versions/:versionId/scenarios utilise study.manage, pas study.read", () => {
  const path = join(__dirname, "../routes/studies.routes.js");
  const src = readFileSync(path, "utf8");
  assert.match(
    src,
    /router\.get\(\s*"\s*\/:studyId\/versions\/:versionId\/scenarios"[\s\S]*?requirePermission\("study\.manage"\)/,
    "la route scenarios doit exiger study.manage"
  );
  assert.equal(
    src.includes('requirePermission("study.read")'),
    false,
    "study.read ne doit pas apparaître dans studies.routes.js (permission absente des migrations RBAC)"
  );
});
