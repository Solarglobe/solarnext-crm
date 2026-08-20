import { createHash } from "crypto";
import { createReadStream } from "fs";
import net from "net";

export const MAIL_ATTACHMENT_SCAN_STATUSES = Object.freeze({
  PENDING: "PENDING",
  SCANNING: "SCANNING",
  CLEAN: "CLEAN",
  INFECTED: "INFECTED",
  FAILED: "FAILED",
  UNAVAILABLE: "UNAVAILABLE",
});

const DANGEROUS_EXTENSIONS = new Set([
  ".ade", ".adp", ".apk", ".app", ".bat", ".cmd", ".com", ".cpl", ".dll", ".dmg", ".exe", ".hta",
  ".ins", ".iso", ".jar", ".js", ".jse", ".lnk", ".msi", ".msp", ".ps1", ".scr", ".sh", ".svg",
  ".vbe", ".vbs", ".wsf", ".xll",
]);

const FORCE_DOWNLOAD_MIME = new Set(["text/html", "application/xhtml+xml", "image/svg+xml"]);
const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;
const DEFAULT_TIMEOUT_MS = 15000;
const DEFAULT_RETRIES = 2;

const metrics = {
  clean: 0,
  infected: 0,
  unavailable: 0,
  failed: 0,
  protocolErrors: 0,
  timeouts: 0,
  interrupted: 0,
};

export function getMailAttachmentScanConfig() {
  const rawScanMode = String(process.env.MAIL_ATTACHMENT_SCAN_MODE || "").trim().toLowerCase();
  const scanMode = rawScanMode || (process.env.NODE_ENV === "production" ? "required" : "best_effort");
  return {
    scanMode: ["required", "best_effort", "disabled"].includes(scanMode) ? scanMode : "required",
    scanner: String(process.env.MAIL_ATTACHMENT_SCANNER || process.env.MAIL_ATTACHMENT_SCAN_PROVIDER || "").trim().toLowerCase(),
    clamHost: String(process.env.MAIL_CLAMAV_HOST || process.env.CLAMD_HOST || "127.0.0.1").trim(),
    clamPort: Math.min(Math.max(Number(process.env.MAIL_CLAMAV_PORT || process.env.CLAMD_PORT || 3310), 1), 65535),
    clamSocket: String(process.env.MAIL_CLAMAV_SOCKET || process.env.CLAMD_SOCKET || "").trim(),
    timeoutMs: Math.min(Math.max(Number(process.env.MAIL_ATTACHMENT_SCAN_TIMEOUT_MS || DEFAULT_TIMEOUT_MS), 500), 120000),
    maxBytes: Math.min(Math.max(Number(process.env.MAIL_ATTACHMENT_SCAN_MAX_BYTES || DEFAULT_MAX_BYTES), 1), 512 * 1024 * 1024),
    retries: Math.min(Math.max(Number(process.env.MAIL_ATTACHMENT_SCAN_RETRIES ?? DEFAULT_RETRIES), 0), 5),
    chunkBytes: Math.min(Math.max(Number(process.env.MAIL_ATTACHMENT_SCAN_CHUNK_BYTES || 64 * 1024), 1024), 1024 * 1024),
  };
}

export function getMailAttachmentScanMetrics() {
  return { ...metrics };
}

function extOf(filename) {
  const m = String(filename || "").toLowerCase().match(/(\.[a-z0-9]{1,12})$/);
  return m ? m[1] : "";
}

export function classifyAttachmentRisk({ filename, mimeType, sizeBytes }) {
  const name = String(filename || "");
  const lower = name.toLowerCase();
  const ext = extOf(name);
  const parts = lower.split(".").filter(Boolean);
  const hasDoubleDangerousExtension = parts.length >= 3 && parts.slice(0, -1).some((p) => DANGEROUS_EXTENSIONS.has(`.${p}`));
  const mime = String(mimeType || "application/octet-stream").toLowerCase().split(";")[0].trim();
  if (DANGEROUS_EXTENSIONS.has(ext) || hasDoubleDangerousExtension) {
    return { action: "blocked", reason: "dangerous_type" };
  }
  if (Number(sizeBytes) > getMailAttachmentScanConfig().maxBytes) {
    return { action: "blocked", reason: "too_large_for_scan" };
  }
  if (FORCE_DOWNLOAD_MIME.has(mime)) {
    return { action: "scan_required", reason: "active_content_download_only" };
  }
  return { action: "scan_required", reason: "standard" };
}

function bumpForStatus(status, code = null) {
  if (status === MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN) metrics.clean += 1;
  else if (status === MAIL_ATTACHMENT_SCAN_STATUSES.INFECTED) metrics.infected += 1;
  else if (status === MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE) metrics.unavailable += 1;
  else metrics.failed += 1;
  if (code === "SCAN_TIMEOUT") metrics.timeouts += 1;
  if (code === "CLAMD_PROTOCOL_ERROR") metrics.protocolErrors += 1;
  if (code === "SCAN_INTERRUPTED") metrics.interrupted += 1;
}

function scanResult({ status, provider, errorCode = null, quarantineReason = null, signature = null, durationMs = null }) {
  bumpForStatus(status, errorCode);
  return { status, provider, errorCode, quarantineReason, signature, durationMs };
}

function parseClamdResponse(raw) {
  const text = String(raw || "").replace(/\0+$/g, "").trim();
  if (!text) {
    const err = new Error("Réponse ClamAV vide");
    err.code = "CLAMD_PROTOCOL_ERROR";
    throw err;
  }
  if (/\sOK$/i.test(text) || text === "OK") {
    return { infected: false, signature: null };
  }
  const m = text.match(/:\s*(.+?)\s+FOUND$/i) || text.match(/^(.+?)\s+FOUND$/i);
  if (m) return { infected: true, signature: m[1] };
  const err = new Error(`Réponse ClamAV invalide: ${text.slice(0, 200)}`);
  err.code = "CLAMD_PROTOCOL_ERROR";
  throw err;
}

function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function withRetry(fn, retries) {
  let last;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fn(attempt);
    } catch (e) {
      last = e;
      if (attempt >= retries) break;
      await wait(Math.min(250 * 2 ** attempt, 2000));
    }
  }
  throw last;
}

async function openClamdSocket(config) {
  return new Promise((resolve, reject) => {
    const socket = config.clamSocket
      ? net.createConnection({ path: config.clamSocket })
      : net.createConnection({ host: config.clamHost, port: config.clamPort });
    const timer = setTimeout(() => {
      const err = new Error("Timeout connexion ClamAV");
      err.code = "SCAN_TIMEOUT";
      socket.destroy(err);
      reject(err);
    }, config.timeoutMs);
    socket.once("connect", () => {
      clearTimeout(timer);
      resolve(socket);
    });
    socket.once("error", (err) => {
      clearTimeout(timer);
      if (!err.code) err.code = "SCANNER_UNAVAILABLE";
      reject(err);
    });
  });
}

async function scanReadableWithClamd(readable, { sizeBytes = 0, config = getMailAttachmentScanConfig() } = {}) {
  if (Number(sizeBytes) > config.maxBytes) {
    const err = new Error("Fichier trop volumineux pour le scan antivirus");
    err.code = "MAIL_ATTACHMENT_SCAN_TOO_LARGE";
    throw err;
  }
  const started = Date.now();
  const socket = await openClamdSocket(config);
  let response = "";
  let scanned = 0;
  let done = false;

  return await new Promise((resolve, reject) => {
    const finish = (err, value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      readable.destroy?.();
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };

    const timer = setTimeout(() => {
      const err = new Error("Timeout scan ClamAV");
      err.code = "SCAN_TIMEOUT";
      finish(err);
    }, config.timeoutMs);

    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.on("error", (err) => {
      if (!err.code) err.code = "SCAN_INTERRUPTED";
      finish(err);
    });
    socket.on("close", () => {
      if (!done && !response) {
        const err = new Error("Connexion ClamAV interrompue");
        err.code = "SCAN_INTERRUPTED";
        finish(err);
      }
    });
    socket.on("end", () => {
      try {
        const parsed = parseClamdResponse(response);
        finish(null, {
          status: parsed.infected ? MAIL_ATTACHMENT_SCAN_STATUSES.INFECTED : MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN,
          provider: "clamav",
          errorCode: parsed.infected ? "CLAMD_FOUND" : null,
          quarantineReason: parsed.infected ? "clamav_found" : null,
          signature: parsed.signature,
          durationMs: Date.now() - started,
        });
      } catch (e) {
        finish(e);
      }
    });

    socket.write("zINSTREAM\0");
    readable.on("data", (chunk) => {
      scanned += chunk.length;
      if (scanned > config.maxBytes) {
        const err = new Error("Fichier trop volumineux pour le scan antivirus");
        err.code = "MAIL_ATTACHMENT_SCAN_TOO_LARGE";
        finish(err);
        return;
      }
      const len = Buffer.alloc(4);
      len.writeUInt32BE(chunk.length);
      socket.write(len);
      socket.write(chunk);
    });
    readable.on("error", (err) => {
      err.code ||= "SCAN_READ_ERROR";
      finish(err);
    });
    readable.on("end", () => {
      socket.write(Buffer.alloc(4));
    });
  });
}

export async function scanMailAttachmentStream({ stream, sizeBytes, filename, mimeType, config = getMailAttachmentScanConfig() }) {
  const risk = classifyAttachmentRisk({ filename, mimeType, sizeBytes: sizeBytes ?? 0 });
  if (risk.action === "blocked") {
    return scanResult({
      status: MAIL_ATTACHMENT_SCAN_STATUSES.INFECTED,
      provider: "policy",
      errorCode: risk.reason,
      quarantineReason: risk.reason,
    });
  }

  if (config.scanMode === "disabled") {
    return scanResult({
      status: process.env.NODE_ENV === "production"
        ? MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE
        : MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN,
      provider: "disabled",
      errorCode: process.env.NODE_ENV === "production" ? "SCAN_DISABLED_IN_PRODUCTION" : null,
      quarantineReason: process.env.NODE_ENV === "production" ? "scanner_required" : null,
    });
  }

  if (config.scanner === "clamav" || config.scanner === "clamd") {
    try {
      const res = await scanReadableWithClamd(stream, { sizeBytes, config });
      return scanResult(res);
    } catch (e) {
      const code = e?.code === "SCAN_TIMEOUT"
        ? "SCAN_TIMEOUT"
        : e?.code === "CLAMD_PROTOCOL_ERROR"
          ? "CLAMD_PROTOCOL_ERROR"
          : e?.code === "MAIL_ATTACHMENT_SCAN_TOO_LARGE"
            ? "MAIL_ATTACHMENT_SCAN_TOO_LARGE"
            : e?.code === "SCAN_INTERRUPTED"
              ? "SCAN_INTERRUPTED"
              : "SCANNER_UNAVAILABLE";
      return scanResult({
        status: code === "MAIL_ATTACHMENT_SCAN_TOO_LARGE" ? MAIL_ATTACHMENT_SCAN_STATUSES.FAILED : MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE,
        provider: "clamav",
        errorCode: code,
        quarantineReason: config.scanMode === "required" ? "scanner_required" : "scanner_unavailable",
      });
    }
  }

  return scanResult({
    status: MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE,
    provider: config.scanner || "none",
    errorCode: "SCANNER_UNAVAILABLE",
    quarantineReason: config.scanMode === "required" ? "scanner_required" : null,
  });
}

export async function scanMailAttachmentFile({ path, sizeBytes, filename, mimeType, config = getMailAttachmentScanConfig() }) {
  if (config.scanner === "clamav" || config.scanner === "clamd") {
    try {
      const res = await withRetry(
        () => scanReadableWithClamd(createReadStream(path, { highWaterMark: config.chunkBytes }), { sizeBytes, config }),
        config.retries
      );
      return scanResult(res);
    } catch (e) {
      const code = e?.code === "SCAN_TIMEOUT"
        ? "SCAN_TIMEOUT"
        : e?.code === "CLAMD_PROTOCOL_ERROR"
          ? "CLAMD_PROTOCOL_ERROR"
          : e?.code === "MAIL_ATTACHMENT_SCAN_TOO_LARGE"
            ? "MAIL_ATTACHMENT_SCAN_TOO_LARGE"
            : e?.code === "SCAN_INTERRUPTED"
              ? "SCAN_INTERRUPTED"
              : "SCANNER_UNAVAILABLE";
      return scanResult({
        status: code === "MAIL_ATTACHMENT_SCAN_TOO_LARGE" ? MAIL_ATTACHMENT_SCAN_STATUSES.FAILED : MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE,
        provider: "clamav",
        errorCode: code,
        quarantineReason: config.scanMode === "required" ? "scanner_required" : "scanner_unavailable",
      });
    }
  }
  return scanMailAttachmentStream({ stream: createReadStream(path, { highWaterMark: config.chunkBytes }), sizeBytes, filename, mimeType, config });
}

export async function scanMailAttachmentBuffer({ buffer, filename, mimeType }) {
  const config = getMailAttachmentScanConfig();
  const risk = classifyAttachmentRisk({ filename, mimeType, sizeBytes: buffer?.length ?? 0 });
  if (risk.action === "blocked") {
    return scanResult({
      status: MAIL_ATTACHMENT_SCAN_STATUSES.INFECTED,
      provider: "policy",
      errorCode: risk.reason,
      quarantineReason: risk.reason,
    });
  }

  const digest = createHash("sha256").update(buffer || Buffer.alloc(0)).digest("hex");

  if (config.scanner === "deterministic") {
    const infected = String(filename || "").toLowerCase().includes("eicar") || digest.startsWith("0000");
    return scanResult({
      status: infected ? MAIL_ATTACHMENT_SCAN_STATUSES.INFECTED : MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN,
      provider: "deterministic",
      errorCode: infected ? "DETERMINISTIC_MATCH" : null,
      quarantineReason: infected ? "deterministic_match" : null,
    });
  }

  if (config.scanner === "clamav" || config.scanner === "clamd") {
    const { Readable } = await import("stream");
    if (config.retries > 0) {
      try {
        const res = await withRetry(
          () => scanReadableWithClamd(Readable.from(buffer || Buffer.alloc(0)), { sizeBytes: buffer?.length ?? 0, config }),
          config.retries
        );
        return scanResult(res);
      } catch (e) {
        const code = e?.code === "SCAN_TIMEOUT"
          ? "SCAN_TIMEOUT"
          : e?.code === "CLAMD_PROTOCOL_ERROR"
            ? "CLAMD_PROTOCOL_ERROR"
            : e?.code === "MAIL_ATTACHMENT_SCAN_TOO_LARGE"
              ? "MAIL_ATTACHMENT_SCAN_TOO_LARGE"
              : e?.code === "SCAN_INTERRUPTED"
                ? "SCAN_INTERRUPTED"
                : "SCANNER_UNAVAILABLE";
        return scanResult({
          status: code === "MAIL_ATTACHMENT_SCAN_TOO_LARGE" ? MAIL_ATTACHMENT_SCAN_STATUSES.FAILED : MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE,
          provider: "clamav",
          errorCode: code,
          quarantineReason: config.scanMode === "required" ? "scanner_required" : "scanner_unavailable",
        });
      }
    }
    return scanMailAttachmentStream({ stream: Readable.from(buffer || Buffer.alloc(0)), sizeBytes: buffer?.length ?? 0, filename, mimeType, config });
  }

  return scanResult({
    status: MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE,
    provider: config.scanner || "none",
    errorCode: "SCANNER_UNAVAILABLE",
    quarantineReason: config.scanMode === "required" ? "scanner_required" : null,
  });
}

export async function checkMailAttachmentScannerHealth() {
  const config = getMailAttachmentScanConfig();
  if (config.scanMode === "disabled") {
    return { ok: process.env.NODE_ENV !== "production", mode: config.scanMode, provider: "disabled" };
  }
  if (config.scanner === "deterministic") {
    return { ok: true, mode: config.scanMode, provider: "deterministic" };
  }
  if (config.scanner !== "clamav" && config.scanner !== "clamd") {
    return { ok: config.scanMode !== "required", mode: config.scanMode, provider: config.scanner || "none", errorCode: "SCANNER_UNAVAILABLE" };
  }
  const res = await scanMailAttachmentBuffer({
    buffer: Buffer.from("Solarnext scanner health\n"),
    filename: "health.txt",
    mimeType: "text/plain",
  });
  return {
    ok: res.status === MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN,
    mode: config.scanMode,
    provider: res.provider,
    status: res.status,
    errorCode: res.errorCode,
    durationMs: res.durationMs,
  };
}

export function assertAttachmentClean(scan) {
  if (scan?.status === MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN) return;
  const err = new Error("Piece jointe non validee par le scan de securite");
  err.code = scan?.status === MAIL_ATTACHMENT_SCAN_STATUSES.INFECTED ? "MAIL_ATTACHMENT_INFECTED" : "MAIL_ATTACHMENT_SCAN_REQUIRED";
  err.scan = scan;
  throw err;
}
