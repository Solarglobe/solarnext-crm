/**
 * CP-FAR-IGN-02 — Construit / met à jour l'index des dalles IGN avec bbox Lambert93.
 * Parcourt les .asc extraits, lit le header uniquement, écrit/merge dans index.json.
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import { getIgnDsmDataDir } from "../services/horizon/providers/ign/ignRgeAltiConfig.js";
import { parseEsriAsciiGridHeader } from "../services/horizon/providers/ign/parseEsriAsciiGrid.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function main() {
  const dataDir = getIgnDsmDataDir();
  const indexPath = path.join(dataDir, "index.json");

  if (!fs.existsSync(indexPath)) {
    console.error("index.json absent. Exécuter d'abord: node scripts/download-ign-rgealti-d075.js");
    process.exit(1);
  }

  const index = JSON.parse(fs.readFileSync(indexPath, "utf8"));
  const ascFiles = index.ascFiles || [];
  if (ascFiles.length === 0) {
    console.error("Aucun .asc dans index.json");
    process.exit(1);
  }

  const tiles = [];
  for (const pathRel of ascFiles) {
    const fullPath = path.join(dataDir, pathRel.replace(/\//g, path.sep));
    if (!fs.existsSync(fullPath)) continue;
    try {
      const header = parseEsriAsciiGridHeader(fullPath);
      tiles.push({
        pathRel,
        bboxLambert93: {
          minX: header.x0,
          minY: header.y0,
          maxX: header.x1,
          maxY: header.y1,
          cellsize_m: header.cellsize_m,
          width: header.width,
          height: header.height,
          noDataValue: header.noDataValue,
        },
      });
    } catch (err) {
      console.warn("Skip", pathRel, err.message);
    }
  }

  index.tiles = tiles;
  index.tilesBuiltAt = new Date().toISOString();
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2), "utf8");
  console.log("Index mis à jour:", tiles.length, "dalles avec bboxLambert93");
}

main();
