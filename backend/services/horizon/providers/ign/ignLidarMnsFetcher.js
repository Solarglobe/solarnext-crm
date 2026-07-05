/**
 * CP-FAR-MNS-01 — Récupérateur « à la demande » des dalles MNS/MNH LiDAR HD (IGN).
 *
 * Pour un point (lat, lon) + rayon, interroge la TABLE D'ASSEMBLAGE WFS de l'IGN
 * (data.geopf.fr/wfs/ows, couche IGNF_MNS-LIDAR-HD:dalle) qui liste chaque dalle
 * 1 km × 1 km couvrant la zone, avec :
 *   - properties.url          → URL de téléchargement du GeoTIFF (WMS GetMap, image/geotiff)
 *   - properties.name_download→ nom de fichier (…_LAMB93_IGN69.tif)
 *   - properties.bbox         → "minX,minY,maxX,maxY" (mètres, projection ci-dessous)
 *   - properties.projection   → "EPSG:2154" en métropole (autres CRS en DROM)
 *
 * On télécharge les dalles manquantes, on les met en cache, et on met à jour
 * index.json (format { tiles:[{ pathRel, bboxLambert93 }] }) consommé par
 * surfaceDsmProvider via le loader GeoTIFF.
 *
 * v1 : métropole (EPSG:2154) uniquement — les dalles d'autre projection sont
 * ignorées (à traiter dans un lot DROM dédié).
 *
 * Réseau injectable (fetchImpl / downloadImpl) pour tests hors-ligne.
 */

import fs from "fs";
import path from "path";
import { wgs84ToLambert93 } from "./projection2154.js";

const WFS_BASE = "https://data.geopf.fr/wfs/ows";
const SUPPORTED_PROJECTION = "EPSG:2154";

/** @param {"MNS"|"MNH"} product */
function typeNameForProduct(product) {
  const p = (product || "MNS").toUpperCase();
  if (p === "MNH") return "IGNF_MNH-LIDAR-HD:dalle";
  return "IGNF_MNS-LIDAR-HD:dalle";
}

/**
 * Construit l'URL WFS GetFeature (JSON) pour une bbox Lambert-93.
 * @param {{ product?: string, minX: number, minY: number, maxX: number, maxY: number, count?: number }} p
 * @returns {string}
 */
export function buildDalleWfsUrl({ product = "MNS", minX, minY, maxX, maxY, count = 200 }) {
  const params = new URLSearchParams({
    SERVICE: "WFS",
    VERSION: "2.0.0",
    REQUEST: "GetFeature",
    TYPENAMES: typeNameForProduct(product),
    OUTPUTFORMAT: "application/json",
    SRSNAME: "EPSG:2154",
    COUNT: String(count),
    // BBOX en Lambert-93 (CRS suffixé) → pas d'ambiguïté d'ordre d'axes.
    BBOX: `${minX},${minY},${maxX},${maxY},EPSG:2154`,
  });
  return `${WFS_BASE}?${params.toString()}`;
}

/**
 * Transforme la réponse WFS (FeatureCollection) en enregistrements normalisés.
 * FONCTION PURE (testable hors-ligne).
 * @param {object} json - FeatureCollection GeoJSON
 * @returns {{ tiles: Array<{ name: string, filename: string, urlTif: string, bboxLambert93: {minX:number,minY:number,maxX:number,maxY:number} }>, skippedProjection: number }}
 */
export function parseDalleFeatures(json) {
  const out = [];
  let skippedProjection = 0;
  const feats = Array.isArray(json?.features) ? json.features : [];
  for (const f of feats) {
    const pr = f?.properties || {};
    if ((pr.projection || "").toUpperCase() !== SUPPORTED_PROJECTION) {
      skippedProjection++;
      continue;
    }
    const bboxStr = String(pr.bbox || "");
    const parts = bboxStr.split(",").map((s) => parseFloat(s.trim()));
    if (parts.length !== 4 || parts.some((n) => !Number.isFinite(n))) continue;
    const [minX, minY, maxX, maxY] = parts;
    const filename = String(pr.name_download || `${pr.name || pr.id}.tif`);
    const urlTif = String(pr.url || "");
    if (!urlTif) continue;
    out.push({
      name: String(pr.name || pr.id || filename),
      filename,
      urlTif,
      bboxLambert93: { minX, minY, maxX, maxY },
    });
  }
  return { tiles: out, skippedProjection };
}

/**
 * Interroge le WFS pour la bbox donnée. fetchImpl injectable (défaut : global fetch).
 * @param {{ product?: string, minX, minY, maxX, maxY, fetchImpl?: Function, timeoutMs?: number }} p
 */
export async function fetchDallesForBbox({ product = "MNS", minX, minY, maxX, maxY, fetchImpl, timeoutMs = 15000 }) {
  const doFetch = fetchImpl || globalThis.fetch;
  const url = buildDalleWfsUrl({ product, minX, minY, maxX, maxY });
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(url, { signal: controller.signal, headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(`WFS HTTP ${res.status}`);
    const json = await res.json();
    return parseDalleFeatures(json);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Télécharge un GeoTIFF de dalle (écriture atomique temp→rename).
 * @param {{ urlTif: string, destPath: string, downloadImpl?: Function, timeoutMs?: number }} p
 * @returns {Promise<{ ok: boolean, bytes?: number, error?: string }>}
 */
export async function downloadDalleTif({ urlTif, destPath, downloadImpl, timeoutMs = 120000 }) {
  const doFetch = downloadImpl || globalThis.fetch;
  const tmp = `${destPath}.tmp.${process.pid}.${Date.now()}`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await doFetch(urlTif, { signal: controller.signal, headers: { Accept: "image/tiff" } });
    if (!res.ok) return { ok: false, error: `HTTP ${res.status}` };
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength === 0) return { ok: false, error: "Empty tif" };
    fs.mkdirSync(path.dirname(destPath), { recursive: true });
    fs.writeFileSync(tmp, buf);
    fs.renameSync(tmp, destPath);
    return { ok: true, bytes: buf.byteLength };
  } catch (err) {
    try { if (fs.existsSync(tmp)) fs.unlinkSync(tmp); } catch (_) {}
    return { ok: false, error: err?.name === "AbortError" ? "Timeout" : (err?.message ?? String(err)) };
  } finally {
    clearTimeout(timer);
  }
}

/** Lit index.json (ou {tiles:[]}) ; merge tuiles (dédup par pathRel) ; écrit atomique. */
function mergeIndex(dataDir, newTiles) {
  const indexPath = path.join(dataDir, "index.json");
  let index = { tiles: [] };
  if (fs.existsSync(indexPath)) {
    try {
      const parsed = JSON.parse(fs.readFileSync(indexPath, "utf8"));
      if (parsed && Array.isArray(parsed.tiles)) index = parsed;
    } catch (_) { /* repart d'un index vide */ }
  }
  const seen = new Set(index.tiles.map((t) => t.pathRel));
  let added = 0;
  for (const t of newTiles) {
    if (seen.has(t.pathRel)) continue;
    index.tiles.push({ pathRel: t.pathRel, bboxLambert93: t.bboxLambert93 });
    seen.add(t.pathRel);
    added++;
  }
  const tmp = `${indexPath}.tmp.${process.pid}.${Date.now()}`;
  fs.writeFileSync(tmp, JSON.stringify(index, null, 2));
  fs.renameSync(tmp, indexPath);
  return { added, total: index.tiles.length };
}

/**
 * S'assure que les dalles MNS/MNH couvrant (lat, lon ± rayon) sont en cache + indexées.
 * Idempotent : les dalles déjà présentes ne sont pas re-téléchargées.
 * @param {{ lat:number, lon:number, radius_m?:number, dataDir:string, product?:string,
 *           fetchImpl?:Function, downloadImpl?:Function, maxTiles?:number }} p
 * @returns {Promise<{ ok:boolean, requested:number, downloaded:number, cached:number,
 *                     indexed:number, skippedProjection:number, errors:string[] }>}
 */
export async function ensureMnsTilesForPoint({
  lat, lon, radius_m = 1000, dataDir, product = "MNS",
  fetchImpl, downloadImpl, maxTiles = 25,
}) {
  if (!dataDir) throw new Error("ensureMnsTilesForPoint: dataDir requis");
  fs.mkdirSync(dataDir, { recursive: true });

  const c = wgs84ToLambert93({ lat, lon });
  const { tiles, skippedProjection } = await fetchDallesForBbox({
    product,
    minX: c.x - radius_m, minY: c.y - radius_m,
    maxX: c.x + radius_m, maxY: c.y + radius_m,
    fetchImpl,
  });

  const errors = [];
  const toIndex = [];
  let downloaded = 0;
  let cached = 0;
  const limited = tiles.slice(0, maxTiles);

  for (const t of limited) {
    const pathRel = t.filename;
    const destPath = path.join(dataDir, pathRel);
    if (fs.existsSync(destPath) && fs.statSync(destPath).size > 0) {
      cached++;
      toIndex.push({ pathRel, bboxLambert93: t.bboxLambert93 });
      continue;
    }
    const r = await downloadDalleTif({ urlTif: t.urlTif, destPath, downloadImpl });
    if (r.ok) {
      downloaded++;
      toIndex.push({ pathRel, bboxLambert93: t.bboxLambert93 });
    } else {
      errors.push(`${pathRel}: ${r.error}`);
    }
  }

  const { added, total } = toIndex.length ? mergeIndex(dataDir, toIndex) : { added: 0, total: 0 };

  return {
    ok: (downloaded + cached) > 0,
    requested: tiles.length,
    downloaded,
    cached,
    indexed: total,
    added,
    skippedProjection,
    errors,
  };
}
