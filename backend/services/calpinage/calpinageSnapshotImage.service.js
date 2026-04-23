/**
 * CP-SNAPSHOT — Génération du layout_snapshot via Playwright.
 * Capture réelle du plan calpinage (Google Maps + overlays) pour le PDF.
 */

import { chromium } from "playwright";
import { pool } from "../../config/db.js";
import { withTx } from "../../db/tx.js";
import { persistGeometryHashForStudyVersion } from "./calpinageGeometryHash.js";
import { lockCalpinageVersion } from "./calpinageDataConcurrency.js";
import { withPgRetryOnce } from "../../utils/pgRetry.js";
import { createPdfRenderToken } from "../pdfRenderToken.service.js";
import { getPdfRendererBaseUrl } from "../pdfGeneration.service.js";

const RENDER_READY_TIMEOUT =
  parseInt(process.env.CALPINAGE_RENDER_READY_TIMEOUT || "60000", 10);
const PAGE_LOAD_TIMEOUT = 15000;
const VIEWPORT = { width: 1400, height: 1000 };

/**
 * Génère le layout_snapshot pour une version de calpinage.
 * Ouvre la page de rendu, attend le marqueur, capture le bloc plan, met à jour calpinage_data.
 *
 * @param {string} studyId - UUID de l'étude
 * @param {string} studyVersionId - UUID de la version (study_versions.id)
 * @param {string} organizationId - UUID de l'organisation
 * @returns {Promise<{ ok: boolean, length?: number, error?: string }>}
 */
const SNAPSHOT_MOCK = process.env.CALPINAGE_SNAPSHOT_MOCK === "1";
const SNAPSHOT_MOCK_FAIL = process.env.CALPINAGE_SNAPSHOT_MOCK_FAIL === "1";

export async function generateCalpinageSnapshotForVersion(studyId, studyVersionId, organizationId) {
  if (SNAPSHOT_MOCK_FAIL) {
    console.log("[calpinageSnapshotImage] SNAPSHOT_MOCK_FAIL=1, simulate failure");
    return { ok: false, error: "Mock failure for tests" };
  }
  if (SNAPSHOT_MOCK) {
    console.log("[calpinageSnapshotImage] SNAPSHOT_MOCK=1, skip Playwright");
    return { ok: true, length: 0 };
  }

  const renderToken = createPdfRenderToken(studyId, studyVersionId, organizationId);
  const base = getPdfRendererBaseUrl();
  const renderUrl = `${base}/calpinage-render.html?studyId=${encodeURIComponent(studyId)}&versionId=${encodeURIComponent(studyVersionId)}&renderToken=${encodeURIComponent(renderToken)}`;

  let browser;
  try {
    console.log("[calpinageSnapshotImage] SNAPSHOT_START", { studyId, studyVersionId });
    browser = await chromium.launch({ headless: true });
    const context = await browser.newContext({
      viewport: VIEWPORT,
      deviceScaleFactor: 1,
    });
    const page = await context.newPage();

    await page.goto(renderUrl, {
      waitUntil: "networkidle",
      timeout: PAGE_LOAD_TIMEOUT,
    });

    console.log("[calpinageSnapshot] waiting ready marker", renderUrl);
    await page.waitForSelector('#calpinage-render-ready[data-status="ready"]', {
      timeout: RENDER_READY_TIMEOUT,
    });

    const root = page.locator("#calpinage-render-root");
    const buffer = await root.screenshot({
      type: "png",
      timeout: 10000,
    });

    await browser.close();
    browser = null;

    const base64 = buffer.toString("base64");
    const dataUrl = `data:image/png;base64,${base64}`;

    if (!dataUrl || dataUrl.length < 100) {
      return { ok: false, error: "Capture vide ou invalide" };
    }

    const txResult = await withPgRetryOnce(() =>
      withTx(pool, async (client) => {
        await lockCalpinageVersion(client, organizationId, studyVersionId);
        const locked = await client.query(
          `SELECT id FROM calpinage_data WHERE study_version_id = $1 AND organization_id = $2 FOR UPDATE`,
          [studyVersionId, organizationId]
        );
        if (locked.rows.length === 0) {
          return { ok: false, error: "Calpinage non trouvé" };
        }
        await client.query(
          `UPDATE calpinage_data
           SET geometry_json = jsonb_set(
             COALESCE(geometry_json, '{}'::jsonb),
             '{layout_snapshot}',
             to_jsonb($1::text)
           )
           WHERE study_version_id = $2 AND organization_id = $3`,
          [dataUrl, studyVersionId, organizationId]
        );
        await persistGeometryHashForStudyVersion(studyVersionId, organizationId, client);
        return { ok: true };
      })
    );
    if (!txResult?.ok) {
      return { ok: false, error: txResult?.error || "Calpinage non trouvé" };
    }

    console.log("[calpinageSnapshotImage] SNAPSHOT_DONE", { ok: true, length: dataUrl.length });
    return { ok: true, length: dataUrl.length };
  } catch (err) {
    const msg = err?.message || "Erreur capture";
    if (typeof msg === "string" && msg.toLowerCase().includes("timeout")) {
      console.error("[calpinageSnapshot] ready marker timeout", { studyId, studyVersionId });
    }
    console.log("[calpinageSnapshotImage] SNAPSHOT_DONE", { ok: false, error: msg });
    console.error("[calpinageSnapshotImage] generateCalpinageSnapshotForVersion failed:", msg);
    return { ok: false, error: msg };
  } finally {
    if (browser) await browser.close();
  }
}
