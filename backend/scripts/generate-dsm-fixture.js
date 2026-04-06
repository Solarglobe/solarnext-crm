/**
 * CP-FAR-008 — Génère une fixture GeoTIFF 16x16 pour les tests
 * Usage: node scripts/generate-dsm-fixture.js
 */

import { writeArrayBuffer } from "geotiff";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = path.join(__dirname, "..", "tests", "fixtures", "dsm");
const FIXTURE_PATH = path.join(FIXTURE_DIR, "sample.tif");

const WIDTH = 16;
const HEIGHT = 16;

const grid = new Float32Array(WIDTH * HEIGHT);
for (let y = 0; y < HEIGHT; y++) {
  for (let x = 0; x < WIDTH; x++) {
    const idx = y * WIDTH + x;
    const cx = x - WIDTH / 2;
    const cy = y - HEIGHT / 2;
    grid[idx] = 50 + 10 * Math.exp(-(cx * cx + cy * cy) / 20);
  }
}

const metadata = {
  width: WIDTH,
  height: HEIGHT,
  ModelPixelScale: [0.0001, 0.0001, 0],
  ModelTiepoint: [0, 0, 0, 2.35, 48.85, 0],
  /** Sans clé géo, geotiff.js écrase ModelTiepoint par [-180,90] (globe) — casse tout le pipeline horizon. */
  GeographicTypeGeoKey: 4326,
};

const buffer = writeArrayBuffer(grid, metadata);
fs.mkdirSync(FIXTURE_DIR, { recursive: true });
fs.writeFileSync(FIXTURE_PATH, Buffer.from(buffer));
console.log("Fixture written to", FIXTURE_PATH);
