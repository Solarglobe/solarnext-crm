/**
 * CP-031 — Routes Studies avec versioning strict
 * CP-032A — Archive / Restore
 * CP-AUDIT-004 — Soft delete + reset version sécurisés
 */

import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requirePermission } from "../rbac/rbac.middleware.js";
import logger from "../app/core/logger.js";
import { pool } from "../config/db.js";
import * as service from "./studies/service.js";
import { archiveEntity, restoreEntity } from "../services/archive.service.js";
import { heavyUserRateLimiter } from "../middleware/security/rateLimit.presets.js";
import { logAuditEvent } from "../services/audit/auditLog.service.js";
import { AuditActions } from "../services/audit/auditActions.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user?.id ?? req.user?.userId ?? null;

router.get(
  "/",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const { lead_id, client_id } = req.query;
      if (lead_id) {
        const data = await service.listByLeadId(lead_id, org);
        return res.json(data);
      }
      if (client_id) {
        const data = await service.listByClientId(client_id, org);
        return res.json(data);
      }
      return res.json([]);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

router.post(
  "/",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await service.createStudy(org, userId(req), req.body);
      res.status(201).json(data);
    } catch (e) {
      const status = e.statusCode || 400;
      res.status(status).json({ error: e.message });
    }
  }
);

/**
 * Copie une étude (corps JSON) — préféré à POST /:id/duplicate pour éviter les problèmes
 * de passerelle qui tronquent le chemin et retombent sur PATCH /:id (= renommage uniquement).
 * Corps : `{ source_study_id: UUID, title?: string }`.
 */
router.post(
  "/duplicate-from",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const sid = req.body?.source_study_id;
      if (sid == null || typeof sid !== "string" || String(sid).trim() === "") {
        return res.status(400).json({ error: "source_study_id requis (UUID de l'étude à copier)" });
      }
      const data = await service.duplicateStudy(String(sid).trim(), org, userId(req), req.body ?? {});
      res.status(201).json(data);
    } catch (e) {
      if (e.code === "NOT_FOUND") {
        return res.status(404).json({ error: "Étude non trouvée" });
      }
      if (e.code === "BAD_REQUEST") {
        return res.status(400).json({ error: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  }
);

router.post(
  "/:id/versions",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await service.createVersion(
        req.params.id,
        org,
        userId(req),
        req.body
      );
      if (!data) return res.status(404).json({ error: "Étude non trouvée" });
      res.status(201).json(data);
    } catch (e) {
      if (e.code === "STUDY_DELETED") {
        return res.status(400).json({ error: "STUDY_DELETED" });
      }
      const status = e.statusCode || 400;
      res.status(status).json({ error: e.message });
    }
  }
);

router.patch(
  "/:id/archive",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const data = await archiveEntity("studies", req.params.id, orgId(req), userId(req));
      if (!data) return res.status(404).json({ error: "Étude non trouvée" });
      res.json(data);
    } catch (e) {
      const status = e.statusCode || 400;
      res.status(status).json({ error: e.message });
    }
  }
);
router.patch(
  "/:id/restore",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const data = await restoreEntity("studies", req.params.id, orgId(req));
      if (!data) return res.status(404).json({ error: "Étude non trouvée" });
      res.json(data);
    } catch (e) {
      const status = e.statusCode || 400;
      res.status(status).json({ error: e.message });
    }
  }
);
router.post(
  "/:id/duplicate",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const studyId = req.params.id;
      const data = await service.duplicateStudy(studyId, org, userId(req), req.body);
      res.status(201).json(data);
    } catch (e) {
      if (e.code === "NOT_FOUND") {
        return res.status(404).json({ error: "Étude non trouvée" });
      }
      if (e.code === "BAD_REQUEST") {
        return res.status(400).json({ error: e.message });
      }
      res.status(500).json({ error: e.message });
    }
  }
);

router.patch(
  "/:id",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await service.patchStudy(req.params.id, org, req.body);
      if (!data) return res.status(404).json({ error: "Étude non trouvée" });
      res.json(data);
    } catch (e) {
      const status = e.statusCode || 400;
      res.status(status).json({ error: e.message });
    }
  }
);

router.get(
  "/:id",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await service.getStudyById(req.params.id, org);
      if (!data) return res.status(404).json({ error: "Étude non trouvée" });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

router.delete(
  "/:id",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const studyId = req.params.id;
      const snRes = await pool.query(
        `SELECT study_number FROM studies WHERE id = $1 AND organization_id = $2`,
        [studyId, org]
      );
      const studyNumber = snRes.rows[0]?.study_number ?? null;
      const deleted = await service.deleteStudy(studyId, org);
      if (!deleted) {
        return res.status(404).json({ error: "STUDY_NOT_FOUND" });
      }
      logger.info("study.permanently_deleted", {
        studyId,
        organizationId: org,
      });
      void logAuditEvent({
        action: AuditActions.STUDY_DELETED,
        entityType: "study",
        entityId: studyId,
        organizationId: org,
        userId: userId(req),
        targetLabel: studyNumber != null ? String(studyNumber) : undefined,
        req,
        statusCode: 200,
        metadata: { hard_delete: true, study_number: studyNumber },
      });
      return res.json({ success: true });
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

router.get(
  "/:id/version/:v",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const v = parseInt(req.params.v, 10);
      if (isNaN(v) || v < 1) {
        return res.status(400).json({ error: "Numéro de version invalide" });
      }
      const data = await service.getVersion(req.params.id, v, org);
      if (!data) return res.status(404).json({ error: "Version non trouvée" });
      res.json(data);
    } catch (e) {
      res.status(500).json({ error: e.message });
    }
  }
);

// Warning modification calpinage si étude active
import { hasActiveStudy } from "../controllers/studyHasActive.controller.js";

router.get(
  "/:studyId/has-active-study",
  verifyJWT,
  requirePermission("study.manage"),
  hasActiveStudy
);

// economic_snapshots — Préparation devis technique (draft) — conservé pour compatibilité
import { postEconomicSnapshot } from "../controllers/economicSnapshot.controller.js";

router.post(
  "/:studyId/economic-snapshot",
  verifyJWT,
  requirePermission("study.manage"),
  heavyUserRateLimiter,
  postEconomicSnapshot
);

// quote-prep — Préparation du devis technique (GET/PUT/validate/fork)
import * as quotePrepController from "../controllers/quotePrep.controller.js";

router.get(
  "/:studyId/versions/:versionId/quote-prep",
  verifyJWT,
  requirePermission("study.manage"),
  quotePrepController.getQuotePrep
);
router.put(
  "/:studyId/versions/:versionId/quote-prep",
  verifyJWT,
  requirePermission("study.manage"),
  quotePrepController.putQuotePrep
);
router.post(
  "/:studyId/versions/:versionId/quote-prep/validate",
  verifyJWT,
  requirePermission("study.manage"),
  heavyUserRateLimiter,
  quotePrepController.postValidate
);
router.post(
  "/:studyId/versions/:versionId/quote-prep/fork",
  verifyJWT,
  requirePermission("study.manage"),
  quotePrepController.postFork
);

// Reset calpinage / devis par version
import { resetCalpinageForVersion } from "../services/calpinage/calpinage.service.js";
import { resetQuoteForVersion } from "../services/economic/economicSnapshot.service.js";

router.post(
  "/:studyId/versions/:versionId/reset-calpinage",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const { studyId, versionId } = req.params;
      const version = await service.getVersionById(versionId, org);
      if (!version || version.study_id !== studyId) {
        return res.status(404).json({ error: "VERSION_NOT_FOUND" });
      }
      if (version.is_locked) {
        return res.status(400).json({ error: "LOCKED_VERSION" });
      }
      await resetCalpinageForVersion(versionId, org);
      return res.json({ success: true });
    } catch (e) {
      if (e.code === "VERSION_NOT_FOUND") {
        return res.status(404).json({ error: "VERSION_NOT_FOUND" });
      }
      res.status(500).json({ error: e.message });
    }
  }
);

router.post(
  "/:studyId/versions/:versionId/reset-quote",
  verifyJWT,
  requirePermission("study.manage"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const { studyId, versionId } = req.params;
      const version = await service.getVersionById(versionId, org);
      if (!version || version.study_id !== studyId) {
        return res.status(404).json({ error: "VERSION_NOT_FOUND" });
      }
      if (version.is_locked) {
        return res.status(400).json({ error: "LOCKED_VERSION" });
      }
      await resetQuoteForVersion(versionId, org);
      return res.json({ success: true });
    } catch (e) {
      if (e.code === "VERSION_NOT_FOUND") {
        return res.status(404).json({ error: "VERSION_NOT_FOUND" });
      }
      res.status(500).json({ error: e.message });
    }
  }
);

// CP-1 — Calpinage persist (GET/POST)
import * as calpinageController from "../controllers/calpinage.controller.js";

router.get(
  "/:studyId/versions/:versionId/calpinage",
  verifyJWT,
  requirePermission("study.manage"),
  calpinageController.getCalpinage
);

router.post(
  "/:studyId/versions/:versionId/calpinage",
  verifyJWT,
  requirePermission("study.manage"),
  calpinageController.upsertCalpinage
);

// CP-SNAPSHOT — Validation calpinage → snapshot versionné (ne modifie pas geometry_json)
import { validateCalpinage } from "../controllers/calpinageValidate.controller.js";

router.post(
  "/:studyId/calpinage/validate",
  verifyJWT,
  requirePermission("study.manage"),
  validateCalpinage
);

// PROMPT 8 — Sélection scénario (fige snapshot + is_locked)
import { selectScenario } from "../controllers/selectScenario.controller.js";

router.post(
  "/:studyId/versions/:versionId/select-scenario",
  verifyJWT,
  requirePermission("study.manage"),
  selectScenario
);

// PROMPT 8 — Fork version (nouvelle version déverrouillée, copie data/calpinage/economic)
import { forkStudyVersion } from "../controllers/forkStudyVersion.controller.js";

router.post(
  "/:studyId/versions/:versionId/fork",
  verifyJWT,
  requirePermission("study.manage"),
  forkStudyVersion
);

// CP-4 — Lancer calcul
import * as studyCalcController from "../controllers/studyCalc.controller.js";

router.post(
  "/:studyId/versions/:versionId/calc",
  verifyJWT,
  requirePermission("study.manage"),
  studyCalcController.runStudyCalc
);

// Point d'entrée officiel "Calculer l'étude" (validation + statut + calc)
import { runStudy } from "../controllers/runStudy.controller.js";

router.post(
  "/:studyId/versions/:versionId/run-study",
  verifyJWT,
  requirePermission("study.manage"),
  runStudy
);

// Valider le devis technique : vérif economic_snapshot → calc → résumé minimal (scenarios_v2)
import { validateDevisTechnique } from "../controllers/validateDevisTechnique.controller.js";

router.post(
  "/:studyId/versions/:versionId/validate-devis-technique",
  verifyJWT,
  requirePermission("study.manage"),
  validateDevisTechnique
);

// Lecture scenarios_v2 (aucun calcul, lecture pure)
import { getStudyScenarios } from "../controllers/studyScenarios.controller.js";

router.get(
  "/:studyId/versions/:versionId/scenarios",
  verifyJWT,
  requirePermission("study.manage"),
  getStudyScenarios
);

// PDF V2 — Lecture du snapshot figé (entrée moteur PDF V2)
import { getSelectedScenarioSnapshot } from "../controllers/getSelectedScenarioSnapshot.controller.js";

router.get(
  "/:studyId/versions/:versionId/selected-scenario-snapshot",
  verifyJWT,
  requirePermission("study.manage"),
  getSelectedScenarioSnapshot
);

// PDF V2 — ViewModel pour rendu PDF (snapshot → mapper → JSON)
import { getPdfViewModel } from "../controllers/getPdfViewModel.controller.js";

router.get(
  "/:studyId/versions/:versionId/pdf-view-model",
  verifyJWT,
  requirePermission("study.manage"),
  getPdfViewModel
);

// PDF V2 — Génération server-side PDF (Playwright)
import { generatePdf } from "../controllers/pdfGeneration.controller.js";
import { generatePdfFromScenario } from "../controllers/generatePdfFromScenario.controller.js";

router.post(
  "/:studyId/versions/:versionId/generate-pdf",
  verifyJWT,
  requirePermission("study.manage"),
  generatePdf
);

// PDF V2 — Génération PDF depuis un scénario (snapshot éphémère, sans lock ni persistance du snapshot)
router.post(
  "/:studyId/versions/:versionId/generate-pdf-from-scenario",
  verifyJWT,
  requirePermission("study.manage"),
  generatePdfFromScenario
);

export default router;
