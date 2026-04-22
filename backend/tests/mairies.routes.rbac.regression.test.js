/**
 * Régression : routes /api/mairies alignées sur mairie.read / mairie.manage.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "fs";
import { fileURLToPath } from "url";
import { dirname, join } from "path";

const __dirname = dirname(fileURLToPath(import.meta.url));

test("mairies.routes.js : lecture vs écriture RBAC", () => {
  const path = join(__dirname, "../routes/mairies.routes.js");
  const src = readFileSync(path, "utf8");
  assert.match(src, /requirePermission\("mairie\.read"\)/);
  assert.match(src, /requirePermission\("mairie\.manage"\)/);
});
