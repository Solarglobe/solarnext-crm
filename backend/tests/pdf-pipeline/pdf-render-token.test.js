/**
 * CP-PDF-V2-019 — Tests renderToken pour pipeline PDF
 *
 * - buildRendererUrl inclut renderToken
 * - Route interne 200 avec token valide
 * - 401/403 si token invalide ou expiré
 * - generatePdfForVersion produit URL avec renderToken (hors mock)
 */

import "./setup.js";
import jwt from "jsonwebtoken";
import { createPdfRenderToken, verifyPdfRenderToken } from "../../services/pdfRenderToken.service.js";
import { buildRendererUrl, getRendererUrl } from "../../services/pdfGeneration.service.js";
import { getInternalPdfViewModel } from "../../controllers/internalPdfViewModel.controller.js";
import { getOrCreateOrg, createStudyWithSnapshot } from "./fixtures.js";
import { pool } from "../../config/db.js";

let passed = 0;
let failed = 0;

function pass(name) {
  passed++;
  console.log(`✔ ${name}`);
}

function fail(name, msg) {
  failed++;
  console.log(`✖ ${name} — ${msg}`);
}

function mockReq(studyId, versionId, query = {}) {
  return {
    params: { studyId, versionId },
    query,
  };
}

function mockRes() {
  const captured = { statusCode: null, body: null };
  const res = {
    status(code) {
      captured.statusCode = code;
      return this;
    },
    json(data) {
      captured.body = data;
      return this;
    },
  };
  return { res, captured };
}

export async function runRenderTokenTests() {
  const origJwt = process.env.JWT_SECRET;
  if (!origJwt) {
    process.env.JWT_SECRET = "test-secret-for-render-token";
  }

  try {
    // ——— buildRendererUrl inclut renderToken ———
    const urlWithToken = buildRendererUrl("s1", "v1", "my-token-123");
    if (urlWithToken.includes("renderToken=") && urlWithToken.includes("my-token-123")) {
      pass("buildRendererUrl inclut renderToken dans l'URL");
    } else {
      fail("buildRendererUrl", `URL sans renderToken: ${urlWithToken}`);
    }

    const urlWithoutToken = buildRendererUrl("s1", "v1");
    if (!urlWithoutToken.includes("renderToken=")) {
      pass("buildRendererUrl sans token ne contient pas renderToken");
    } else {
      fail("buildRendererUrl", `URL avec renderToken alors que non fourni: ${urlWithoutToken}`);
    }

    // ——— createPdfRenderToken + verifyPdfRenderToken ———
    const orgId = await getOrCreateOrg();
    const token = createPdfRenderToken("study-x", "version-y", orgId);
    if (token && typeof token === "string" && token.length > 10) {
      pass("createPdfRenderToken produit un token valide");
    } else {
      fail("createPdfRenderToken", `Token invalide: ${token}`);
    }

    const decoded = verifyPdfRenderToken(token, "study-x", "version-y");
    if (decoded.studyId === "study-x" && decoded.versionId === "version-y" && decoded.organizationId === orgId) {
      pass("verifyPdfRenderToken décode correctement");
    } else {
      fail("verifyPdfRenderToken", `Decoded: ${JSON.stringify(decoded)}`);
    }

    // ——— verifyPdfRenderToken refuse studyId/versionId incohérents ———
    try {
      verifyPdfRenderToken(token, "other-study", "version-y");
      fail("verifyPdfRenderToken", "Devrait refuser studyId différent");
    } catch (e) {
      if (e.code === "RENDER_TOKEN_INVALID") {
        pass("verifyPdfRenderToken refuse studyId incohérent");
      } else {
        fail("verifyPdfRenderToken", `Mauvaise erreur: ${e.code}`);
      }
    }

    // ——— verifyPdfRenderToken refuse token expiré ———
    const expiredToken = jwt.sign(
      { studyId: "s", versionId: "v", organizationId: orgId, usage: "pdf-render" },
      process.env.JWT_SECRET,
      { expiresIn: "-1s" }
    );
    try {
      verifyPdfRenderToken(expiredToken, "s", "v");
      fail("verifyPdfRenderToken", "Devrait refuser token expiré");
    } catch (e) {
      if (e.code === "RENDER_TOKEN_EXPIRED") {
        pass("verifyPdfRenderToken refuse token expiré");
      } else {
        fail("verifyPdfRenderToken", `Token expiré: ${e.code}`);
      }
    }

    // ——— Route interne 200 avec token valide ———
    const { studyId, versionId } = await createStudyWithSnapshot(orgId);
    const validToken = createPdfRenderToken(studyId, versionId, orgId);
    const { res, captured } = mockRes();
    const req = mockReq(studyId, versionId, { renderToken: validToken });
    req.params = { studyId, versionId };
    req.query = { renderToken: validToken };

    await getInternalPdfViewModel(req, res);

    if (captured.statusCode === 200 && captured.body?.ok === true && captured.body?.viewModel) {
      pass("Route interne 200 avec token valide, viewModel retourné");
    } else {
      fail("Route interne token valide", `status=${captured.statusCode} body=${JSON.stringify(captured.body)}`);
    }

    // ——— Route interne 403 sans token ———
    const { res: resNoToken, captured: capNoToken } = mockRes();
    const reqNoToken = mockReq(studyId, versionId, {});
    reqNoToken.params = { studyId, versionId };
    reqNoToken.query = {};
    await getInternalPdfViewModel(reqNoToken, resNoToken);

    if (capNoToken.statusCode === 403) {
      pass("Route interne 403 sans renderToken");
    } else {
      fail("Route interne sans token", `status=${capNoToken.statusCode}`);
    }

    // ——— Route interne 403 avec token invalide ———
    const { res: resBad, captured: capBad } = mockRes();
    const reqBad = mockReq(studyId, versionId, { renderToken: "invalid-token" });
    reqBad.params = { studyId, versionId };
    reqBad.query = { renderToken: "invalid-token" };
    await getInternalPdfViewModel(reqBad, resBad);

    if (capBad.statusCode === 403) {
      pass("Route interne 403 avec token invalide");
    } else {
      fail("Route interne token invalide", `status=${capBad.statusCode}`);
    }

    // Cleanup
    await pool.query("DELETE FROM study_versions WHERE study_id = $1", [studyId]);
    await pool.query("DELETE FROM studies WHERE id = $1", [studyId]);
  } catch (e) {
    fail("runRenderTokenTests", e.message);
  } finally {
    if (origJwt !== undefined) process.env.JWT_SECRET = origJwt;
    else delete process.env.JWT_SECRET;
  }

  return { passed, failed };
}
