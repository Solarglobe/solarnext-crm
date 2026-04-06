/**
 * API modèles de texte devis — même RBAC que le catalogue devis.
 */

import * as svc from "../services/quoteTextTemplates.service.js";

function orgId(req) {
  return req.user?.organizationId ?? req.user?.organization_id;
}

export async function list(req, res) {
  try {
    const kind = req.query?.kind;
    const rows = await svc.listTemplates(orgId(req), { kind });
    res.json({ ok: true, items: rows });
  } catch (e) {
    const code = e.statusCode || 500;
    res.status(code).json({ ok: false, error: e.message || "Erreur" });
  }
}

export async function create(req, res) {
  try {
    const row = await svc.createTemplate(orgId(req), req.body || {});
    res.status(201).json({ ok: true, item: row });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ ok: false, error: "Un modèle avec ce nom existe déjà pour ce type." });
    }
    const code = e.statusCode || 500;
    res.status(code).json({ ok: false, error: e.message || "Erreur" });
  }
}

export async function patch(req, res) {
  try {
    const row = await svc.updateTemplate(req.params.id, orgId(req), req.body || {});
    if (!row) return res.status(404).json({ ok: false, error: "Modèle introuvable" });
    res.json({ ok: true, item: row });
  } catch (e) {
    if (e.code === "23505") {
      return res.status(409).json({ ok: false, error: "Un modèle avec ce nom existe déjà pour ce type." });
    }
    const code = e.statusCode || 500;
    res.status(code).json({ ok: false, error: e.message || "Erreur" });
  }
}

export async function remove(req, res) {
  try {
    const ok = await svc.deleteTemplate(req.params.id, orgId(req));
    if (!ok) return res.status(404).json({ ok: false, error: "Modèle introuvable" });
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ ok: false, error: e.message || "Erreur" });
  }
}
