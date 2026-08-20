import test from "node:test";
import assert from "node:assert/strict";
import net from "node:net";
import { Readable } from "node:stream";

import {
  MAIL_ATTACHMENT_SCAN_STATUSES,
  checkMailAttachmentScannerHealth,
  getMailAttachmentScanConfig,
  scanMailAttachmentBuffer,
  scanMailAttachmentStream,
} from "../services/mail/mailAttachmentScan.service.js";

function withEnv(values, fn) {
  const prev = {};
  for (const [k, v] of Object.entries(values)) {
    prev[k] = process.env[k];
    if (v == null) delete process.env[k];
    else process.env[k] = String(v);
  }
  return Promise.resolve()
    .then(fn)
    .finally(() => {
      for (const [k, v] of Object.entries(prev)) {
        if (v == null) delete process.env[k];
        else process.env[k] = v;
      }
    });
}

async function withFakeClamd(handler, fn) {
  const server = net.createServer((socket) => {
    const chunks = [];
    socket.on("data", (chunk) => {
      chunks.push(chunk);
      const buf = Buffer.concat(chunks);
      if (buf.length >= 4 && buf.subarray(buf.length - 4).equals(Buffer.alloc(4))) {
        handler(socket, buf);
      }
    });
    socket.on("close", () => {
      if (!socket.destroyed) socket.destroy();
    });
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    const { port } = server.address();
    return await withEnv({
      MAIL_ATTACHMENT_SCANNER: "clamav",
      MAIL_ATTACHMENT_SCAN_MODE: "required",
      MAIL_CLAMAV_HOST: "127.0.0.1",
      MAIL_CLAMAV_PORT: port,
      MAIL_ATTACHMENT_SCAN_TIMEOUT_MS: "500",
      MAIL_ATTACHMENT_SCAN_RETRIES: "0",
    }, fn);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}

test("7B clamd stream returns CLEAN on OK", async () => {
  await withFakeClamd((socket) => socket.end("stream: OK\0"), async () => {
    const res = await scanMailAttachmentStream({
      stream: Readable.from(Buffer.from("hello")),
      sizeBytes: 5,
      filename: "clean.txt",
      mimeType: "text/plain",
    });
    assert.equal(res.status, MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN);
    assert.equal(res.provider, "clamav");
  });
});

test("7B clamd stream returns INFECTED on FOUND", async () => {
  await withFakeClamd((socket) => socket.end("stream: Eicar-Test-Signature FOUND\0"), async () => {
    const res = await scanMailAttachmentStream({
      stream: Readable.from(Buffer.from("virus-test-fixture")),
      sizeBytes: 18,
      filename: "sample.txt",
      mimeType: "text/plain",
    });
    assert.equal(res.status, MAIL_ATTACHMENT_SCAN_STATUSES.INFECTED);
    assert.equal(res.errorCode, "CLAMD_FOUND");
  });
});

test("7B clamd invalid response and unavailable never become CLEAN in required mode", async () => {
  await withFakeClamd((socket) => socket.end("nonsense\0"), async () => {
    const res = await scanMailAttachmentStream({
      stream: Readable.from(Buffer.from("hello")),
      sizeBytes: 5,
      filename: "clean.txt",
      mimeType: "text/plain",
    });
    assert.equal(res.status, MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE);
    assert.equal(res.errorCode, "CLAMD_PROTOCOL_ERROR");
  });

  await withEnv({
    MAIL_ATTACHMENT_SCANNER: "clamav",
    MAIL_ATTACHMENT_SCAN_MODE: "required",
    MAIL_CLAMAV_PORT: "9",
    MAIL_ATTACHMENT_SCAN_TIMEOUT_MS: "500",
    MAIL_ATTACHMENT_SCAN_RETRIES: "0",
  }, async () => {
    const res = await scanMailAttachmentBuffer({
      buffer: Buffer.from("hello"),
      filename: "clean.txt",
      mimeType: "text/plain",
    });
    assert.notEqual(res.status, MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN);
  });
});

test("7B timeout, retry config and development deterministic mode are explicit", async () => {
  const sockets = new Set();
  const server = net.createServer((socket) => {
    sockets.add(socket);
    socket.on("close", () => sockets.delete(socket));
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  try {
    await withEnv({
      MAIL_ATTACHMENT_SCANNER: "clamav",
      MAIL_ATTACHMENT_SCAN_MODE: "required",
      MAIL_CLAMAV_HOST: "127.0.0.1",
      MAIL_CLAMAV_PORT: server.address().port,
      MAIL_ATTACHMENT_SCAN_TIMEOUT_MS: "50",
      MAIL_ATTACHMENT_SCAN_RETRIES: "1",
    }, async () => {
      const res = await scanMailAttachmentStream({
        stream: Readable.from(Buffer.from("hello")),
        sizeBytes: 5,
        filename: "clean.txt",
        mimeType: "text/plain",
      });
      assert.equal(res.errorCode, "SCAN_TIMEOUT");
      assert.equal(res.status, MAIL_ATTACHMENT_SCAN_STATUSES.UNAVAILABLE);
    });
  } finally {
    for (const socket of sockets) socket.destroy();
    await new Promise((resolve) => server.close(resolve));
  }

  await withEnv({ MAIL_ATTACHMENT_SCANNER: "deterministic", MAIL_ATTACHMENT_SCAN_MODE: "best_effort" }, async () => {
    assert.equal(getMailAttachmentScanConfig().scanner, "deterministic");
    const clean = await scanMailAttachmentBuffer({ buffer: Buffer.from("ok"), filename: "ok.txt", mimeType: "text/plain" });
    const infected = await scanMailAttachmentBuffer({ buffer: Buffer.from("fixture"), filename: "eicar.txt", mimeType: "text/plain" });
    assert.equal(clean.status, MAIL_ATTACHMENT_SCAN_STATUSES.CLEAN);
    assert.equal(infected.status, MAIL_ATTACHMENT_SCAN_STATUSES.INFECTED);
  });
});

test("7B scanner health reports degraded required scanner instead of pretending clean", async () => {
  await withEnv({
    MAIL_ATTACHMENT_SCANNER: "clamav",
    MAIL_ATTACHMENT_SCAN_MODE: "required",
    MAIL_CLAMAV_PORT: "9",
    MAIL_ATTACHMENT_SCAN_TIMEOUT_MS: "200",
    MAIL_ATTACHMENT_SCAN_RETRIES: "0",
  }, async () => {
    const health = await checkMailAttachmentScannerHealth();
    assert.equal(health.ok, false);
    assert.equal(health.mode, "required");
  });
});

test("7B worker source uses SKIP LOCKED, retries, reaper and CLEAN gate", async () => {
  const fs = await import("node:fs");
  const worker = fs.readFileSync(new URL("../services/mail/mailAttachmentScanWorker.service.js", import.meta.url), "utf8");
  const outbox = fs.readFileSync(new URL("../services/mail/mailOutbox.processor.js", import.meta.url), "utf8");
  const drafts = fs.readFileSync(new URL("../services/mail/mailDraftAttachments.service.js", import.meta.url), "utf8");
  assert.match(worker, /FOR UPDATE SKIP LOCKED/);
  assert.match(worker, /scan_attempt_count/);
  assert.match(worker, /reapStuckAttachmentScans/);
  assert.match(worker, /MAIL_ATTACHMENT_SCAN_CONCURRENCY/);
  assert.match(outbox, /scan_status = 'CLEAN'/);
  assert.match(drafts, /scan_status = 'CLEAN'/);
});
