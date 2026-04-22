/**
 * GET/POST /api/settings/legal/cgv
 */

import {
  validateLegalCgvPayload,
  saveLegalCgvSettings,
  getLegalCgvApiResponse,
  assertPdfDocumentIsOrgPdf,
} from "../services/legalCgv.service.js";

const orgId = (req) => req.user?.organizationId ?? req.user?.organization_id;

export async function getLegalCgv(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });
    const data = await getLegalCgvApiResponse(org);
    res.json({ ok: true, ...data });
  } catch (e) {
    res.status(500).json({ error: e.message || "Erreur serveur" });
  }
}

export async function postLegalCgv(req, res) {
  try {
    const org = orgId(req);
    if (!org) return res.status(401).json({ error: "Non authentifié" });

    const parsed = validateLegalCgvPayload(req.body);
    if (!parsed.ok) {
      return res.status(parsed.status || 400).json({ error: parsed.error });
    }

    let cgv = parsed.cgv;
    if (cgv.mode === "pdf") {
      await assertPdfDocumentIsOrgPdf(org, cgv.pdf_document_id);
    }

    await saveLegalCgvSettings(org, cgv);
    const fresh = await getLegalCgvApiResponse(org);
    res.json({ ok: true, ...fresh });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ error: e.message || "Erreur serveur" });
  }
}
