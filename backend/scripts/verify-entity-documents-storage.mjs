#!/usr/bin/env node
/**
 * Audit fichier vs DB — entity_documents.storage_key vs disque (même logique que getAbsolutePath).
 *
 * Usage :
 *   DATABASE_URL=… node scripts/verify-entity-documents-storage.mjs
 *   STORAGE_ROOT=/app/storage DATABASE_URL=… node …   (défaut prod)
 *   STORAGE_ROOT=./storage node …   (copie locale sous backend/storage)
 *
 * Options : --limit N (défaut : tous les non archivés), --json (sortie JSON seule)
 */

import { existsSync } from "fs";
import path from "path";
import pg from "pg";

const args = process.argv.slice(2);
const limitArg = args.find((a) => a.startsWith("--limit="));
const limit = limitArg ? Math.max(1, parseInt(limitArg.split("=")[1], 10) || 0) : null;
const jsonOnly = args.includes("--json");

function resolveLikeBackend(storageKey, root) {
  if (!storageKey || typeof storageKey !== "string") return null;
  const normalized = storageKey.replace(/\//g, path.sep);
  const fullPath = path.join(root, normalized);
  const resolved = path.resolve(fullPath);
  if (!resolved.startsWith(path.resolve(root))) return null;
  return resolved;
}

let url = process.env.DATABASE_URL;
if (!url || !String(url).trim()) {
  console.error("Définir DATABASE_URL ou l’exporter.");
  process.exit(1);
}
url = String(url).trim();
const needsInsecureSsl =
  /\brailway\.app\b/i.test(url) ||
  /proxy\.rlwy\.net/i.test(url) ||
  String(process.env.PGSSLMODE || "").toLowerCase() === "require";
let connectionString = url;
if (needsInsecureSsl) {
  connectionString = url
    .replace(/([?&])sslmode=[^&]*/gi, "$1")
    .replace(/([?&])ssl=[^&]*/gi, "$1")
    .replace(/\?&/g, "?")
    .replace(/[?&]$/g, "");
}
const pool = new pg.Pool({
  connectionString,
  ...(needsInsecureSsl ? { ssl: { rejectUnauthorized: false } } : {}),
});

const root = path.resolve(process.env.STORAGE_ROOT || process.env.VERIFY_STORAGE_ROOT || "/app/storage");

const sql = `
  SELECT id, organization_id, entity_type, document_type, storage_key, file_name, archived_at
  FROM entity_documents
  WHERE archived_at IS NULL
  ORDER BY created_at
  ${limit != null ? `LIMIT ${Number(limit)}` : ""}
`;

try {
  const { rows } = await pool.query(sql);
  const stats = {
    total: rows.length,
    present: 0,
    missing: 0,
    bad_key: 0,
    by_prefix: {},
    by_entity_type: {},
    pending_only: 0,
    samples_missing: [],
    /** Jusqu’à 5 `storage_key` avec fichier absent (hors clés `pending/…`) */
    missing_file_sample_keys: [],
  };

  for (const row of rows) {
    const sk = row.storage_key;
    if (!sk) {
      stats.bad_key += 1;
      continue;
    }
    const prefix = sk.split("/")[0] || "(empty)";
    stats.by_prefix[prefix] = (stats.by_prefix[prefix] || 0) + 1;
    const et = row.entity_type || "?";
    stats.by_entity_type[et] = (stats.by_entity_type[et] || 0) + 1;
    if (sk.startsWith("pending/")) stats.pending_only += 1;

    const abs = resolveLikeBackend(sk, root);
    if (abs == null) {
      stats.bad_key += 1;
      if (stats.samples_missing.length < 15) {
        stats.samples_missing.push({ id: row.id, reason: "path_traversal_or_invalid", storage_key: sk });
      }
      continue;
    }
    if (existsSync(abs)) {
      stats.present += 1;
    } else {
      stats.missing += 1;
      if (stats.samples_missing.length < 40) {
        stats.samples_missing.push({
          id: row.id,
          storage_key: sk,
          expected_path: abs,
          entity_type: row.entity_type,
          document_type: row.document_type,
        });
      }
      if (!sk.startsWith("pending/") && stats.missing_file_sample_keys.length < 5) {
        stats.missing_file_sample_keys.push(sk);
      }
    }
  }

  const pct = stats.total ? ((100 * stats.present) / stats.total).toFixed(2) : "0";
  const out = {
    storage_root_resolved: root,
    ...stats,
    percent_files_present: pct,
  };

  if (jsonOnly) {
    console.log(JSON.stringify(out, null, 2));
  } else {
    console.log(JSON.stringify(out, null, 2));
    console.log("\n--- Classement 1er segment storage_key (préfixe) ---");
    console.log(
      Object.entries(stats.by_prefix)
        .sort((a, b) => b[1] - a[1])
        .map(([k, v]) => `  ${k}: ${v}`)
        .join("\n")
    );
  }

  await pool.end();
  process.exit(stats.missing + stats.bad_key > 0 ? 2 : 0);
} catch (e) {
  console.error(e?.message || e);
  try {
    await pool.end();
  } catch {
    /* ignore */
  }
  process.exit(1);
}
