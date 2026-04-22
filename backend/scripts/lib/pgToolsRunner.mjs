/**
 * CP-073 — Exécution pg_dump / psql : hôte (PATH) ou fallback docker exec.
 */

import { execFileSync } from "child_process";

const IS_WIN = process.platform === "win32";

/**
 * @returns {boolean}
 */
export function isCommandOnPath(cmd) {
  try {
    execFileSync(IS_WIN ? "where" : "which", [cmd], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {boolean}
 */
export function isDockerAvailable() {
  try {
    execFileSync(IS_WIN ? "docker.exe" : "docker", ["info"], { stdio: "ignore", timeout: 15000 });
    return true;
  } catch {
    return false;
  }
}

/**
 * @returns {string | null}
 */
export function detectPostgresContainerName() {
  const forced = String(process.env.BACKUP_DOCKER_CONTAINER || "").trim();
  if (forced) return forced;
  try {
    const out = execFileSync(IS_WIN ? "docker.exe" : "docker", ["ps", "--format", "{{.Names}}"], {
      encoding: "utf8",
      timeout: 15000,
    });
    const names = out
      .split(/\r?\n/)
      .map((s) => s.trim())
      .filter(Boolean);
    const exact = names.find((n) => n === "solarglobe_db");
    if (exact) return exact;
    const preferred =
      names.find((n) => /solarglobe|solarnext/i.test(n)) ||
      names.find((n) => /postgres/i.test(n)) ||
      names.find((n) => /db/i.test(n)) ||
      null;
    return preferred || names[0] || null;
  } catch {
    return null;
  }
}

/**
 * @returns {"host" | "docker"}
 */
export function resolveBackupExecutionMode() {
  if (String(process.env.BACKUP_USE_DOCKER || "").trim() === "1") {
    return "docker";
  }
  if (String(process.env.BACKUP_USE_DOCKER || "").trim() === "0") {
    return "host";
  }
  if (isCommandOnPath("pg_dump")) {
    return "host";
  }
  if (isDockerAvailable()) {
    const c = detectPostgresContainerName();
    if (c) {
      console.warn(
        "[pg-tools] pg_dump absent du PATH — utilisation du fallback Docker (conteneur : " + c + ")."
      );
      return "docker";
    }
  }
  return "host";
}

export function resolveRestoreExecutionMode() {
  if (String(process.env.BACKUP_USE_DOCKER || "").trim() === "1") {
    return "docker";
  }
  if (String(process.env.BACKUP_USE_DOCKER || "").trim() === "0") {
    return "host";
  }
  if (isCommandOnPath("psql")) {
    return "host";
  }
  if (isDockerAvailable()) {
    const c = detectPostgresContainerName();
    if (c) {
      console.warn(
        "[pg-tools] psql absent du PATH — utilisation du fallback Docker (conteneur : " + c + ")."
      );
      return "docker";
    }
  }
  return "host";
}

/**
 * pg_dump dans le conteneur : connexion TCP sur 127.0.0.1 (postgres écoute dans le conteneur).
 * @param {Record<string, string>} pgEnv
 * @param {string} container
 * @returns {string[]}
 */
export function dockerPgDumpArgs(pgEnv, container) {
  return [
    "exec",
    "-e",
    `PGPASSWORD=${pgEnv.PGPASSWORD}`,
    container,
    "pg_dump",
    "--format=plain",
    "--clean",
    "--if-exists",
    "--no-owner",
    "--no-acl",
    "-h",
    "127.0.0.1",
    "-p",
    "5432",
    "-U",
    pgEnv.PGUSER,
    "-d",
    pgEnv.PGDATABASE,
  ];
}

/**
 * @param {Record<string, string>} pgEnv
 * @param {string} container
 */
export function dockerPsqlArgs(pgEnv, container) {
  return [
    "exec",
    "-i",
    "-e",
    `PGPASSWORD=${pgEnv.PGPASSWORD}`,
    container,
    "psql",
    "-h",
    "127.0.0.1",
    "-p",
    "5432",
    "-U",
    pgEnv.PGUSER,
    "-d",
    pgEnv.PGDATABASE,
    "-v",
    "ON_ERROR_STOP=1",
    "-f",
    "-",
  ];
}

/**
 * @returns {string}
 */
export function dockerBinary() {
  return IS_WIN ? "docker.exe" : "docker";
}
