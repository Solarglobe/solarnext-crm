/**
 * economic_snapshots — API préparation devis technique (draft).
 * POST /api/studies/:studyId/economic-snapshot
 * PROMPT 8 : garde is_locked (409) sur modification.
 */

import { createOrUpdateEconomicSnapshot, ERROR_CODES } from "../services/economic/economicSnapshot.service.js";
import { getVersionById } from "../routes/studies/service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;
const userId = (req) => req.user?.id ?? req.user?.userId ?? null;

/**
 * POST /api/studies/:studyId/economic-snapshot
 * Body: { studyVersionId: UUID, config: object }
 */
export async function postEconomicSnapshot(req, res) {
  try {
    const org = orgId(req);
    if (!org) {
      return res.status(401).json({ error: "Non authentifié" });
    }

    const studyId = req.params.studyId;
    const { studyVersionId, config } = req.body || {};

    if (!studyVersionId || typeof studyVersionId !== "string") {
      return res.status(400).json({ error: "studyVersionId (UUID) requis" });
    }

    const version = await getVersionById(studyVersionId, org);
    if (!version) return res.status(404).json({ error: "Version non trouvée" });
    if (version.study_id !== studyId) return res.status(404).json({ error: "studyVersionId ne correspond pas à studyId" });
    if (version.is_locked) return res.status(400).json({ error: "LOCKED_VERSION" });

    const result = await createOrUpdateEconomicSnapshot({
      studyId,
      studyVersionId,
      organizationId: org,
      userId: userId(req),
      config: config != null && typeof config === "object" ? config : {},
    });

    return res.status(200).json({
      snapshotId: result.snapshotId,
      version_number: result.version_number,
      status: result.status ?? "DRAFT",
    });
  } catch (e) {
    const code = e.code || e.name;
    if (code === "NOT_FOUND" || code === "MISMATCH") {
      return res.status(404).json({ error: e.message });
    }
    if (code === ERROR_CODES.NO_CALPINAGE_SNAPSHOT) {
      return res.status(400).json({ error: e.message });
    }
    if (code === ERROR_CODES.NOT_DRAFT) {
      return res.status(403).json({ error: e.message });
    }
    console.error("[economicSnapshot.controller] postEconomicSnapshot:", e);
    return res.status(500).json({ error: e.message });
  }
}

