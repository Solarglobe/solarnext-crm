/**
 * CP-027 — Admin Organization Controller
 * CP-ADMIN-ORG-04 — Structure complète (identité, adresse, contact, facturation, branding)
 */

import path from "path";
import { pool } from "../config/db.js";
import { getAbsolutePath } from "../services/localStorage.service.js";
import { deleteDocument } from "../services/documents.service.js";
import logger from "../app/core/logger.js";

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;

const ORG_COLUMNS = [
  "id", "name", "settings_json", "created_at",
  "legal_name", "trade_name", "siret", "vat_number", "rcs", "capital_amount",
  "address_line1", "address_line2", "postal_code", "city", "country",
  "phone", "email", "website",
  "iban", "bic", "bank_name",
  "default_payment_terms", "default_invoice_notes",
  "default_quote_validity_days", "default_invoice_due_days", "default_vat_rate",
  "quote_prefix", "invoice_prefix",
  "logo_url", "logo_dark_url", "pdf_primary_color", "pdf_secondary_color",
  "pdf_cover_image_key",
];

const PUT_FIELDS = {
  name: "string",
  settings_json: "object",
  legal_name: "string",
  trade_name: "string",
  siret: "string",
  vat_number: "string",
  rcs: "string",
  capital_amount: "string",
  address_line1: "string",
  address_line2: "string",
  postal_code: "string",
  city: "string",
  country: "string",
  phone: "string",
  email: "string",
  website: "string",
  iban: "string",
  bic: "string",
  bank_name: "string",
  default_payment_terms: "string",
  default_invoice_notes: "string",
  default_quote_validity_days: "number",
  default_invoice_due_days: "number",
  default_vat_rate: "number",
  quote_prefix: "string",
  invoice_prefix: "string",
  logo_url: "string",
  logo_dark_url: "string",
  pdf_primary_color: "string",
  pdf_secondary_color: "string",
  pdf_cover_image_key: "string",
};

function toStr(v) {
  return v == null ? null : String(v);
}

function toNum(v) {
  if (v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

/**
 * GET /api/admin/org
 * Retourne l'organisation courante (tous les champs).
 */
export async function get(req, res) {
  try {
    const org = orgId(req);
    const result = await pool.query(
      `SELECT ${ORG_COLUMNS.join(", ")} FROM organizations WHERE id = $1`,
      [org]
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Organisation non trouvée" });
    }
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * PUT /api/admin/org
 * Met à jour l'organisation courante.
 * Update uniquement les champs envoyés. Ne pas écraser settings_json si non fourni.
 */
export async function update(req, res) {
  try {
    const org = orgId(req);
    const body = req.body || {};

    const updates = [];
    const values = [];
    let idx = 1;

    for (const [key, expectedType] of Object.entries(PUT_FIELDS)) {
      if (!(key in body)) continue;

      const v = body[key];

      if (key === "settings_json") {
        if (typeof v !== "object" || v === null) {
          return res.status(400).json({ error: "settings_json doit être un objet JSON" });
        }
        updates.push(`settings_json = $${idx++}::jsonb`);
        values.push(JSON.stringify(v));
        continue;
      }

      if (expectedType === "number") {
        const n = toNum(v);
        if (n !== null && (n < 0 || (key.includes("days") && n > 365))) {
          return res.status(400).json({ error: `Valeur invalide pour ${key}` });
        }
        updates.push(`${key} = $${idx++}`);
        values.push(n);
      } else {
        updates.push(`${key} = $${idx++}`);
        values.push(v == null ? null : toStr(v));
      }
    }

    if (updates.length === 0) {
      const current = await pool.query(
        `SELECT ${ORG_COLUMNS.join(", ")} FROM organizations WHERE id = $1`,
        [org]
      );
      if (current.rows.length === 0) {
        return res.status(404).json({ error: "Organisation non trouvée" });
      }
      return res.json(current.rows[0]);
    }

    values.push(org);
    const result = await pool.query(
      `UPDATE organizations SET ${updates.join(", ")} WHERE id = $${idx} RETURNING ${ORG_COLUMNS.join(", ")}`,
      values
    );
    if (result.rows.length === 0) {
      return res.status(404).json({ error: "Organisation non trouvée" });
    }
    res.json(result.rows[0]);
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * POST /api/admin/org/logo
 * Upload logo — multer fournit req.file
 */
export async function uploadLogo(req, res) {
  try {
    const org = orgId(req);
    const file = req.file;
    if (!file) {
      return res.status(400).json({ error: "Fichier manquant" });
    }

    const { validateLogoFile, saveLogo, deleteLogo } = await import("../services/orgLogo.service.js");
    validateLogoFile(file);

    await deleteLogo(org);
    const raw = file.originalname || "logo.png";
    const ext = raw.includes(".") ? raw.slice(raw.lastIndexOf(".")).toLowerCase() : ".png";
    await saveLogo(file.buffer, org, ext);

    const logoUrl = "/api/admin/org/logo";
    await pool.query(
      "UPDATE organizations SET logo_url = $1 WHERE id = $2 RETURNING id, logo_url",
      [logoUrl, org]
    );

    logger.info({ event: "org_logo_upload_ok", organizationId: org }, "POST /api/admin/org/logo OK");
    res.json({ logo_url: logoUrl });
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
}

/**
 * GET /api/admin/org/logo
 * Sert le fichier logo (pour affichage img via fetch + objectURL)
 */
export async function getLogo(req, res) {
  try {
    const org = orgId(req);
    const r = await pool.query(
      "SELECT settings_json FROM organizations WHERE id = $1",
      [org]
    );
    if (r.rows.length > 0) {
      const settings = r.rows[0].settings_json ?? {};
      const logoKey = settings.logo_image_key;
      if (logoKey) {
        const filePath = getAbsolutePath(logoKey);
        return res.sendFile(path.resolve(filePath));
      }
    }
    const { getLogoPath } = await import("../services/orgLogo.service.js");
    const filePath = await getLogoPath(org);
    if (!filePath) {
      return res.status(404).json({ error: "Logo non trouvé" });
    }
    res.sendFile(path.resolve(filePath));
  } catch (e) {
    if (e.code === "ENOENT") {
      return res.status(404).json({ error: "Fichier logo non trouvé" });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/admin/org/logo
 * Supprime le logo
 */
export async function deleteLogo(req, res) {
  try {
    const org = orgId(req);
    const { deleteLogo: deleteLogoFile } = await import("../services/orgLogo.service.js");
    await deleteLogoFile(org);
    await pool.query(
      "UPDATE organizations SET logo_url = NULL WHERE id = $1 RETURNING id",
      [org]
    );
    res.json({ ok: true });
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
}

/**
 * GET /api/admin/org/pdf-cover
 * Sert l'image de couverture PDF (storage_key entity_documents)
 */
export async function getPdfCover(req, res) {
  try {
    const org = orgId(req);
    const r = await pool.query(
      "SELECT pdf_cover_image_key, settings_json FROM organizations WHERE id = $1",
      [org]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Organisation non trouvée" });
    }
    const settings = r.rows[0].settings_json ?? {};
    const storageKey = settings.pdf_cover_image_key || r.rows[0].pdf_cover_image_key;
    if (!storageKey) {
      return res.status(404).json({ error: "Image de couverture PDF non trouvée" });
    }
    const filePath = getAbsolutePath(storageKey);
    res.sendFile(path.resolve(filePath));
  } catch (e) {
    if (e.code === "ENOENT") {
      return res.status(404).json({ error: "Fichier non trouvé" });
    }
    res.status(500).json({ error: e.message });
  }
}

/**
 * DELETE /api/admin/org/pdf-cover
 * Supprime l'image de couverture PDF (entity_documents + organizations.pdf_cover_image_key)
 */
export async function deletePdfCover(req, res) {
  try {
    const org = orgId(req);
    const r = await pool.query(
      "SELECT pdf_cover_image_key, settings_json FROM organizations WHERE id = $1",
      [org]
    );
    if (r.rows.length === 0) {
      return res.status(404).json({ error: "Organisation non trouvée" });
    }
    const settings = r.rows[0].settings_json ?? {};
    const storageKey = settings.pdf_cover_image_key || r.rows[0].pdf_cover_image_key;
    if (!storageKey) {
      return res.status(404).json({ error: "Image de couverture PDF non trouvée" });
    }
    const docRes = await pool.query(
      `SELECT id FROM entity_documents
       WHERE organization_id = $1 AND entity_type = 'organization' AND storage_key = $2 AND (archived_at IS NULL)`,
      [org, storageKey]
    );
    if (docRes.rows.length > 0) {
      try {
        await deleteDocument(docRes.rows[0].id, org);
      } catch (delErr) {
        // Fichier peut être absent sur disque, on continue pour nettoyer la DB
      }
    }
    await pool.query(
      "UPDATE organizations SET pdf_cover_image_key = NULL WHERE id = $1",
      [org]
    );
    if (settings.pdf_cover_image_key) {
      await pool.query(
        "UPDATE organizations SET settings_json = COALESCE(settings_json, '{}'::jsonb) || $1::jsonb WHERE id = $2",
        [JSON.stringify({ pdf_cover_image_key: null }), org]
      );
    }
    res.json({ ok: true });
  } catch (e) {
    res.status(e.statusCode === 404 ? 404 : 500).json({ error: e.message });
  }
}
