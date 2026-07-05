/**
 * CP-FAR-MNS-01 — Test unitaire du loader GeoTIFF Lambert-93 (MNS/MNH LiDAR HD).
 *
 * Génère une dalle GeoTIFF synthétique en Lambert-93 (sol plat 100 m + un objet
 * de 15 m à une position connue), puis vérifie via le vrai loader + le vrai
 * sampler (heightSampler2154) que :
 *   1. la valeur d'altitude est lue au bon endroit (georéférencement) ;
 *   2. le flip vertical est correct (pas d'inversion Nord/Sud) ;
 *   3. l'horizon se lève uniquement dans la direction de l'objet, avec le bon angle.
 *
 * Lancement : node backend/scripts/test-mns-geotiff-loader.mjs
 * Dépendance : geotiff (déjà présente).
 */

import { writeArrayBuffer } from "geotiff";
import fs from "fs";
import os from "os";
import path from "path";
import { fileURLToPath } from "url";
import { createIgnLidarGeotiffTileLoader } from "../services/horizon/providers/ign/ignLidarGeotiffTileLoader.js";
import { createIgnHeightSampler } from "../services/horizon/providers/ign/heightSampler2154.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mns-test-"));

const N = 200, CELL = 5, minX = 649500, maxY = 6860500;
const y0 = maxY - N * CELL;
const GROUND = 100, TREE = 115, cx = 650000, cy = 6860000;

async function buildSampler(objX, objY) {
  const col = Math.round((objX - minX) / CELL);
  const row = Math.round((objY - y0) / CELL);   // nœud bas-first
  const srcRow = (N - 1) - row;                 // inverse du flip du loader
  const values = new Float32Array(N * N).fill(GROUND);
  values[srcRow * N + col] = TREE;
  const ab = await writeArrayBuffer(values, {
    height: N, width: N,
    ModelPixelScale: [CELL, CELL, 0],
    ModelTiepoint: [0, 0, 0, minX, maxY, 0],
    GDAL_NODATA: "-99999", ProjectedCSTypeGeoKey: 2154,
  });
  fs.writeFileSync(path.join(TMP, "d.tif"), Buffer.from(ab));
  const index = { tiles: [{ pathRel: "d.tif",
    bboxLambert93: { minX, minY: y0, maxX: minX + N * CELL, maxY } }] };
  const loader = createIgnLidarGeotiffTileLoader({ dataDir: TMP, maxTiles: 1 });
  return createIgnHeightSampler({ tilesIndex: index, tileLoader: loader });
}

async function horizon(sample, dx, dy) {
  const z0 = await sample(cx, cy);
  let m = 0;
  for (let d = CELL; d <= 300; d += CELL) {
    const z = await sample(cx + dx * d, cy + dy * d);
    if (z == null) continue;
    const a = Math.atan2(z - z0, d) * 180 / Math.PI;
    if (a > m) m = a;
  }
  return m;
}

const EXPECT = Math.atan2(15, 50) * 180 / Math.PI;
let pass = true;
const chk = (l, g, e, t) => {
  const ok = Math.abs(g - e) <= t;
  pass = pass && ok;
  console.log(`${ok ? "✓" : "✗"} ${l}: ${g.toFixed(2)}° (attendu ${e.toFixed(2)}±${t})`);
};

try {
  let s = await buildSampler(650050, 6860000);
  console.log("— Objet 15 m plein EST (50 m) —");
  chk("Est", await horizon(s, 1, 0), EXPECT, 0.3);
  chk("Ouest", await horizon(s, -1, 0), 0, 0.1);
  chk("Nord", await horizon(s, 0, 1), 0, 0.1);
  chk("Sud", await horizon(s, 0, -1), 0, 0.1);

  s = await buildSampler(650000, 6860050);
  console.log("— Objet 15 m plein NORD (50 m) [garde orientation N/S] —");
  chk("Nord", await horizon(s, 0, 1), EXPECT, 0.3);
  chk("Sud", await horizon(s, 0, -1), 0, 0.1);
  chk("Est", await horizon(s, 1, 0), 0, 0.1);

  s = await buildSampler(649900, 6860000);
  console.log("— Objet 15 m plein OUEST (100 m) —");
  chk("Ouest", await horizon(s, -1, 0), Math.atan2(15, 100) * 180 / Math.PI, 0.3);
  chk("Est", await horizon(s, 1, 0), 0, 0.1);

  console.log(pass
    ? "\n✅ PASS — georéférencement, flip vertical et orientation E/O/N/S corrects"
    : "\n❌ FAIL");
} finally {
  fs.rmSync(TMP, { recursive: true, force: true });
}
process.exit(pass ? 0 : 1);
