/**
 * CP-FAR-MNS-01 — Test hors-ligne du récupérateur MNS (WFS + orchestration).
 * Utilise un échantillon RÉEL de réponse WFS IGN (Paris + La Réunion) et des
 * implémentations réseau injectées → aucun accès réseau requis.
 *
 * Vérifie : parsing bbox L93, filtre projection (Réunion EPSG:2975 ignorée),
 * extraction url, écriture des .tif simulés, génération d'index.json correct.
 *
 * Lancement : node backend/scripts/test-mns-wfs-parse.mjs
 */

import fs from "fs";
import os from "os";
import path from "path";
import {
  parseDalleFeatures,
  buildDalleWfsUrl,
  ensureMnsTilesForPoint,
} from "../services/horizon/providers/ign/ignLidarMnsFetcher.js";

let pass = true;
const chk = (l, cond) => { pass = pass && cond; console.log(`${cond ? "✓" : "✗"} ${l}`); };

// Échantillon WFS réel : 2 dalles métropole (EPSG:2154) + 1 Réunion (EPSG:2975, à ignorer)
const WFS_SAMPLE = {
  type: "FeatureCollection",
  features: [
    { properties: { name: "LHD_FXX_0651_6863_MNS", name_download: "LHD_FXX_0651_6863_MNS.tif",
        url: "https://data.geopf.fr/wms-r?...&FILENAME=LHD_FXX_0651_6863_MNS.tif",
        projection: "EPSG:2154", bbox: "650999.75,6862000.25,651999.75,6863000.25", format: "image/geotiff" } },
    { properties: { name: "LHD_FXX_0652_6863_MNS", name_download: "LHD_FXX_0652_6863_MNS.tif",
        url: "https://data.geopf.fr/wms-r?...&FILENAME=LHD_FXX_0652_6863_MNS.tif",
        projection: "EPSG:2154", bbox: "651999.75,6862000.25,652999.75,6863000.25", format: "image/geotiff" } },
    { properties: { name: "LHD_R04_0356_7682_MNS", name_download: "LHD_REU_0356_7682_MNS.tif",
        url: "https://data.geopf.fr/wms-r?...&FILENAME=LHD_REU_0356_7682_MNS.tif",
        projection: "EPSG:2975", bbox: "355999.75,7681000.25,356999.75,7682000.25", format: "image/geotiff" } },
  ],
};

// --- 1) parsing pur ---
const parsed = parseDalleFeatures(WFS_SAMPLE);
chk("2 dalles métropole retenues", parsed.tiles.length === 2);
chk("1 dalle hors L93 ignorée (Réunion 2975)", parsed.skippedProjection === 1);
chk("bbox L93 correcte", parsed.tiles[0].bboxLambert93.minX === 650999.75 &&
     parsed.tiles[0].bboxLambert93.maxY === 6863000.25);
chk("url extraite", parsed.tiles[0].urlTif.includes("FILENAME=LHD_FXX_0651_6863_MNS.tif"));

// --- 2) URL WFS bien formée ---
const url = buildDalleWfsUrl({ product: "MNS", minX: 651000, minY: 6862000, maxX: 652000, maxY: 6863000 });
chk("URL WFS: couche MNS", url.includes("IGNF_MNS-LIDAR-HD%3Adalle") || url.includes("IGNF_MNS-LIDAR-HD:dalle"));
chk("URL WFS: bbox EPSG:2154", /BBOX=651000.*6862000.*652000.*6863000.*EPSG.*2154/.test(decodeURIComponent(url)));
const urlMnh = buildDalleWfsUrl({ product: "MNH", minX: 0, minY: 0, maxX: 1, maxY: 1 });
chk("URL WFS: bascule couche MNH", decodeURIComponent(urlMnh).includes("IGNF_MNH-LIDAR-HD:dalle"));

// --- 3) orchestration complète avec réseau injecté ---
const TMP = fs.mkdtempSync(path.join(os.tmpdir(), "mns-fetch-"));
const fakeFetch = async () => ({ ok: true, json: async () => WFS_SAMPLE });
const fakeDownload = async (u) => ({ ok: true, arrayBuffer: async () => Buffer.from(`TIF:${u}`).buffer });

const r = await ensureMnsTilesForPoint({
  lat: 48.857, lon: 2.352, radius_m: 800, dataDir: TMP, product: "MNS",
  fetchImpl: fakeFetch, downloadImpl: fakeDownload,
});
chk("2 dalles téléchargées", r.downloaded === 2);
chk("Réunion ignorée (skippedProjection=1)", r.skippedProjection === 1);
chk("index.json créé avec 2 tuiles", r.indexed === 2 && r.added === 2);
chk("fichiers .tif écrits", fs.existsSync(path.join(TMP, "LHD_FXX_0651_6863_MNS.tif")) &&
     fs.existsSync(path.join(TMP, "LHD_FXX_0652_6863_MNS.tif")));

const idx = JSON.parse(fs.readFileSync(path.join(TMP, "index.json"), "utf8"));
chk("index format {tiles:[{pathRel,bboxLambert93}]}",
     idx.tiles.length === 2 && idx.tiles[0].pathRel.endsWith(".tif") &&
     idx.tiles[0].bboxLambert93.minX === 650999.75);

// --- 4) idempotence : 2e passage ne re-télécharge pas ---
const r2 = await ensureMnsTilesForPoint({
  lat: 48.857, lon: 2.352, radius_m: 800, dataDir: TMP, product: "MNS",
  fetchImpl: fakeFetch, downloadImpl: fakeDownload,
});
chk("2e passage : 0 téléchargement, 2 en cache", r2.downloaded === 0 && r2.cached === 2);

fs.rmSync(TMP, { recursive: true, force: true });
console.log(pass ? "\n✅ PASS — récupérateur MNS à la demande (WFS + download + index) correct"
                 : "\n❌ FAIL");
process.exit(pass ? 0 : 1);
