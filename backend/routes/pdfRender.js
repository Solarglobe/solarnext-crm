import express from "express";
import logger from "../app/core/logger.js";
import { generateMandatPDF } from "../pdf/playwright-mandat.js";
import { generateDP1PDF } from "../pdf/playwright-dp1.js";
import { generateDP2PDF } from "../pdf/playwright-dp2.js";
import { generateDP3PDF } from "../pdf/playwright-dp3.js";
import { generateDP4PDF } from "../pdf/playwright-dp4.js";
import { generateDP6PDF } from "../pdf/playwright-dp6.js";
import { generateDP7PDF } from "../pdf/playwright-dp7.js";
import { generateDsmAnalysisPDF, generatePdfFromHtml } from "../pdf/playwright-dsm-analysis.js";
import { getDsmAnalysisData } from "../services/dsmAnalysisPdf.service.js";
import { getHorizonMaskPdfData } from "../services/horizonMaskPdf.service.js";
import { buildDsmCombinedHtml } from "../pdf/dsmCombinedHtmlBuilder.js";
import { buildHorizonMaskSinglePageHtml } from "../pdf/horizonMaskHtmlBuilder.js";


const router = express.Router();

/**
 * POST /pdf/render/mandat/pdf
 */
router.post("/pdf/render/mandat/pdf", async (req, res) => {
  try {
    const { mandatData } = req.body;

    if (!mandatData) {
      return res.status(400).json({ error: "mandatData manquant" });
    }

    const pdfBuffer = await generateMandatPDF(mandatData);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      "inline; filename=mandat-solarglobe.pdf"
    );

    res.send(pdfBuffer);
  } catch (err) {
    logger.error("PDF_MANDAT_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp1/pdf
 */
router.post("/pdf/render/dp1/pdf", async (req, res) => {
  try {
    const { dp1Data } = req.body;

    if (!dp1Data) {
      return res.status(400).json({ error: "dp1Data manquant" });
    }

    const pdfBuffer = await generateDP1PDF(dp1Data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=dp1-plan-situation.pdf");

    res.send(pdfBuffer);
  } catch (err) {
    logger.error("PDF_DP1_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp2/pdf
 */
router.post("/pdf/render/dp2/pdf", async (req, res) => {
  try {
    const { dp2Data } = req.body;

    if (!dp2Data) {
      return res.status(400).json({ error: "dp2Data manquant" });
    }

    const pdfBuffer = await generateDP2PDF(dp2Data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=dp2-plan-masse.pdf");

    res.send(pdfBuffer);
  } catch (err) {
    logger.error("PDF_DP2_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp3/pdf
 */
router.post("/pdf/render/dp3/pdf", async (req, res) => {
  try {
    const { dp3Data, dp2Data, client } = req.body || {};

    if (!dp3Data) {
      return res.status(400).json({ error: "dp3Data manquant" });
    }

    // ALIGNEMENT STRICT DP2:
    // - DP2 expose `client` à la racine (data.client.nom/adresse/cp/ville)
    // - DP3 doit injecter `client` au même niveau et avec la même clé
    const resolvedClient =
      dp3Data?.client ??
      client ??
      dp2Data?.client ??
      null;

    const payload = resolvedClient
      ? { ...dp3Data, client: resolvedClient }
      : dp3Data;

    const pdfBuffer = await generateDP3PDF(payload);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=dp3-plan-coupe.pdf");

    res.send(pdfBuffer);
  } catch (err) {
    logger.error("PDF_DP3_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp4/pdf
 * - DP4 = 1 ou 2 pages (before/after)
 * - Source d’image obligatoire : rendu FINAL stocké (data:image...)
 */
router.post("/pdf/render/dp4/pdf", async (req, res) => {
  try {
    const { dp4Data } = req.body || {};

    if (!dp4Data) {
      return res.status(400).json({ error: "dp4Data manquant" });
    }

    const pages = Array.isArray(dp4Data.pages) ? dp4Data.pages : [];
    if (!pages.length) {
      return res.status(400).json({ error: "dp4Data.pages manquant" });
    }

    for (const [idx, p] of pages.entries()) {
      const src = p?.planImageBase64;
      if (!(typeof src === "string" && src.startsWith("data:image"))) {
        return res.status(400).json({
          error: `dp4Data.pages[${idx}].planImageBase64 invalide (data:image...)`,
        });
      }
    }

    const pdfBuffer = await generateDP4PDF(dp4Data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=dp4-plan-toiture.pdf");

    res.send(pdfBuffer);
  } catch (err) {
    logger.error("PDF_DP4_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp6/pdf
 * - DP6 = 1 page (AVANT + APRÈS)
 */
router.post("/pdf/render/dp6/pdf", async (req, res) => {
  try {
    const { dp6Data } = req.body || {};

    if (!dp6Data) {
      return res.status(400).json({ error: "dp6Data manquant" });
    }

    // Aligné DP4 : exiger des images base64 valides (évite timeout Playwright)
    const before = dp6Data?.beforeImage;
    const after = dp6Data?.afterImage;
    if (!(typeof before === "string" && before.startsWith("data:image"))) {
      return res.status(400).json({ error: "dp6Data.beforeImage invalide (data:image...)" });
    }
    if (!(typeof after === "string" && after.startsWith("data:image"))) {
      return res.status(400).json({ error: "dp6Data.afterImage invalide (data:image...)" });
    }

    const pdfBuffer = await generateDP6PDF(dp6Data);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader("Content-Disposition", "inline; filename=dp6-insertion-projet.pdf");

    res.send(pdfBuffer);
  } catch (err) {
    logger.error("PDF_DP6_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp7/pdf
 * - DP7 = 1 page (visuel final : photo + flèches rouges)
 */
async function renderDP7PDF(req, res) {
  try {
    const isDP8 = req.originalUrl?.includes("/dp8/");

    // DP8 envoie dp8Data mais le payload est STRICTEMENT identique à DP7
    const { dp7Data, dp8Data } = req.body || {};
    const data = dp7Data ?? dp8Data;

    if (!data) {
      return res.status(400).json({ error: "dp7Data manquant" });
    }

    // Aligné DP2/DP4 : exiger une image base64 valide (évite timeout Playwright)
    const finalImg = data?.images?.final;
    if (!(typeof finalImg === "string" && finalImg.startsWith("data:image"))) {
      return res.status(400).json({ error: "dp7Data.images.final invalide (data:image...)" });
    }

    const pdfBuffer = await generateDP7PDF(data, {
      code: isDP8 ? "DP8" : "DP7",
      h1: isDP8 ? "DP8 — Environnement lointain" : "DP7 — Environnement proche",
      docTitle: isDP8
        ? "DP8 — Environnement lointain"
        : "DP7 — Implantation des panneaux (schématique)",
    });

    res.setHeader("Content-Type", "application/pdf");
    const filename = isDP8
      ? "DP8 - Environnement lointain.pdf"
      : "DP7 - Environnement proche.pdf";
    res.setHeader("Content-Disposition", `inline; filename="${filename}"`);

    res.send(pdfBuffer);
  } catch (err) {
    logger.error("PDF_DP7_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
}

router.post("/pdf/render/dp7/pdf", renderDP7PDF);
router.post("/pdf/render/dp8/pdf", renderDP7PDF);

/**
 * CP-DSM-PDF-004 — GET /internal/pdf/dsm-analysis/:studyId
 * Export PDF "Analyse Ombres" Premium.
 * Query: orgId (requis), version (optionnel, défaut 1)
 */
const DSM_BUSINESS_ERROR_PATTERNS = [
  "Adresse non géolocalisée",
  "CALPINAGE_REQUIRED",
  "Version non trouvée",
  "Étude non trouvée",
  "Lead non trouvé",
  "Étude sans lead associé",
  "Numéro de version invalide",
];

const HORIZON_MASK_BUSINESS_ERROR_PATTERNS = [
  "Adresse non géolocalisée",
  "Version non trouvée",
  "Étude non trouvée",
  "Numéro de version invalide",
];

function isDsmBusinessError(message) {
  if (!message || typeof message !== "string") return false;
  return DSM_BUSINESS_ERROR_PATTERNS.some((p) => message.includes(p));
}

function isHorizonMaskBusinessError(message) {
  if (!message || typeof message !== "string") return false;
  return HORIZON_MASK_BUSINESS_ERROR_PATTERNS.some((p) => message.includes(p));
}

/**
 * CP-DSM-PDF-006 — GET /internal/pdf/horizon-mask/:studyId
 * Export PDF "Masque d'ombrage" 1 page (site-level, sans panneaux).
 * Query: orgId (requis), version (optionnel, défaut 1)
 */
router.get("/internal/pdf/horizon-mask/:studyId", async (req, res) => {
  const { studyId } = req.params;
  const orgId = req.query.orgId;
  const version = req.query.version ?? "1";
  const versionId = parseInt(version, 10) || 1;

  try {
    if (!orgId) {
      return res.status(400).json({ error: "orgId requis (query)", type: "BUSINESS" });
    }

    const data = await getHorizonMaskPdfData({
      studyId,
      versionId,
      orgId,
    });

    const html = buildHorizonMaskSinglePageHtml(data);
    const pdfBuffer = await generatePdfFromHtml(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      `attachment; filename="horizon-mask-study-${studyId}.pdf"`
    );

    res.send(pdfBuffer);
  } catch (err) {
    logger.error("PDF_HORIZON_MASK_RUNTIME_ERROR", {
      message: err.message,
      stack: err.stack,
      studyId,
      versionId,
      orgId,
    });

    if (isHorizonMaskBusinessError(err.message)) {
      return res.status(400).json({ error: err.message, type: "BUSINESS" });
    }

    res.status(500).json({
      error: "Erreur technique lors de la génération du PDF",
      type: "TECHNICAL",
    });
  }
});

router.get("/internal/pdf/dsm-analysis/:studyId", async (req, res) => {
  const { studyId } = req.params;
  const orgId = req.query.orgId;
  const version = req.query.version ?? "1";
  const versionId = parseInt(version, 10) || 1;

  try {
    if (!orgId) {
      return res.status(400).json({ error: "orgId requis (query)" });
    }

    const data = await getDsmAnalysisData({
      studyId,
      versionId,
      orgId,
    });

    const html = buildDsmCombinedHtml(data);
    const pdfBuffer = await generateDsmAnalysisPDF(html);

    res.setHeader("Content-Type", "application/pdf");
    res.setHeader(
      "Content-Disposition",
      'attachment; filename="analyse-ombres-solarglobe.pdf"'
    );

    res.send(pdfBuffer);
  } catch (err) {
    logger.error("PDF_DSM_ANALYSIS_RUNTIME_ERROR", {
      message: err.message,
      stack: err.stack,
      studyId,
      versionId,
      orgId,
    });

    if (isDsmBusinessError(err.message)) {
      return res.status(400).json({ error: err.message, type: "BUSINESS" });
    }

    res.status(500).json({
      error: "Erreur technique lors de la génération du PDF",
      type: "TECHNICAL",
    });
  }
});

export default router;
