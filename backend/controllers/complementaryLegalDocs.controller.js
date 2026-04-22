/**
 * Statut des PDFs RGE / décennale (organisation) — pour UI devis + admin.
 */

import { getComplementaryLegalDocsStatus } from "../services/organizationLegalDocuments.service.js";

export async function getComplementaryLegalDocs(req, res) {
  try {
    const orgId = req.user.organizationId ?? req.user.organization_id;
    if (!orgId) {
      return res.status(400).json({ ok: false, error: "Organisation manquante" });
    }
    const status = await getComplementaryLegalDocsStatus(orgId);
    return res.json({ ok: true, ...status });
  } catch (e) {
    return res.status(500).json({ ok: false, error: e.message || "Erreur serveur" });
  }
}
