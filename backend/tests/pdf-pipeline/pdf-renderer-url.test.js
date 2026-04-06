/**
 * PDF V2 — Tests unitaires buildRendererUrl / getRendererUrl
 * Vérifie que l'URL du renderer utilise studyId + versionId (plus de scenario legacy).
 */
import { buildRendererUrl, getRendererUrl } from "../../services/pdfGeneration.service.js";

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

export function runUrlTests() {
  passed = 0;
  failed = 0;
  const origTestUrl = process.env.PDF_RENDERER_TEST_URL;

  try {
    const restore = () => {
      if (origTestUrl !== undefined) process.env.PDF_RENDERER_TEST_URL = origTestUrl;
      else delete process.env.PDF_RENDERER_TEST_URL;
    };

    // ——— buildRendererUrl retourne /pdf-render?studyId=...&versionId=... ———
    const url = buildRendererUrl("study-123", "version-456");
    if (
      url.includes("/pdf-render?studyId=") &&
      url.includes("&versionId=") &&
      url.includes("studyId=study-123") &&
      url.includes("versionId=version-456")
    ) {
      pass("buildRendererUrl retourne /pdf-render?studyId=...&versionId=...");
    } else {
      fail("buildRendererUrl format", `Reçu: ${url}`);
    }

    // ——— Aucun query param scenario ———
    if (!url.includes("scenario=")) {
      pass("Aucun query param scenario dans l'URL");
    } else {
      fail("scenario param", `URL contient encore scenario=: ${url}`);
    }

    // ——— getRendererUrl sans PDF_RENDERER_TEST_URL utilise buildRendererUrl ———
    delete process.env.PDF_RENDERER_TEST_URL;
    const getUrl = getRendererUrl("s1", "v1");
    if (getUrl.includes("studyId=s1") && getUrl.includes("versionId=v1") && !getUrl.includes("scenario=")) {
      pass("getRendererUrl (sans TEST_URL) utilise studyId+versionId, pas scenario");
    } else {
      fail("getRendererUrl format", `Reçu: ${getUrl}`);
    }

    // ——— getRendererUrl avec PDF_RENDERER_TEST_URL retourne l'URL de test ———
    process.env.PDF_RENDERER_TEST_URL = "data:text/html,test";
    const testUrl = getRendererUrl("any-study", "any-version");
    if (testUrl === "data:text/html,test") {
      pass("getRendererUrl avec PDF_RENDERER_TEST_URL retourne l'URL de test");
    } else {
      fail("getRendererUrl TEST_URL", `Reçu: ${testUrl}`);
    }

    restore();
  } catch (e) {
    if (origTestUrl !== undefined) process.env.PDF_RENDERER_TEST_URL = origTestUrl;
    else delete process.env.PDF_RENDERER_TEST_URL;
    fail("runUrlTests", e.message);
  }

  return { passed, failed };
}

// Exécution standalone (node pdf-renderer-url.test.js)
const isMain = process.argv[1]?.replace(/\\/g, "/").endsWith("pdf-renderer-url.test.js");
if (isMain) {
  const result = runUrlTests();
  console.log("\nRésultat buildRendererUrl/getRendererUrl :", result.passed, "passés,", result.failed, "échoués");
  process.exit(result.failed > 0 ? 1 : 0);
}
