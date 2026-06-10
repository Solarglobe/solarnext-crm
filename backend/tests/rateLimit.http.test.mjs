import assert from "node:assert/strict";
import { beforeEach, describe, test } from "node:test";
import request from "supertest";

if (!process.env.NODE_ENV) process.env.NODE_ENV = "test";
process.env.RATE_LIMIT_STORE = "memory";

await import("../config/load-env.js");
const { __resetRateLimitStoreForTests } = await import("../middleware/security/rateLimitStore.factory.js");
const { buildHttpApp } = await import("../httpApp.js");

describe("Rate limiting", () => {
  let app;

  beforeEach(() => {
    __resetRateLimitStoreForTests();
    app = buildHttpApp();
  });

  test("auth login is not API rate limited", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .post("/api/auth/login")
        .set("X-Forwarded-For", "203.0.113.10")
        .send({});
      assert.equal(res.status, 400);
    }
  });

  test("anonymous API requests are limited to 20/min/IP", async () => {
    for (let i = 0; i < 20; i++) {
      const res = await request(app)
        .get("/api/system/shading-capabilities")
        .set("X-Forwarded-For", "203.0.113.20");
      assert.notEqual(res.status, 429);
    }

    const blocked = await request(app)
      .get("/api/system/shading-capabilities")
      .set("X-Forwarded-For", "203.0.113.20");

    assert.equal(blocked.status, 429);
    assert.equal(blocked.body.error, "RATE_LIMITED");
  });

  test("health and metrics endpoints are not API rate limited", async () => {
    for (let i = 0; i < 25; i++) {
      const res = await request(app)
        .get("/api/health/live")
        .set("X-Forwarded-For", "203.0.113.30");
      assert.equal(res.status, 200);
    }
  });
});
