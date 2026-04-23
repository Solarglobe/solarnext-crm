#!/usr/bin/env node
/**
 * Copie un dossier local (même arborescence que les storage_key) vers /app/storage sur Railway.
 * Méthode : `tar -cf -` (local) | `railway ssh` | `sh -c 'cat | tar -xf - -C /app/storage'` (évite GNU tar « Refusing to read from terminal »).
 *
 * Prérequis : `railway link` dans le dépôt, CLI installé (`npm i -g @railway/cli`), Node.
 * Windows : utilisation de `node $(npm root -g)/@railway/cli/bin/railway.js` (évite EINVAL sur railway.cmd).
 *
 * Usage :
 *   node backend/scripts/railway-restore-storage.mjs [chemin_dossier_local]
 *   RESTORE_QUIET=1 node ...   ou   --quiet   → n’affiche pas chaque fichier (seulement le compte)
 *
 * Défaut chemin source : backend/storage (racine dépôt).
 */

import { execFile, execSync, spawn } from "child_process";
import fs from "fs/promises";
import { existsSync } from "fs";
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

/** Exécute une commande distante (sans sh -c — évite les soucis d’échappement côté CLI). */
function execRailwaySshCmd(remoteArgs, stdio) {
  const { cmd, argsPrefix } = RAILWAY;
  return execFile(cmd, [...argsPrefix, "ssh", ...remoteArgs], { stdio });
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const REPO_ROOT = path.resolve(__dirname, "..", "..");
const DEFAULT_BACKUP = path.join(REPO_ROOT, "backend", "storage");

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

async function main() {
  const localRoot = path.resolve(process.argv[2] || process.env.BACKUP_DIR || DEFAULT_BACKUP);
  const st = await fs.stat(localRoot).catch(() => null);
  if (!st || !st.isDirectory()) {
    console.error("Dossier introuvable:", localRoot);
    process.exit(1);
  }

  const files = [];
  for await (const f of walkFiles(localRoot)) {
    const rel = path.relative(localRoot, f).split(path.sep).join("/");
    if (rel.startsWith("..") || rel.includes("..")) continue;
    files.push({ abs: f, rel });
  }

  const quiet = process.env.RESTORE_QUIET === "1" || process.argv.includes("--quiet");
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
  console.log(`[RESTORE] total fichiers : ${files.length} — stream tar → railway ssh …`);

  await new Promise((res, rej) => {
    const c = execRailwaySshCmd(["mkdir", "-p", "/app/storage"], ["ignore", "ignore", "pipe"]);
    let e = "";
    c.stderr?.on("data", (d) => {
      e += String(d);
    });
    c.on("close", (code) => (code === 0 ? res() : rej(new Error(`mkdir -p: ${code} ${e}`.trim()))));
    c.on("error", rej);
  });

  await new Promise((resolve, reject) => {
    const tar = spawn("tar", ["-cf", "-", "."], {
      cwd: localRoot,
      stdio: ["ignore", "pipe", "inherit"],
    });
    // GNU tar refuserait stdin=TTY : cat alimente tar depuis le flux SSH.
    const ssh = execRailwaySshCmd(
      ["sh", "-c", "cat | tar -xf - -C /app/storage"],
      ["pipe", "pipe", "pipe"]
    );
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
        reject(new Error(`tar exit ${code}`));
      }
    });
    ssh.on("close", (code) => {
      if (code !== 0) {
        reject(new Error(`railway ssh exit ${code} ${err || ""}`.trim()));
        return;
      }
      resolve();
    });
  });

  const ver = await new Promise((resolve) => {
    const p = execRailwaySshCmd(
      [
        "sh",
        "-c",
        "set -e; c=$(find /app/storage -type f ! -path '*/lost+found/*' 2>/dev/null | head -1); " +
          "if [ -z \"$c\" ]; then echo 'NO_FILES'; exit 1; fi; echo OK_AT_LEAST_ONE; ls -R /app/storage | head -n 50",
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
