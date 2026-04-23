#!/usr/bin/env node
/**
 * Copie un dossier local (même arborescence que les storage_key) vers /app/storage sur Railway.
 * Méthode : `tar` (évent. `-z`) (local) | `railway ssh` `sh -c` avec `dd` + `tar` sur fichier
 * (pas de `tar -f -` : PTY SSH → GNU tar refuse la lecture sur stdin).
 *
 * Prérequis : `railway link` dans le dépôt, CLI installé (`npm i -g @railway/cli`), Node.
 * Windows : utilisation de `node $(npm root -g)/@railway/cli/bin/railway.js` (évite EINVAL sur railway.cmd).
 *
 * Usage (le chemin passé à `node` est relatif au répertoire courant du terminal) :
 *   Depuis la racine du dépôt (Solarnext-crm) :
 *     node backend/scripts/railway-restore-storage.mjs
 *     npm run restore:storage:railway
 *   Depuis le dossier backend/ : ne pas écrire `node backend/scripts/...` (erreur
 *   MODULE_NOT_FOUND → …\\backend\\backend\\scripts) ; utiliser plutôt :
 *     node scripts/railway-restore-storage.mjs
 *     npm run restore:storage:railway
 *   Autre dossier source :
 *     node backend/scripts/railway-restore-storage.mjs "C:\\chemin\\vers\\storage"
 *   --chunk   (ou RESTORE_TOP_LEVEL_CHUNKS=1) : une session SSH / une archive par répertoire de 1er niveau.
 *   --file-batch=40   (ou RESTORE_FILE_BATCH=40) : prioritaire sur --chunk — lot de N fichiers par session
 *              (sessions courtes, recommandé si WebSocket coupe sur de grosses tranches).
 *   --no-gzip   ou   RESTORE_GZIP=0   : envoi .tar sans compression (défaut : gzip pour réduire le flux).
 *   RESTORE_SSH_RETRIES=3   : tentatives par tranche en cas d’erreur WebSocket / réseau.
 *   RESTORE_QUIET=1 node ...   ou   --quiet   → n’affiche pas chaque fichier (seulement le compte)
 *
 * Défaut : `<racine du dépôt>/storage` (même arbo qu’un `tar -tf backup.tar` avec préfixe `storage/...`).
 * Si ce dossier n’existe pas, repli : `<racine>/backend/storage`. Les backups (ex. `storage.tar.gz`) extraient
 * en général un dossier `storage/` à la racine, pas sous `backend/`.
 *
 * Cible distante (volume Railway) : `RESTORE_REMOTE_ROOT` (défaut `/app/storage`). Doit coïncider avec
 * le montage et `STORAGE_ROOT` côté app. Service cible SSH : `RAILWAY_SERVICE` (défaut `solarnext-crm`).
 */

import { execFile, execSync, spawn } from "child_process";
import fs from "fs/promises";
import { existsSync, readdirSync, statSync } from "fs";
import path from "path";
import { fileURLToPath } from "url";

/** Sous Windows, spawn de railway.cmd + stdio pipe → EINVAL : on appelle node …/@railway/cli/bin/railway.js */
function resolveRailwayMainAndArgs() {
  if (process.env.RAILWAY_CLI_JS?.trim()) {
    const js = process.env.RAILWAY_CLI_JS.trim();
    if (existsSync(js)) {
      return { cmd: process.execPath, argsPrefix: [js] };
    }
  }
  try {
    const root = execSync("npm root -g", { encoding: "utf8" }).trim();
    const js = path.join(root, "@railway", "cli", "bin", "railway.js");
    if (existsSync(js)) {
      return { cmd: process.execPath, argsPrefix: [js] };
    }
  } catch {
    /* ignore */
  }
  return { cmd: "railway", argsPrefix: [] };
}

const RAILWAY = resolveRailwayMainAndArgs();

const RAILWAY_SERVICE = (process.env.RAILWAY_SERVICE || "solarnext-crm").trim();
const RESTORE_REMOTE_ROOT = (() => {
  const e = (process.env.RESTORE_REMOTE_ROOT || "").trim() || "/app/storage";
  return e.replace(/\/+$/, "") || "/app/storage";
})();

/**
 * `railway ssh` — le service actif = lien CLI (`railway link`). Pas de `-s` ici :
 * sur Windows, `sh -c "node -e '…' »` se casse (REPL Node côté distant). Utiliser
 * `RAILWAY_SERVICE` dans le shell si besoin: `RAILWAY_SERVICE=solarnext-crm railway …`.
 */
function execRailwaySshCmd(remoteArgs, stdio) {
  const { cmd, argsPrefix } = RAILWAY;
  return execFile(
    cmd,
    [...argsPrefix, "ssh", ...remoteArgs],
    { stdio, env: { ...process.env, RAILWAY_SERVICE: RAILWAY_SERVICE } }
  );
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = path.resolve(__dirname, "..", "..");

function hasRealFilesInDir(dir) {
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return false;
  const n = readdirSync(dir, { withFileTypes: true });
  return n.some((e) => e.name !== ".gitkeep" && e.name !== "lost+found");
}

function resolveDefaultBackupDir() {
  const atRoot = path.join(REPO_ROOT, "storage");
  const atBackend = path.join(REPO_ROOT, "backend", "storage");
  if (hasRealFilesInDir(atRoot)) return atRoot;
  if (hasRealFilesInDir(atBackend)) return atBackend;
  return atRoot;
}

async function* walkFiles(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const e of entries) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) yield* walkFiles(p);
    else if (e.isFile()) {
      if (e.name === ".gitkeep") continue;
      yield p;
    }
  }
}

/** Chemin absolu Unix sûr : pas d’espace, pas de guillemets (évite troncature `sh -c` côté CLI Railway sur Windows). */
function assertSafeUnixStorageRoot(p) {
  if (typeof p !== "string" || p.length < 2 || !p.startsWith("/")) {
    throw new Error("RESTORE_REMOTE_ROOT doit être un chemin absolu (ex. /app/storage)");
  }
  if (p.includes("..") || /[\r\n\0'"\s]/.test(p)) {
    throw new Error("RESTORE_REMOTE_ROOT invalide (espaces, guillemets, .., etc.)");
  }
  if (!/^\/[A-Za-z0-9_/.-]+$/.test(p)) {
    throw new Error("RESTORE_REMOTE_ROOT invalide (utilisez uniquement un chemin Unix sans espaces)");
  }
  return p;
}

function runStreamOnce(localRoot, tarEntries, label, rRoot, useGzip) {
  const ext = useGzip ? "tgz" : "tar";
  const tarExtract = useGzip ? "tar -xzf" : "tar -xf";
  /**
   * `dd` vers un fichier sur le volume puis extraction (pas `tar -f -` : PTY SSH → GNU tar refuse stdin).
   */
  const script = `R=${rRoot};F=$R/.railway-restore-incoming.${ext};set -e;rm -f "$F";dd of="$F" bs=4M status=none;${tarExtract} "$F" -C "$R";rm -f "$F"`;

  const tarFlags = useGzip ? ["-czf", "-"] : ["-cf", "-"];

  return new Promise((resolve, reject) => {
    const tar = spawn("tar", [...tarFlags, ...tarEntries], {
      cwd: localRoot,
      stdio: ["ignore", "pipe", "inherit"],
    });
    const ssh = execRailwaySshCmd(["sh", "-c", script], ["pipe", "inherit", "pipe"]);
    let err = "";
    tar.stdout.pipe(ssh.stdin);
    tar.stdout.on("error", (e) => {
      if (e && e.code === "EPIPE") {
        return;
      }
      try {
        ssh.stdin.end();
      } catch {
        /* ignore */
      }
      reject(e);
    });
    ssh.stdin?.on("error", (e) => {
      if (e && e.code === "EPIPE") return;
      reject(e);
    });
    tar.on("error", (e) => {
      try {
        ssh.stdin.end();
        ssh.kill();
      } catch {
        /* ignore */
      }
      reject(e);
    });
    ssh.on("error", (e) => {
      try {
        tar.kill();
      } catch {
        /* ignore */
      }
      reject(e);
    });
    ssh.stdout?.on("data", (c) => {
      process.stdout.write(c);
    });
    ssh.stderr?.on("data", (c) => {
      err += String(c);
      process.stderr.write(c);
    });
    tar.on("close", (code) => {
      if (code !== 0) {
        try {
          ssh.kill();
        } catch {
          /* ignore */
        }
        reject(new Error(`tar exit ${code} (${label})`));
      }
    });
    ssh.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`railway ssh exit ${code} (${label}) ${err || ""}`.trim()));
        return;
      }
      console.log(`[RESTORE] OK tranche : ${label}`);
      resolve();
    });
  });
}

async function runStreamChunk(localRoot, tarEntries, label, opts = {}) {
  const rRoot = assertSafeUnixStorageRoot(RESTORE_REMOTE_ROOT);
  const useGzip = opts.gzip !== false;
  const maxAttempts = Math.max(1, parseInt(process.env.RESTORE_SSH_RETRIES || "3", 10) || 3);
  let lastErr;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      await runStreamOnce(localRoot, tarEntries, label, rRoot, useGzip);
      return;
    } catch (e) {
      lastErr = e;
      const msg = String(e?.message || e);
      const retriable = /websocket|tungstenite|ECONNRESET|ETIMEDOUT|EPIPE/i.test(msg);
      if (attempt < maxAttempts && retriable) {
        const delay = 4000 * attempt;
        console.error(
          `[RESTORE] tentative ${attempt}/${maxAttempts} échouée (${label}) — attente ${delay}ms avant réessai…`
        );
        await new Promise((r) => setTimeout(r, delay));
        continue;
      }
      throw e;
    }
  }
  throw lastErr;
}

async function main() {
  const raw = process.argv.slice(2);
  const chunkMode = process.env.RESTORE_TOP_LEVEL_CHUNKS === "1" || raw.includes("--chunk");
  const quiet = process.env.RESTORE_QUIET === "1" || raw.includes("--quiet");
  const fileBatchArg = raw.find((a) => a.startsWith("--file-batch="));
  const fileBatch = fileBatchArg
    ? Math.max(1, parseInt(String(fileBatchArg.split("=")[1] || ""), 10) || 0)
    : Math.max(0, parseInt(String(process.env.RESTORE_FILE_BATCH || "0"), 10) || 0);
  const useGzip = process.env.RESTORE_GZIP !== "0" && !raw.includes("--no-gzip");
  const pathArg = raw.filter(
    (a) => a !== "--chunk" && a !== "--quiet" && a !== "--no-gzip" && !a.startsWith("--file-batch=")
  )[0];
  const fromArg = pathArg || process.env.BACKUP_DIR;
  const localRoot = path.resolve(fromArg || resolveDefaultBackupDir());
  const st = await fs.stat(localRoot).catch(() => null);
  if (!st || !st.isDirectory()) {
    console.error("Dossier introuvable:", localRoot);
    process.exit(1);
  }
  if (!fromArg && !hasRealFilesInDir(localRoot)) {
    console.error(
      "[RESTORE] Dossier vide ou seulement .gitkeep :",
      localRoot,
      "— extraire p.ex. `storage.tar.gz` à la racine du dépôt (dossier `storage/` avec orgId/lead/...), ou passer le chemin :",
      "BACKUP_DIR=C:\\\\chemin\\\\vers\\\\storage node …"
    );
    process.exit(1);
  }

  const files = [];
  for await (const f of walkFiles(localRoot)) {
    const rel = path.relative(localRoot, f).split(path.sep).join("/");
    if (rel.startsWith("..") || rel.includes("..")) continue;
    files.push({ abs: f, rel });
  }

  if (quiet) {
    console.log(`[RESTORE] (quiet) ${files.length} chemins (cf. --quiet / RESTORE_QUIET=0 pour lister chaque fichier)`);
  } else {
    for (const { rel } of files) {
      console.log(`[RESTORE] fichier envoyé : ${rel}`);
    }
  }
  if (files.length === 0) {
    console.error("[RESTORE] aucun fichier à envoyer (dossier vide ?)");
    process.exit(1);
  }
  console.log(`[RESTORE] CLI :`, RAILWAY.cmd, RAILWAY.argsPrefix.length ? RAILWAY.argsPrefix.join(" ") : "(PATH railway)");
  console.log(
    `[RESTORE] service=${RAILWAY_SERVICE} → distant ${RESTORE_REMOTE_ROOT} (doit = volume + STORAGE_ROOT)`
  );
  if (fileBatch > 0) {
    console.log(
      `[RESTORE] mode lots : ${fileBatch} fichier(s)/session, gzip=${useGzip} — ${files.length} chemins`
    );
  } else {
    console.log(
      chunkMode
        ? `[RESTORE] mode tranches (1ère colonne), gzip=${useGzip} — ${files.length} chemins`
        : `[RESTORE] total : ${files.length} chemins, gzip=${useGzip} — 1 stream tar → railway ssh`
    );
  }

  await new Promise((res, rej) => {
    const c = execRailwaySshCmd(["mkdir", "-p", RESTORE_REMOTE_ROOT], ["ignore", "ignore", "pipe"]);
    let e = "";
    c.stderr?.on("data", (d) => {
      e += String(d);
    });
    c.on("close", (code) => (code === 0 ? res() : rej(new Error(`mkdir -p: ${code} ${e}`.trim()))));
    c.on("error", rej);
  });

  if (fileBatch > 0) {
    const sorted = [...files].sort((a, b) => a.rel.localeCompare(b.rel));
    for (let i = 0; i < sorted.length; i += fileBatch) {
      const batch = sorted.slice(i, i + fileBatch);
      const rels = batch.map((f) => f.rel);
      const hi = Math.min(i + fileBatch, sorted.length);
      const label = `fichiers ${i + 1}–${hi}/${sorted.length}`;
      try {
        await runStreamChunk(localRoot, rels, label, { gzip: useGzip });
      } catch (e) {
        throw new Error(`Tranche ${label} a échoué : ${e?.message || e}`);
      }
    }
  } else if (chunkMode) {
    const entries = await fs.readdir(localRoot, { withFileTypes: true });
    const names = entries
      .filter((d) => d.isDirectory() && d.name !== "lost+found" && !d.name.startsWith("."))
      .map((d) => d.name)
      .sort();
    if (names.length === 0) {
      throw new Error("[RESTORE] --chunk : aucun sous-répertoire à envoyer");
    }
    for (const n of names) {
      try {
        await runStreamChunk(localRoot, [n], n, { gzip: useGzip });
      } catch (e) {
        throw new Error(`Tranche ${n} a échoué : ${e?.message || e}`);
      }
    }
  } else {
    await runStreamChunk(localRoot, ["."], "tout", { gzip: useGzip });
  }

  const r = RESTORE_REMOTE_ROOT;
  const findScript =
    "c=$(" +
    "find " +
    r +
    " -type f ! -path '*/lost+found/*' 2>/dev/null | head -1); " +
    "if [ -z \"$c\" ]; then echo NO_FILES; exit 1; fi; " +
    "echo OK_AT_LEAST_ONE; ls -R " +
    r +
    " | head -n 50";
  const ver = await new Promise((resolve) => {
    const p = execRailwaySshCmd(
      [
        "sh",
        "-c",
        findScript,
      ],
      ["ignore", "pipe", "pipe"]
    );
    let out = "";
    p.stdout?.on("data", (d) => {
      out += String(d);
    });
    p.stderr?.on("data", (d) => {
      out += String(d);
    });
    p.on("close", (code) => resolve({ code, out }));
  });
  if (ver.code !== 0) {
    console.error("[RESTORE] vérification : aucun fichier trouvé sous /app/storage (hors lost+found) ?");
    console.error(ver.out);
    process.exit(1);
  }
  console.log("[RESTORE] vérification /app/storage (ls -R | head -50) :\n" + ver.out);
}

main().then(
  () => {
    console.log("[RESTORE] terminé (tar appliqué sur /app/storage)");
    process.exit(0);
  },
  (e) => {
    console.error("[RESTORE] FATAL:", e?.message || e);
    process.exit(1);
  }
);
