/**
 * IGN Dynamic Tile Loader — Téléchargement dalles IGN (OFF | HTTP | S3).
 * Support auth, retry/backoff, écriture atomique (temp + rename), validation header ASC.
 * Ne modifie pas le moteur shading.
 */

import fs from "fs";
import path from "path";
import { getIgnCacheRoot } from "./paths.js";
import { parseEsriAsciiGridHeader } from "../horizon/providers/ign/parseEsriAsciiGrid.js";
import { incrementDownload, incrementFailure } from "./ignMetrics.js";

const LOG_PREFIX = "[IGN Tile Downloader]";

const DEFAULT_RETRIES = 3;
const DEFAULT_TIMEOUT_MS = 60_000;
const BACKOFF_MS = [500, 1000, 2000];

function getDownloadMode() {
  const m = (process.env.IGN_DOWNLOAD_MODE || "OFF").toUpperCase();
  return m === "HTTP" || m === "S3" || m === "LOCAL_MIRROR" ? m : "OFF";
}

function getRetries() {
  const v = process.env.IGN_DOWNLOAD_RETRIES;
  return v != null && v !== "" ? Math.max(1, parseInt(v, 10)) : DEFAULT_RETRIES;
}

function getTimeoutMs() {
  const v = process.env.IGN_DOWNLOAD_TIMEOUT_MS;
  return v != null && v !== "" ? Math.max(1000, parseInt(v, 10)) : DEFAULT_TIMEOUT_MS;
}

/**
 * Valide un fichier .asc (taille > 0 et header parse OK).
 * @param {string} filePath
 * @returns {{ ok: boolean, error?: string }}
 */
function validateAscFile(filePath) {
  try {
    if (!fs.existsSync(filePath)) return { ok: false, error: "File missing" };
    const stat = fs.statSync(filePath);
    if (stat.size <= 0) return { ok: false, error: "File empty" };
    const header = parseEsriAsciiGridHeader(filePath);
    if (header.width <= 0 || header.height <= 0 || !Number.isFinite(header.x0) || !Number.isFinite(header.y0)) {
      return { ok: false, error: "Invalid ASC header" };
    }
    return { ok: true };
  } catch (err) {
    return { ok: false, error: err?.message ?? "Validation failed" };
  }
}

/**
 * Télécharge en mode OFF → throw.
 * @param {string} _tileId
 */
async function downloadModeOff(_tileId) {
  throw new Error("IGN download disabled (IGN_DOWNLOAD_MODE=OFF)");
}

/**
 * Télécharge via HTTP (stream → temp → rename atomique). Retry + backoff.
 * @param {string} tileId
 * @param {string} cacheDir
 * @returns {Promise<{ success: boolean, localPath?: string, error?: string }>}
 */
async function downloadModeHttp(tileId, cacheDir) {
  const baseUrl = (process.env.IGN_HTTP_BASE_URL || "").replace(/\/$/, "");
  const token = process.env.IGN_HTTP_BEARER_TOKEN;
  const timeoutMs = getTimeoutMs();
  const retries = getRetries();

  if (!baseUrl) {
    return { success: false, error: "IGN_HTTP_BASE_URL not set" };
  }

  const url = `${baseUrl}/${encodeURIComponent(tileId)}.asc`;
  const localPath = path.join(cacheDir, `${tileId}.asc`);
  const tmpPath = path.join(cacheDir, `${tileId}.asc.tmp.${process.pid}.${Date.now()}`);

  const headers = {};
  if (token) headers.Authorization = `Bearer ${token}`;

  let lastError = "";
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
      await new Promise((r) => setTimeout(r, delay));
    }
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal, headers });
      clearTimeout(timeoutId);
      if (!res.ok) {
        lastError = `HTTP ${res.status}`;
        continue;
      }
      const buf = await res.arrayBuffer();
      if (!buf || buf.byteLength === 0) {
        lastError = "Empty response";
        continue;
      }
      fs.writeFileSync(tmpPath, Buffer.from(buf), "binary");
      fs.renameSync(tmpPath, localPath);
      const valid = validateAscFile(localPath);
      if (!valid.ok) {
        try { fs.unlinkSync(localPath); } catch (_) {}
        lastError = valid.error ?? "Invalid ASC";
        continue;
      }
      console.log(`${LOG_PREFIX} saved ${tileId} (${buf.byteLength} bytes)`);
      return { success: true, localPath };
    } catch (err) {
      clearTimeout(timeoutId);
      lastError = err?.name === "AbortError" ? "Timeout" : (err?.message ?? String(err));
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }
  return { success: false, error: lastError || "Download failed" };
}

/**
 * Télécharge via S3 (GetObject → stream → temp → rename). Retry + backoff.
 * @param {string} tileId
 * @param {string} cacheDir
 * @returns {Promise<{ success: boolean, localPath?: string, error?: string }>}
 */
async function downloadModeS3(tileId, cacheDir) {
  const bucket = process.env.IGN_S3_BUCKET;
  const prefix = (process.env.IGN_S3_PREFIX || "").replace(/\/$/, "");
  const key = prefix ? `${prefix}/${tileId}.asc` : `${tileId}.asc`;
  const timeoutMs = getTimeoutMs();
  const retries = getRetries();

  if (!bucket || bucket === "") {
    return { success: false, error: "S3 not configured (IGN_S3_BUCKET missing)" };
  }

  let S3Client;
  let GetObjectCommand;
  try {
    const s3 = await import("@aws-sdk/client-s3");
    S3Client = s3.S3Client;
    GetObjectCommand = s3.GetObjectCommand;
  } catch (_) {
    return { success: false, error: "S3 not configured (AWS SDK unavailable)" };
  }

  const localPath = path.join(cacheDir, `${tileId}.asc`);
  const tmpPath = path.join(cacheDir, `${tileId}.asc.tmp.${process.pid}.${Date.now()}`);

  const client = new S3Client({});
  let lastError = "";
  for (let attempt = 0; attempt < retries; attempt++) {
    if (attempt > 0) {
      const delay = BACKOFF_MS[Math.min(attempt - 1, BACKOFF_MS.length - 1)];
      await new Promise((r) => setTimeout(r, delay));
    }
    try {
      const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      const stream = response.Body;
      if (!stream) {
        lastError = "No body";
        continue;
      }
      const chunks = [];
      for await (const chunk of stream) chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (buf.length === 0) {
        lastError = "Empty object";
        continue;
      }
      fs.writeFileSync(tmpPath, buf, "binary");
      fs.renameSync(tmpPath, localPath);
      const valid = validateAscFile(localPath);
      if (!valid.ok) {
        try { fs.unlinkSync(localPath); } catch (_) {}
        lastError = valid.error ?? "Invalid ASC";
        continue;
      }
      console.log(`${LOG_PREFIX} saved ${tileId} from S3 (${buf.length} bytes)`);
      return { success: true, localPath };
    } catch (err) {
      lastError = err?.message ?? String(err);
      try { if (fs.existsSync(tmpPath)) fs.unlinkSync(tmpPath); } catch (_) {}
    }
  }
  return { success: false, error: lastError || "S3 download failed" };
}

/**
 * Télécharge une dalle IGN selon IGN_DOWNLOAD_MODE (OFF | HTTP | S3).
 * OFF → throw. HTTP/S3 → retry/backoff, écriture atomique, validation ASC.
 * @param {string} tileId - identifiant de la tuile (ex: D077_2023 ou DTEST)
 * @returns {Promise<{ success: boolean, localPath?: string, error?: string }>}
 */
export async function downloadIgnTile(tileId) {
  const mode = getDownloadMode();

  if (mode === "OFF") {
    try {
      await downloadModeOff(tileId);
    } catch (err) {
      return { success: false, error: err?.message ?? "IGN download disabled" };
    }
    return { success: false, error: "IGN download disabled" };
  }

  const cacheDir = getIgnCacheRoot();
  if (!fs.existsSync(cacheDir)) {
    fs.mkdirSync(cacheDir, { recursive: true });
  }

  const startMs = Date.now();
  let result;
  if (mode === "HTTP") {
    result = await downloadModeHttp(tileId, cacheDir);
  } else if (mode === "S3") {
    result = await downloadModeS3(tileId, cacheDir);
  } else {
    result = { success: false, error: "IGN_DOWNLOAD_MODE not supported" };
  }

  const durationMs = Date.now() - startMs;
  if (result.success) {
    incrementDownload(durationMs);
  } else {
    incrementFailure();
  }
  return result;
}
