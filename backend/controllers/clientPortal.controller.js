/**
 * Portail client SolarGlobe — routes publiques + création de jeton (staff).
 */

import fs from "node:fs";
import path from "path";
import { pool } from "../config/db.js";
import {
  findValidPortalTokenRow,
  touchPortalTokenLastUsed,
  buildClientPortalPayload,
  mintClientPortalToken,
  assertDocumentInPortalScope,
  findActivePortalTokenRowForLead,
  buildPortalDisplayUrl,
} from "../services/clientPortal.service.js";
import { resolveOrgLogoAbsolutePath } from "../services/orgLogo.service.js";
import { getAbsolutePath } from "../services/localStorage.service.js";
import { assertLeadApiAccess } from "../services/leadRequestAccess.service.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

/**
 * GET /api/client-portal/:token
 */
export async function getClientPortal(req, res) {
  try {
    const rawToken = req.params.token;
    if (!rawToken || String(rawToken).length < 16) {
      return res.status(401).json({ error: "Token invalide", code: "PORTAL_TOKEN_INVALID" });
    }

    const row = await findValidPortalTokenRow(rawToken);
    if (!row) {
      return res.status(401).json({ error: "Token invalide ou expiré", code: "PORTAL_TOKEN_INVALID" });
    }

    await touchPortalTokenLastUsed(row.id);

    const payload = await buildClientPortalPayload(pool, {
      organizationId: row.organization_id,
      leadId: row.lead_id,
      rawToken,
    });
    return res.json(payload);
  } catch (e) {
    if (e.statusCode === 404) {
      return res.status(404).json({ error: "Dossier introuvable", code: "LEAD_NOT_FOUND" });
    }
    console.error("[clientPortal] getClientPortal", e);
    return res.status(500).json({ error: "Erreur serveur", code: "PORTAL_ERROR" });
  }
}

/**
 * GET /api/client-portal/organization/logo?token=
 * Logo entreprise (même fichier que Paramètres → upload logo), authentifié par jeton portail.
 */
export async function getClientPortalOrgLogo(req, res) {
  try {
    const rawToken = req.query.token;
    if (!rawToken || String(rawToken).length < 16) {
      return res.status(401).json({ error: "Token invalide", code: "PORTAL_TOKEN_INVALID" });
    }

    const row = await findValidPortalTokenRow(String(rawToken));
    if (!row) {
      return res.status(401).json({ error: "Token invalide ou expiré", code: "PORTAL_TOKEN_INVALID" });
    }

    const abs = await resolveOrgLogoAbsolutePath(row.organization_id);
    if (!abs || !fs.existsSync(abs)) {
      return res.status(404).json({ error: "Logo non disponible", code: "LOGO_NOT_FOUND" });
    }

    res.setHeader("Cache-Control", "private, no-store");
    res.sendFile(path.resolve(abs));
  } catch (e) {
    if (e.code === "ENOENT") {
      return res.status(404).json({ error: "Logo non disponible", code: "LOGO_NOT_FOUND" });
    }
    console.error("[clientPortal] getClientPortalOrgLogo", e);
    return res.status(500).json({ error: "Erreur serveur", code: "PORTAL_ERROR" });
  }
}

/**
 * GET /api/client-portal/documents/:documentId/file?token=
 */
export async function getClientPortalDocumentFile(req, res) {
  try {
    const rawToken = req.query.token;
    const { documentId } = req.params;
    if (!rawToken || String(rawToken).length < 16) {
      return res.status(401).json({ error: "Token invalide", code: "PORTAL_TOKEN_INVALID" });
    }

    const row = await findValidPortalTokenRow(String(rawToken));
    if (!row) {
      return res.status(401).json({ error: "Token invalide ou expiré", code: "PORTAL_TOKEN_INVALID" });
    }

    const doc = await assertDocumentInPortalScope(pool, {
      organizationId: row.organization_id,
      leadId: row.lead_id,
      documentId,
    });
    if (!doc) {
      return res.status(403).json({ error: "Accès refusé", code: "PORTAL_DOCUMENT_FORBIDDEN" });
    }

    const abs = getAbsolutePath(doc.storage_key);
    if (!fs.existsSync(abs)) {
      return res.status(404).json({ error: "Fichier introuvable", code: "FILE_NOT_FOUND" });
    }

    const mime = doc.mime_type || "application/octet-stream";
    const safeName = path.basename(doc.file_name || "document");
    res.setHeader("Content-Type", mime);
    res.setHeader("Content-Disposition", `inline; filename*=UTF-8''${encodeURIComponent(safeName)}`);
    res.setHeader("Cache-Control", "private, no-store");

    const stream = fs.createReadStream(abs);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (e) {
    console.error("[clientPortal] getClientPortalDocumentFile", e);
    return res.status(500).json({ error: "Erreur serveur", code: "PORTAL_ERROR" });
  }
}

/**
 * GET /api/leads/:id/client-portal-token (JWT staff) — état du lien actif + URL si disponible.
 */
export async function getClientPortalTokenForLead(req, res) {
  try {
    const { id: leadId } = req.params;
    const org = orgId(req);
    const uid = userId(req);

    const gate = await assertLeadApiAccess(pool, {
      leadId,
      organizationId: org,
      userId: uid,
      mode: "read",
      logContext: "GET /api/leads/:id/client-portal-token",
      req,
    });
    if (!gate.ok) {
      return res.status(gate.status).json(gate.body);
    }

    const row = await findActivePortalTokenRowForLead(pool, { organizationId: org, leadId });
    if (!row) {
      return res.json({
        active: false,
        expires_at: null,
        portal_url: null,
        token: null,
        legacy_without_displayable_secret: false,
      });
    }

    const expiresAt = row.expires_at ? new Date(row.expires_at) : null;
    if (expiresAt && expiresAt <= new Date()) {
      return res.json({
        active: false,
        expired: true,
        expires_at: expiresAt.toISOString(),
        portal_url: null,
        token: null,
        legacy_without_displayable_secret: false,
      });
    }

    if (!row.token_secret) {
      return res.json({
        active: true,
        expires_at: expiresAt ? expiresAt.toISOString() : null,
        portal_url: null,
        token: null,
        legacy_without_displayable_secret: true,
      });
    }

    const portalUrl = buildPortalDisplayUrl(row.token_secret);
    return res.json({
      active: true,
      expires_at: expiresAt ? expiresAt.toISOString() : null,
      portal_url: portalUrl,
      token: portalUrl ? null : row.token_secret,
      legacy_without_displayable_secret: false,
    });
  } catch (e) {
    console.error("[clientPortal] getClientPortalTokenForLead", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}

/**
 * POST /api/leads/:id/client-portal-token (JWT staff)
 */
export async function postCreateClientPortalToken(req, res) {
  try {
    const { id: leadId } = req.params;
    const org = orgId(req);
    const uid = userId(req);

    const gate = await assertLeadApiAccess(pool, {
      leadId,
      organizationId: org,
      userId: uid,
      mode: "write",
      logContext: "POST /api/leads/:id/client-portal-token",
      req,
    });
    if (!gate.ok) {
      return res.status(gate.status).json(gate.body);
    }

    const expiresRaw = req.body?.expires_at;
    const expiresAt =
      expiresRaw != null && String(expiresRaw).trim() !== ""
        ? new Date(expiresRaw)
        : null;
    if (expiresAt && Number.isNaN(expiresAt.getTime())) {
      return res.status(400).json({ error: "expires_at invalide" });
    }

    const { token, expires_at } = await mintClientPortalToken(pool, {
      leadId,
      organizationId: org,
      expiresAt,
    });

    const portalUrl = buildPortalDisplayUrl(token);

    return res.status(201).json({
      token,
      expires_at: expires_at ? expires_at.toISOString() : null,
      portal_url: portalUrl,
    });
  } catch (e) {
    console.error("[clientPortal] postCreateClientPortalToken", e);
    return res.status(500).json({ error: "Erreur serveur" });
  }
}
