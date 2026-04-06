/**
 * quote-prep — Préparation du devis technique (API).
 * GET /api/studies/:studyId/versions/:versionId/quote-prep
 * PUT /api/studies/:studyId/versions/:versionId/quote-prep
 * POST /api/studies/:studyId/versions/:versionId/quote-prep/validate
 * POST /api/studies/:studyId/versions/:versionId/quote-prep/fork
 * PROMPT 8 : garde is_locked (409) sur modification.
 */

import * as quotePrepService from "../services/quotePrep/quotePrep.service.js";
import { getVersionById } from "../routes/studies/service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.id ?? req.user?.userId ?? null;

export async function getQuotePrep(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });
    const { studyId, versionId } = req.params;
    const data = await quotePrepService.getQuotePrep({
      studyId,
      versionId,
      organizationId: org,
    });
    return res.json(data);
  } catch (e) {
    const code = e.code || e.name;
    if (code === "NOT_FOUND" || code === "NO_CALPINAGE") {
      return res.status(404).json({ error: e.message });
    }
    console.error("[quotePrep.controller] getQuotePrep:", e);
    return res.status(500).json({ error: e.message });
  }
}

export async function putQuotePrep(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });
    const { studyId, versionId } = req.params;
    const version = await getVersionById(versionId, org);
    if (!version) return res.status(404).json({ error: "Version non trouvée" });
    if (version.study_id !== studyId) return res.status(404).json({ error: "Version ne correspond pas à l'étude" });
    if (version.is_locked) return res.status(400).json({ error: "LOCKED_VERSION" });
    const data = req.body && typeof req.body === "object" ? req.body : {};
    const result = await quotePrepService.saveQuotePrepDraft({
      studyId,
      versionId,
      organizationId: org,
      userId: userId(req),
      data,
    });
    return res.json({
      snapshotId: result.snapshotId,
      version_number: result.version_number,
      status: result.status,
    });
  } catch (e) {
    const code = e.code || e.name;
    if (code === "NOT_FOUND" || code === "MISMATCH") {
      return res.status(404).json({ error: e.message });
    }
    if (code === quotePrepService.ERROR_CODES.NO_CALPINAGE_SNAPSHOT) {
      return res.status(400).json({ error: e.message });
    }
    if (code === quotePrepService.ERROR_CODES.NOT_DRAFT) {
      return res.status(403).json({ error: e.message });
    }
    console.error("[quotePrep.controller] putQuotePrep:", e);
    return res.status(500).json({ error: e.message });
  }
}

export async function postValidate(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });
    const { studyId, versionId } = req.params;
    const version = await getVersionById(versionId, org);
    if (!version) return res.status(404).json({ error: "Version non trouvée" });
    if (version.study_id !== studyId) return res.status(404).json({ error: "Version ne correspond pas à l'étude" });
    if (version.is_locked) return res.status(400).json({ error: "LOCKED_VERSION" });
    const result = await quotePrepService.validateQuotePrep({
      studyId,
      versionId,
      organizationId: org,
      userId: userId(req),
    });
    return res.json({
      snapshotId: result.snapshotId,
      version_number: result.version_number,
      status: result.status,
    });
  } catch (e) {
    const code = e.code || e.name;
    if (code === "NOT_FOUND") return res.status(404).json({ error: e.message });
    if (code === quotePrepService.ERROR_CODES.NOT_DRAFT) {
      return res.status(403).json({ error: e.message });
    }
    console.error("[quotePrep.controller] postValidate:", e);
    return res.status(500).json({ error: e.message });
  }
}

export async function postFork(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });
    const { studyId, versionId } = req.params;
    const result = await quotePrepService.forkQuotePrep({
      studyId,
      versionId,
      organizationId: org,
      userId: userId(req),
    });
    return res.status(201).json({
      snapshotId: result.snapshotId,
      version_number: result.version_number,
      status: result.status,
    });
  } catch (e) {
    const code = e.code || e.name;
    if (code === "NOT_FOUND") return res.status(404).json({ error: e.message });
    if (code === "NOT_READY") return res.status(403).json({ error: e.message });
    console.error("[quotePrep.controller] postFork:", e);
    return res.status(500).json({ error: e.message });
  }
}
