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
import { respondWithDpPdfOrJson } from "../services/dpPdfPersistResponse.service.js";
import { publicHeavyRateLimiter } from "../middleware/security/rateLimit.presets.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";

const router = express.Router();

/** Vérifie que orgId (query) = organisation effective du JWT (après verifyJWT / override super-admin). */
function requireInternalPdfQueryOrgMatchesJwt(req, res, next) {
  const orgId = req.query.orgId;
  const jwtOrg = req.user?.organizationId ?? req.user?.organization_id;
  if (!orgId) {
    return res.status(400).json({ error: "orgId requis (query)", type: "BUSINESS" });
  }
  if (String(orgId) !== String(jwtOrg ?? "")) {
    return res.status(403).json({ error: "Accès refusé", type: "FORBIDDEN" });
  }
  next();
}

router.use((req, res, next) => {
  if (req.method === "POST") return publicHeavyRateLimiter(req, res, next);
  next();
});

function isValidMandatSignaturePayload(ms) {
  return !!(
    ms &&
    ms.signed === true &&
    typeof ms.signatureDataUrl === "string" &&
    ms.signatureDataUrl.indexOf("data:image") === 0
  );
}

/**
 * POST /pdf/render/mandat/signature-stamp
 * Horodatage serveur au moment de la validation du pad (ne fait pas confiance au client pour signedAtServer).
 */
router.post("/pdf/render/mandat/signature-stamp", verifyJWT, async (req, res) => {
  try {
    const ms = req.body && req.body.mandatSignature;
    if (!isValidMandatSignaturePayload(ms)) {
      return res.status(400).json({ error: "Signature mandat invalide ou manquante" });
    }
    return res.json({ signedAtServer: new Date().toISOString() });
  } catch (err) {
    logger.error("MANDAT_SIGNATURE_STAMP_ERROR", { error: err });
    res.status(500).json({ error: err.message || "Erreur serveur" });
  }
});

/**
 * POST /pdf/render/mandat/pdf
 */
router.post("/pdf/render/mandat/pdf", verifyJWT, async (req, res) => {
  try {
    const { mandatData } = req.body;

    if (!mandatData) {
      return res.status(400).json({ error: "mandatData manquant" });
    }

    const ms = mandatData.mandatSignature;
    if (!isValidMandatSignaturePayload(ms)) {
      return res.status(400).json({ error: "Veuillez signer le mandat avant génération" });
    }

    // signedAtServer : source unique émise par POST /pdf/render/mandat/signature-stamp (jamais recréée ici).
    // Anciens flux : absente → rendu mandat.js retombe sur signedAt client.

    return await respondWithDpPdfOrJson(req, res, {
      piece: "mandat",
      generate: () => generateMandatPDF(mandatData),
    });
  } catch (err) {
    logger.error("PDF_MANDAT_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp1/pdf
 */
router.post("/pdf/render/dp1/pdf", verifyJWT, async (req, res) => {
  try {
    const { dp1Data } = req.body;

    if (!dp1Data) {
      return res.status(400).json({ error: "dp1Data manquant" });
    }

    return await respondWithDpPdfOrJson(req, res, {
      piece: "dp1",
      generate: () => generateDP1PDF(dp1Data),
    });
  } catch (err) {
    logger.error("PDF_DP1_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp2/pdf
 */
router.post("/pdf/render/dp2/pdf", verifyJWT, async (req, res) => {
  try {
    const { dp2Data } = req.body;

    if (!dp2Data) {
      return res.status(400).json({ error: "dp2Data manquant" });
    }

    return await respondWithDpPdfOrJson(req, res, {
      piece: "dp2",
      generate: () => generateDP2PDF(dp2Data),
    });
  } catch (err) {
    logger.error("PDF_DP2_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp3/pdf
 */
router.post("/pdf/render/dp3/pdf", verifyJWT, async (req, res) => {
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

    return await respondWithDpPdfOrJson(req, res, {
      piece: "dp3",
      generate: () => generateDP3PDF(payload),
    });
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
router.post("/pdf/render/dp4/pdf", verifyJWT, async (req, res) => {
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

    return await respondWithDpPdfOrJson(req, res, {
      piece: "dp4",
      generate: () => generateDP4PDF(dp4Data),
    });
  } catch (err) {
    logger.error("PDF_DP4_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
});

/**
 * POST /pdf/render/dp6/pdf
 * - DP6 = 1 page (AVANT + APRÈS)
 */
router.post("/pdf/render/dp6/pdf", verifyJWT, async (req, res) => {
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

    return await respondWithDpPdfOrJson(req, res, {
      piece: "dp6",
      generate: () => generateDP6PDF(dp6Data),
    });
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

    const genOpts = {
      code: isDP8 ? "DP8" : "DP7",
      h1: isDP8 ? "DP8 — Environnement lointain" : "DP7 — Environnement proche",
      docTitle: isDP8
        ? "DP8 — Environnement lointain"
        : "DP7 — Implantation des panneaux (schématique)",
    };
    return await respondWithDpPdfOrJson(req, res, {
      piece: isDP8 ? "dp8" : "dp7",
      generate: () => generateDP7PDF(data, genOpts),
    });
  } catch (err) {
    logger.error("PDF_DP7_GENERATION_ERROR", { error: err });
    res.status(500).json({ error: err.message });
  }
}

router.post("/pdf/render/dp7/pdf", verifyJWT, renderDP7PDF);
router.post("/pdf/render/dp8/pdf", verifyJWT, renderDP7PDF);

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
router.get(
  "/internal/pdf/horizon-mask/:studyId",
  verifyJWT,
  requirePermission("study.manage"),
  requireInternalPdfQueryOrgMatchesJwt,
  async (req, res) => {
  const { studyId } = req.params;
  const orgId = req.query.orgId;
  const version = req.query.version ?? "1";
  const versionId = parseInt(version, 10) || 1;

  try {
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
  }
);

router.get(
  "/internal/pdf/dsm-analysis/:studyId",
  verifyJWT,
  requirePermission("study.manage"),
  requireInternalPdfQueryOrgMatchesJwt,
  async (req, res) => {
  const { studyId } = req.params;
  const orgId = req.query.orgId;
  const version = req.query.version ?? "1";
  const versionId = parseInt(version, 10) || 1;

  try {
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
  }
);

export default router;
