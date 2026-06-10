/**
 * CGV (Conditions Générales de Vente) — stockage dans organizations.settings_json.legal.cgv
 * Pas de migration : JSON uniquement.
 */

import crypto from "crypto";
import fs from "fs/promises";
import QRCode from "qrcode";
import { pool } from "../config/db.js";
import { getAbsolutePath } from "./localStorage.service.js";

const VALID_MODES = new Set(["html", "pdf", "url"]);

/** @param {string} html */
export function sanitizeCgvHtml(html) {
  if (html == null || typeof html !== "string") return "";
  let s = html.replace(/<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi, "");
  s = s.replace(/\s(on\w+|javascript:)\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, "");
  return s.trim();
}

function isValidHttpUrl(s) {
  if (s == null || typeof s !== "string") return false;
  const t = s.trim();
  if (!t) return false;
  try {
    const u = new URL(t);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

/**
 * Valide le corps POST et retourne l'objet cgv normalisé (sans écrire en base).
 * @param {unknown} body
 * @returns {{ ok: true, cgv: object } | { ok: false, error: string, status?: number }}
 */
export function validateLegalCgvPayload(body) {
  if (!body || typeof body !== "object") {
    return { ok: false, error: "Corps JSON requis", status: 400 };
  }
  const mode = body.mode;
  if (mode == null || typeof mode !== "string" || !VALID_MODES.has(mode)) {
    return { ok: false, error: "mode requis : html | pdf | url", status: 400 };
  }

  if (mode === "html") {
    const html = body.html;
    if (html == null || typeof html !== "string" || !sanitizeCgvHtml(html)) {
      return { ok: false, error: "html requis et non vide pour mode html", status: 400 };
    }
    return {
      ok: true,
      cgv: {
        mode: "html",
        html: sanitizeCgvHtml(html),
        pdf_document_id: null,
        url: null,
      },
    };
  }

  if (mode === "pdf") {
    const id = body.pdf_document_id;
    if (id == null || typeof id !== "string" || !String(id).trim()) {
      return { ok: false, error: "pdf_document_id requis pour mode pdf", status: 400 };
    }
    return {
      ok: true,
      cgv: {
        mode: "pdf",
        html: null,
        pdf_document_id: String(id).trim(),
        url: null,
      },
    };
  }

  const url = body.url;
  if (url == null || typeof url !== "string" || !isValidHttpUrl(url)) {
    return { ok: false, error: "url http(s) valide requise pour mode url", status: 400 };
  }
  return {
    ok: true,
    cgv: {
      mode: "url",
      html: null,
      pdf_document_id: null,
      url: String(url).trim(),
    },
  };
}

/**
 * @param {string} organizationId
 * @returns {Promise<object|null>} bloc settings_json.legal.cgv ou null
 */
export async function getLegalCgvRaw(organizationId) {
  const r = await pool.query(`SELECT settings_json FROM organizations WHERE id = $1`, [organizationId]);
  if (r.rows.length === 0) return null;
  const settings = r.rows[0].settings_json ?? {};
  const cgv = settings.legal?.cgv;
  if (!cgv || typeof cgv !== "object") return null;
  return cgv;
}

/**
 * Vérifie que pdf_document_id pointe vers un PDF de l'org.
 * @param {string} organizationId
 * @param {string} documentId
 */
export async function assertPdfDocumentIsOrgPdf(organizationId, documentId) {
  const r = await pool.query(
    `SELECT id, mime_type, file_name FROM entity_documents
     WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [documentId, organizationId]
  );
  if (r.rows.length === 0) {
    const e = new Error("Document PDF CGV introuvable");
    e.statusCode = 400;
    throw e;
  }
  const mime = String(r.rows[0].mime_type || "").toLowerCase();
  if (!mime.includes("pdf")) {
    const e = new Error("Le document CGV doit être un PDF");
    e.statusCode = 400;
    throw e;
  }
  return r.rows[0];
}

/**
 * Persiste legal.cgv (merge JSON).
 * @param {string} organizationId
 * @param {object} cgv
 */
export async function saveLegalCgvSettings(organizationId, cgv) {
  const r = await pool.query(`SELECT settings_json FROM organizations WHERE id = $1`, [organizationId]);
  if (r.rows.length === 0) {
    const e = new Error("Organisation introuvable");
    e.statusCode = 404;
    throw e;
  }
  const prev = r.rows[0].settings_json ?? {};
  /* Versionnage : chaque enregistrement date la version des CGV (preuve d'opposabilité). */
  const cgvVersioned = { ...cgv, updated_at: new Date().toISOString() };
  const legal = { ...(typeof prev.legal === "object" && prev.legal !== null ? prev.legal : {}), cgv: cgvVersioned };
  const next = { ...prev, legal };
  await pool.query(`UPDATE organizations SET settings_json = $1::jsonb WHERE id = $2`, [JSON.stringify(next), organizationId]);
  return cgvVersioned;
}

/**
 * Réponse GET API (sans secrets) + nom fichier PDF si présent.
 * @param {string} organizationId
 */
export async function getLegalCgvApiResponse(organizationId) {
  const raw = await getLegalCgvRaw(organizationId);
  if (!raw || !raw.mode) {
    return { cgv: null };
  }
  const mode = raw.mode;
  const out = { mode, html: null, pdf_document_id: null, url: null, pdf_file_name: null, updated_at: typeof raw.updated_at === "string" ? raw.updated_at : null };

  if (mode === "html") {
    out.html = typeof raw.html === "string" ? raw.html : "";
  } else if (mode === "pdf" && raw.pdf_document_id) {
    out.pdf_document_id = raw.pdf_document_id;
    const dr = await pool.query(
      `SELECT file_name FROM entity_documents WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
      [raw.pdf_document_id, organizationId]
    );
    if (dr.rows.length > 0) {
      out.pdf_file_name = dr.rows[0].file_name;
    }
  } else if (mode === "url") {
    out.url = typeof raw.url === "string" ? raw.url : "";
  }

  return { cgv: out };
}

/**
 * Charge les données CGV pour rendu HTML PDF (étude ou devis).
 * @param {string} organizationId
 * @returns {Promise<null | { mode: string, html?: string, url?: string, qr_data_url?: string | null }>}
 */
export async function getLegalCgvForPdfRender(organizationId) {
  const raw = await getLegalCgvRaw(organizationId);
  if (!raw || !raw.mode) return null;

  if (raw.mode === "pdf") {
    return { mode: "pdf" };
  }
  if (raw.mode === "html") {
    const h = sanitizeCgvHtml(typeof raw.html === "string" ? raw.html : "");
    if (!h) return null;
    return { mode: "html", html: h };
  }
  if (raw.mode === "url") {
    const u = typeof raw.url === "string" ? raw.url.trim() : "";
    if (!isValidHttpUrl(u)) return null;
    let qr_data_url = null;
    try {
      qr_data_url = await QRCode.toDataURL(u, { margin: 1, width: 120 });
    } catch {
      qr_data_url = null;
    }
    return { mode: "url", url: u, qr_data_url };
  }
  return null;
}

/**
 * Preuve CGV pour le dossier de signature : mode, date de version, empreinte SHA-256 du contenu.
 * html → hash du HTML assaini ; pdf → hash des octets du fichier ; url → hash de l'URL.
 * @param {string} organizationId
 * @returns {Promise<null | { mode: string, version_date: string | null, sha256: string | null }>}
 */
export async function getLegalCgvEvidence(organizationId) {
  const raw = await getLegalCgvRaw(organizationId);
  if (!raw || !raw.mode) return null;
  const versionDate = typeof raw.updated_at === "string" ? raw.updated_at : null;
  const sha = (input) => crypto.createHash("sha256").update(input).digest("hex");

  if (raw.mode === "html") {
    const h = sanitizeCgvHtml(typeof raw.html === "string" ? raw.html : "");
    return { mode: "html", version_date: versionDate, sha256: h ? sha(Buffer.from(h, "utf8")) : null };
  }
  if (raw.mode === "pdf" && raw.pdf_document_id) {
    try {
      const dr = await pool.query(
        `SELECT storage_key FROM entity_documents WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
        [raw.pdf_document_id, organizationId]
      );
      if (dr.rows.length === 0) return { mode: "pdf", version_date: versionDate, sha256: null };
      const bytes = await fs.readFile(getAbsolutePath(dr.rows[0].storage_key));
      return { mode: "pdf", version_date: versionDate, sha256: sha(bytes) };
    } catch {
      return { mode: "pdf", version_date: versionDate, sha256: null };
    }
  }
  if (raw.mode === "url") {
    const u = typeof raw.url === "string" ? raw.url.trim() : "";
    return { mode: "url", version_date: versionDate, sha256: u ? sha(Buffer.from(u, "utf8")) : null };
  }
  return null;
}
