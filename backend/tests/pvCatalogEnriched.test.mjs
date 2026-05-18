import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const root = resolve(__dirname, "..", "..");

const read = (path) => readFileSync(resolve(root, path), "utf8");

test("pv catalog stores traceable global equipment and mounting systems", () => {
  const migration = read("backend/migrations/1781500000000_enrich_global_pv_catalog.js");
  assert.match(migration, /source_name/);
  assert.match(migration, /datasheet_url/);
  assert.match(migration, /image_url/);
  assert.match(migration, /is_favorite/);
  assert.match(migration, /pv_mounting_systems/);
  assert.match(migration, /area_m2/);
});

test("pv catalog seed is price-free and verified for May 2026", () => {
  const seed = read("backend/migrations/1781500000001_seed_global_pv_catalog_2026.js");
  assert.match(seed, /2026-05-01/);
  assert.match(seed, /California Energy Commission/);
  assert.match(seed, /ENF Solar/);
  assert.doesNotMatch(seed, /purchase_price_ht|default_price_ht/);
});

test("pv catalog API exposes favorites, imports and public mounting systems", () => {
  const routes = read("backend/routes/pv.routes.js");
  const publicRoutes = read("backend/routes/public.pv.routes.js");
  const controller = read("backend/controllers/pv.controller.js");
  assert.match(routes, /mounting-systems/);
  assert.match(routes, /\/import/);
  assert.match(publicRoutes, /mounting-systems/);
  assert.match(controller, /ORDER BY is_favorite DESC/);
  assert.match(controller, /importCatalogRows/);
});

test("pv settings UI includes fixations, CSV import and favorite controls", () => {
  const page = read("frontend/src/pages/PvSettingsPage.tsx");
  assert.match(page, /Fixations/);
  assert.match(page, /CatalogImportButton/);
  assert.match(page, /Importer CSV/);
  assert.match(page, /Favori \+/);
  assert.match(page, /ProductThumb/);
});
