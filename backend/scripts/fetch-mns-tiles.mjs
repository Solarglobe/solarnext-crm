/**
 * CP-FAR-MNS-01 — Prétéléchargement / vérification des dalles MNS LiDAR HD pour un point.
 *
 * Télécharge (via la table d'assemblage WFS IGN) les dalles MNS/MNH couvrant un
 * point donné, les met en cache et construit index.json. Sert à :
 *   - amorcer le cache d'une zone témoin avant une étude,
 *   - vérifier que la couverture LiDAR existe sur un site.
 *
 * Usage :
 *   node backend/scripts/fetch-mns-tiles.mjs --lat 48.857 --lon 2.352 [--radius 800] [--product MNS] [--dir ./data/dsm/mns]
 *
 * Le répertoire par défaut est DSM_LIDAR_DATA_DIR (ou ./data/dsm/mns).
 */

import path from "path";
import { ensureMnsTilesForPoint } from "../services/horizon/providers/ign/ignLidarMnsFetcher.js";

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 && process.argv[i + 1] ? process.argv[i + 1] : def;
}

const lat = parseFloat(arg("lat", ""));
const lon = parseFloat(arg("lon", ""));
const radius_m = parseInt(arg("radius", "800"), 10);
const product = String(arg("product", "MNS")).toUpperCase();
const dataDir = path.resolve(arg("dir", process.env.DSM_LIDAR_DATA_DIR || "./data/dsm/mns"));

if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
  console.error("Usage: node backend/scripts/fetch-mns-tiles.mjs --lat <deg> --lon <deg> [--radius 800] [--product MNS] [--dir <chemin>]");
  process.exit(2);
}

console.log(`[MNS] point=(${lat}, ${lon}) rayon=${radius_m}m produit=${product}`);
console.log(`[MNS] cache=${dataDir}`);

const r = await ensureMnsTilesForPoint({ lat, lon, radius_m, dataDir, product });

console.log("\n=== Résultat ===");
console.log(`Dalles trouvées (couverture LiDAR) : ${r.requested}`);
console.log(`Téléchargées                       : ${r.downloaded}`);
console.log(`Déjà en cache                      : ${r.cached}`);
console.log(`Total indexées                     : ${r.indexed}`);
if (r.skippedProjection) console.log(`Ignorées (projection non L93)      : ${r.skippedProjection}`);
if (r.errors?.length) console.log(`Erreurs :\n  - ${r.errors.join("\n  - ")}`);

if (r.requested === 0) {
  console.log("\n⚠️  Aucune dalle : ce site n'est pas encore couvert par le LiDAR HD (couverture progressive).");
  console.log("    → l'ombrage retombera automatiquement sur le terrain nu (RGE ALTI).");
} else if (r.ok) {
  console.log("\n✅ Cache prêt. Pour activer l'ombrage avec arbres, poser :");
  console.log("   HORIZON_DSM_ENABLED=true  DSM_ENABLE=true  DSM_PRODUCT=" + product);
  console.log("   DSM_LIDAR_ONDEMAND=true   DSM_LIDAR_DATA_DIR=" + dataDir);
}
process.exit(r.ok || r.requested === 0 ? 0 : 1);
