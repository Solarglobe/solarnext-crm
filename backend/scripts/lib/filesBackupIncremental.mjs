/**
 * CP-074 — Copie incrémentale : ne recopie pas si taille + mtime source inchangés vs destination.
 */

import fs from "fs";
import path from "path";

const IGNORE_DIR_NAMES = new Set([
  "node_modules",
  ".git",
  "tmp",
  "temp",
  ".tmp",
  "logs",
  "log",
]);

function ignoreFileName(name) {
  if (name === ".DS_Store" || name === "Thumbs.db") return true;
  if (name.endsWith(".log")) return true;
  return false;
}

/**
 * @param {string} srcRootAbs
 * @param {string} dstRootAbs
 * @param {{ copied: number, skipped: number, bytesCopied: number }} stats
 */
export async function copyTreeIncremental(srcRootAbs, dstRootAbs, stats) {
  if (!fs.existsSync(srcRootAbs)) {
    return;
  }

  async function walk(srcDir, dstDir) {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ignoreFileName(ent.name)) continue;
      const src = path.join(srcDir, ent.name);
      const dst = path.join(dstDir, ent.name);

      if (ent.isDirectory()) {
        if (IGNORE_DIR_NAMES.has(ent.name)) continue;
        await fs.promises.mkdir(dst, { recursive: true });
        await walk(src, dst);
        continue;
      }

      if (!ent.isFile()) continue;

      const st = await fs.promises.stat(src);
      let doCopy = true;
      try {
        const dt = await fs.promises.stat(dst);
        if (dt.size === st.size && Math.abs(dt.mtimeMs - st.mtimeMs) < 2000) {
          doCopy = false;
        }
      } catch {
        doCopy = true;
      }

      if (!doCopy) {
        stats.skipped += 1;
        continue;
      }

      await fs.promises.mkdir(path.dirname(dst), { recursive: true });
      await fs.promises.copyFile(src, dst);
      await fs.promises.utimes(dst, st.atime, st.mtime);
      stats.copied += 1;
      stats.bytesCopied += st.size;
    }
  }

  await fs.promises.mkdir(dstRootAbs, { recursive: true });
  await walk(srcRootAbs, dstRootAbs);
}

/**
 * Copie complète (restore) : toujours écraser — le snapshot est la source de vérité.
 * @param {string} srcRootAbs
 * @param {string} dstRootAbs
 * @param {{ copied: number, bytesCopied: number }} stats
 */
export async function copyTreeOverwrite(srcRootAbs, dstRootAbs, stats) {
  if (!fs.existsSync(srcRootAbs)) {
    return;
  }

  async function walk(srcDir, dstDir) {
    const entries = await fs.promises.readdir(srcDir, { withFileTypes: true });
    for (const ent of entries) {
      if (ignoreFileName(ent.name)) continue;
      const src = path.join(srcDir, ent.name);
      const dst = path.join(dstDir, ent.name);

      if (ent.isDirectory()) {
        if (IGNORE_DIR_NAMES.has(ent.name)) continue;
        await fs.promises.mkdir(dst, { recursive: true });
        await walk(src, dst);
        continue;
      }

      if (!ent.isFile()) continue;

      const st = await fs.promises.stat(src);
      await fs.promises.mkdir(path.dirname(dst), { recursive: true });
      await fs.promises.copyFile(src, dst);
      await fs.promises.utimes(dst, st.atime, st.mtime);
      stats.copied += 1;
      stats.bytesCopied += st.size;
    }
  }

  await fs.promises.mkdir(dstRootAbs, { recursive: true });
  await walk(srcRootAbs, dstRootAbs);
}

/**
 * Taille totale des fichiers sous root (récursif, ignore mêmes règles que la copie).
 * @param {string} rootAbs
 */
export async function totalSizeBytes(rootAbs) {
  if (!fs.existsSync(rootAbs)) return 0;
  let n = 0;
  async function walk(dir) {
    const entries = await fs.promises.readdir(dir, { withFileTypes: true });
    for (const ent of entries) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) {
        if (IGNORE_DIR_NAMES.has(ent.name)) continue;
        await walk(p);
      } else if (ent.isFile()) {
        if (ignoreFileName(ent.name)) continue;
        const st = await fs.promises.stat(p);
        n += st.size;
      }
    }
  }
  await walk(rootAbs);
  return n;
}
