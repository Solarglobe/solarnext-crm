/**
 * CP-073 — Liste et élagage des fichiers solarnext_backup_*.sql.gz (partagé backup + tests).
 */

import fs from "fs";
import path from "path";

export function listBackupFiles(root) {
  const out = [];
  if (!fs.existsSync(root)) return out;
  const stack = [root];
  while (stack.length) {
    const dir = stack.pop();
    const ents = fs.readdirSync(dir, { withFileTypes: true });
    for (const ent of ents) {
      const p = path.join(dir, ent.name);
      if (ent.isDirectory()) stack.push(p);
      else if (ent.name.startsWith("solarnext_backup_") && ent.name.endsWith(".sql.gz")) out.push(p);
    }
  }
  return out;
}

/**
 * @param {string} root
 * @param {number} keepCount
 */
export function pruneOldBackups(root, keepCount, logFn = console.log) {
  const files = listBackupFiles(root);
  if (files.length <= keepCount) {
    logFn(`${files.length} fichier(s), rien à supprimer (max ${keepCount}).`);
    return { removed: 0, kept: files.length };
  }
  const withMtime = files.map((f) => ({ f, t: fs.statSync(f).mtimeMs }));
  withMtime.sort((a, b) => b.t - a.t);
  const toRemove = withMtime.slice(keepCount);
  for (const { f } of toRemove) {
    try {
      fs.unlinkSync(f);
      logFn(`Supprimé : ${f}`);
    } catch (e) {
      logFn(`Échec suppression ${f}: ${e?.message}`);
    }
  }
  logFn(`Conservé ${keepCount} plus récent(s), supprimé ${toRemove.length} fichier(s).`);
  return { removed: toRemove.length, kept: keepCount };
}
