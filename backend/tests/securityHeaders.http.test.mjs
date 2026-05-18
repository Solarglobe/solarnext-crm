import assert from "node:assert/strict";
import { afterEach, describe, test } from "node:test";
import request from "supertest";

if (!process.env.NODE_ENV) process.env.NODE_ENV = "test";

await import("../config/load-env.js");
const { buildHttpApp } = await import("../httpApp.js");

const app = buildHttpApp();
const originalNodeEnv = process.env.NODE_ENV;
const originalCspMode = process.env.SECURITY_CSP_MODE;

afterEach(() => {
  if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
  else process.env.NODE_ENV = originalNodeEnv;
  if (originalCspMode === undefined) delete process.env.SECURITY_CSP_MODE;
  else process.env.SECURITY_CSP_MODE = originalCspMode;
});

describe("Security headers", () => {
  test("sets CSP in report-only mode by default", async () => {
    delete process.env.SECURITY_CSP_MODE;
    const res = await request(app).get("/api/health/live");
    const csp = res.headers["content-security-policy-report-only"];

    assert.equal(res.status, 200);
    assert.ok(csp?.includes("default-src 'self'"));
    assert.ok(csp?.includes("script-src 'self' 'wasm-unsafe-eval' https://js.stripe.com"));
    assert.ok(csp?.includes("connect-src 'self'"));
    assert.ok(csp?.includes("https://re.jrc.ec.europa.eu"));
    assert.ok(csp?.includes("object-src 'none'"));
    assert.equal(res.headers["content-security-policy"], undefined);
  });

  test("can enforce CSP via SECURITY_CSP_MODE=enforce", async () => {
    process.env.SECURITY_CSP_MODE = "enforce";
    const res = await request(app).get("/api/health/live");

    assert.equal(res.status, 200);
    assert.ok(res.headers["content-security-policy"]?.includes("default-src 'self'"));
    assert.equal(res.headers["content-security-policy-report-only"], undefined);
  });

  test("sets Permissions-Policy with GPS allowed for self", async () => {
    const res = await request(app).get("/api/health/live");
    assert.equal(
      res.headers["permissions-policy"],
      "camera=(), microphone=(), geolocation=(self), payment=(self)"
    );
  });

  test("sets HSTS only for production HTTPS requests", async () => {
    process.env.NODE_ENV = "production";

    const httpsRes = await request(app).get("/api/health/live").set("X-Forwarded-Proto", "https");
    assert.equal(
      httpsRes.headers["strict-transport-security"],
      "max-age=31536000; includeSubDomains; preload"
    );

    const httpRes = await request(app).get("/api/health/live").set("X-Forwarded-Proto", "http");
    assert.equal(httpRes.headers["strict-transport-security"], undefined);
  });
});
