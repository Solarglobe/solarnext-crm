/**
 * CORS — origines fixes prod + preflight OPTIONS (supertest).
 * cd backend && node --test tests/cors.http.test.mjs
 */
import assert from "node:assert/strict";
import { describe, test } from "node:test";
import request from "supertest";

await import("../config/load-env.js");
const { buildHttpApp } = await import("../httpApp.js");

const app = buildHttpApp();
/** Route publique GET sans JWT (réponse JSON stable). */
const PUBLIC_GET = "/api/system/shading-capabilities";

function assertCorsAllowlisted(res, expectedOrigin) {
  assert.equal(
    res.headers["access-control-allow-origin"],
    expectedOrigin,
    "Access-Control-Allow-Origin doit refléter l’origine autorisée"
  );
  assert.equal(res.headers["access-control-allow-credentials"], "true");
}

describe("CORS (solarnext-crm.fr + api.solarnext-crm.fr)", () => {
  for (const origin of ["https://solarnext-crm.fr", "https://api.solarnext-crm.fr"]) {
    test(`OPTIONS preflight — ${origin}`, async () => {
      const res = await request(app)
        .options(PUBLIC_GET)
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "GET")
        .set("Access-Control-Request-Headers", "content-type,authorization");
      assert.equal(res.status, 204);
      assertCorsAllowlisted(res, origin);
    });

    test(`OPTIONS preflight /auth/login — ${origin}`, async () => {
      const res = await request(app)
        .options("/auth/login")
        .set("Origin", origin)
        .set("Access-Control-Request-Method", "POST")
        .set("Access-Control-Request-Headers", "content-type,authorization");
      assert.equal(res.status, 204);
      assertCorsAllowlisted(res, origin);
    });

    test(`POST /auth/login avec Origin — ${origin} (en-têtes CORS même si 401)`, async () => {
      const res = await request(app)
        .post("/auth/login")
        .set("Origin", origin)
        .set("Content-Type", "application/json")
        .send(JSON.stringify({ email: "cors-check@example.invalid", password: "invalid" }));
      assert.ok(res.status >= 400, "identifiants invalides attendus");
      assertCorsAllowlisted(res, origin);
    });

    test(`GET avec Origin — ${origin}`, async () => {
      const res = await request(app).get(PUBLIC_GET).set("Origin", origin);
      assert.equal(res.status, 200);
      assertCorsAllowlisted(res, origin);
    });
  }

  test("Origin https://solarnext-crm.fr (casse hostname) — autorisée après normalisation", async () => {
    const origin = "https://Solarnext-crm.fr";
    const res = await request(app).get(PUBLIC_GET).set("Origin", origin);
    assert.equal(res.status, 200);
    assert.equal(res.headers["access-control-allow-origin"], origin);
    assert.equal(res.headers["access-control-allow-credentials"], "true");
  });

  test("OPTIONS : origine non autorisée → erreur CORS (pas d’ACA-O)", async () => {
    const res = await request(app)
      .options(PUBLIC_GET)
      .set("Origin", "https://evil-disallowed.example")
      .set("Access-Control-Request-Method", "GET");
    assert.ok(
      res.status >= 400 || !res.headers["access-control-allow-origin"],
      "ne doit pas exposer Access-Control-Allow-Origin pour une origine refusée"
    );
  });
});
