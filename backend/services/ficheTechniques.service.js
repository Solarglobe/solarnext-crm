/**
 * Fiches techniques — catalogue PDF par organisation (stockage local, prêt S3 : clé logique `storageKey` ↔ colonne DB `file_url`).
 */

import fs from "fs/promises";
import { existsSync } from "fs";
import path from "path";
import { randomUUID } from "crypto";
import { pool } from "../config/db.js";
import {
  uploadFile as localStorageUpload,
  getAbsolutePath,
  deleteFile as localStorageDelete,
} from "./localStorage.service.js";
import { normalizeMultipartFilename } from "../utils/multipartFilenameUtf8.js";
import { sendMailViaSmtp } from "./mail/smtp.service.js";
import { canSendMailAccount, getAccessibleMailAccountIds } from "./mailAccess.service.js";
import {
  FICHE_TECHNIQUE_CATEGORY_IDS,
  FICHE_TECHNIQUE_CATEGORY_ID_SET,
  FICHE_TECHNIQUE_CATEGORY_META,
} from "./ficheTechniques.constants.js";

export { FICHE_TECHNIQUE_CATEGORY_IDS, FICHE_TECHNIQUE_CATEGORY_META, FICHE_TECHNIQUE_CATEGORY_ID_SET };

const MAX_PDF_BYTES = 10 * 1024 * 1024;

const ALLOWED_STATUS = new Set(["active", "obsolete", "recommended"]);

const SORT_COLUMNS = new Set(["name", "created_at"]);
const SORT_ORDERS = new Set(["asc", "desc"]);

/**
 * Nom fichier disque : UUID + suffixe nettoyé (pas d’URL ambiguë, prêt volume/S3).
 * @param {string} originalName
 */
export function buildSafeDiskFileName(originalName) {
  const raw = normalizeMultipartFilename(String(originalName || "").trim()) || String(originalName || "").trim() || "fiche.pdf";
  const base = path.basename(raw).toLowerCase();
  const clean = base
    .replace(/[^a-z0-9.-]/g, "-")
    .replace(/-+/g, "-")
    .replace(/^-+|-+$/g, "");
  const stem = clean && clean !== ".pdf" ? clean : "fiche";
  const withExt = stem.endsWith(".pdf") ? stem : `${stem}.pdf`;
  return `${randomUUID()}_${withExt}`;
}

function err(statusCode, code, message) {
  const e = new Error(message);
  e.statusCode = statusCode;
  e.code = code;
  return e;
}

function err404(msg) {
  return err(404, "NOT_FOUND", msg);
}

/**
 * Ligne DB → domaine applicatif (ne jamais exposer `file_url` comme nom de variable métier).
 * @param {Record<string, unknown>} row
 */
function mapDbRow(row) {
  if (!row) return null;
  const storageKey = row.file_url;
  return {
    id: row.id,
    name: row.name,
    reference: row.reference,
    brand: row.brand,
    category: row.category,
    status: row.status,
    file_name: row.file_name,
    created_at: row.created_at,
    is_favorite: row.is_favorite,
    organization_id: row.organization_id,
    storageKey,
  };
}

/**
 * @param {Buffer} buffer
 */
export function assertPdfBuffer(buffer) {
  if (!Buffer.isBuffer(buffer) || buffer.length === 0) {
    throw err(400, "INVALID_FILE_TYPE", "Fichier PDF vide ou invalide");
  }
  if (buffer.length > MAX_PDF_BYTES) {
    throw err(400, "FILE_TOO_LARGE", "Fichier trop volumineux (max 10 Mo)");
  }
  if (buffer.slice(0, 5).toString("ascii") !== "%PDF-") {
    throw err(400, "INVALID_FILE_TYPE", "Le fichier doit être un PDF valide");
  }
}

/**
 * @param {string} organizationId
 * @param {{
 *   category?: string | null,
 *   search?: string | null,
 *   brand?: string | null,
 *   status?: string | null,
 *   limit?: number,
 *   offset?: number,
 *   sortBy?: string,
 *   sortOrder?: string,
 * }} [opts]
 */
export async function listFicheTechniques(organizationId, opts = {}) {
  const {
    category = null,
    search = null,
    brand = null,
    status = null,
    limit = 20,
    offset = 0,
    sortBy = "created_at",
    sortOrder = "desc",
  } = opts;

  const lim = Math.min(Math.max(Number(limit) || 20, 1), 100);
  const off = Math.max(Number(offset) || 0, 0);

  const col = SORT_COLUMNS.has(String(sortBy)) ? String(sortBy) : "created_at";
  const dir = SORT_ORDERS.has(String(sortOrder).toLowerCase()) ? String(sortOrder).toUpperCase() : "DESC";

  const params = [organizationId];
  let where = "WHERE organization_id = $1";

  if (category) {
    const c = String(category).trim();
    if (!FICHE_TECHNIQUE_CATEGORY_ID_SET.has(c)) {
      throw err(400, "INVALID_CATEGORY", "Catégorie inconnue");
    }
    params.push(c);
    where += ` AND category = $${params.length}`;
  }

  if (search && String(search).trim()) {
    const q = `%${String(search).trim()}%`;
    params.push(q);
    where += ` AND (name ILIKE $${params.length} OR reference ILIKE $${params.length} OR (brand IS NOT NULL AND brand ILIKE $${params.length}))`;
  }

  if (brand && String(brand).trim()) {
    params.push(String(brand).trim());
    where += ` AND brand = $${params.length}`;
  }

  if (status && String(status).trim()) {
    const st = String(status).trim();
    if (!ALLOWED_STATUS.has(st)) {
      throw err(400, "INVALID_STATUS", "Statut filtre invalide");
    }
    params.push(st);
    where += ` AND status = $${params.length}`;
  }

  const countR = await pool.query(`SELECT count(*)::int AS n FROM fiche_techniques ${where}`, params);
  const total = countR.rows[0]?.n ?? 0;

  const dataParams = [...params, lim, off];
  const limIdx = dataParams.length - 1;
  const offIdx = dataParams.length;
  const orderSql = `ORDER BY ${col === "name" ? "name" : "created_at"} ${dir === "ASC" ? "ASC" : "DESC"}`;

  const r = await pool.query(
    `SELECT id, name, reference, brand, category, status, file_url, file_name, created_at, is_favorite
     FROM fiche_techniques
     ${where}
     ${orderSql}
     LIMIT $${limIdx} OFFSET $${offIdx}`,
    dataParams
  );

  const data = r.rows.map((row) => mapDbRow(row));
  return { data, total, limit: lim, offset: off };
}

/**
 * @param {string} organizationId
 * @param {string} id
 */
export async function getFicheTechniqueRow(organizationId, id) {
  const r = await pool.query(
    `SELECT id, name, reference, brand, category, status, file_url, file_name, created_at, is_favorite, organization_id
     FROM fiche_techniques WHERE id = $1 AND organization_id = $2`,
    [id, organizationId]
  );
  if (r.rows.length === 0) return null;
  return mapDbRow(r.rows[0]);
}

/**
 * @param {{
 *   organizationId: string,
 *   userId: string | null,
 *   name: string,
 *   reference: string,
 *   brand?: string | null,
 *   category: string,
 *   status: string,
 *   fileBuffer: Buffer,
 *   originalFilename: string,
 * }} p
 */
export async function createFicheTechnique(p) {
  const { organizationId, userId, name, reference, brand, category, status, fileBuffer, originalFilename } = p;
  const nm = String(name || "").trim();
  const ref = String(reference || "").trim();
  if (!nm) throw err(400, "VALIDATION_ERROR", "Nom requis");
  if (!ref) throw err(400, "VALIDATION_ERROR", "Référence requise");
  const cat = String(category || "").trim();
  if (!FICHE_TECHNIQUE_CATEGORY_ID_SET.has(cat)) {
    throw err(400, "INVALID_CATEGORY", "Catégorie invalide");
  }
  const st = String(status || "active").trim();
  if (!ALLOWED_STATUS.has(st)) throw err(400, "INVALID_STATUS", "Statut invalide");
  assertPdfBuffer(fileBuffer);

  const rawName = String(originalFilename || "").trim();
  const dec = normalizeMultipartFilename(rawName) || rawName || "fiche.pdf";
  if (!dec.toLowerCase().endsWith(".pdf")) {
    throw err(400, "INVALID_FILE_TYPE", "Extension .pdf requise");
  }

  const diskFileName = buildSafeDiskFileName(dec);
  const displayFileName = path.basename(dec).replace(/\0/g, "").slice(0, 255) || "fiche.pdf";

  const { storage_path: storageKey } = await localStorageUpload(
    fileBuffer,
    organizationId,
    "organization",
    organizationId,
    dec,
    { diskFileName }
  );

  try {
    const ins = await pool.query(
      `INSERT INTO fiche_techniques (
        organization_id, name, reference, brand, category, status, file_url, file_name, is_favorite, created_by
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, false, $9)
      RETURNING id, file_url`,
      [organizationId, nm, ref, brand != null && String(brand).trim() ? String(brand).trim() : null, cat, st, storageKey, displayFileName, userId || null]
    );
    const row = ins.rows[0];
    return { id: row.id, storageKey: row.file_url };
  } catch (e) {
    try {
      await localStorageDelete(storageKey);
    } catch (_) {
      /* ignore */
    }
    throw e;
  }
}

/**
 * @param {string} organizationId
 * @param {string} id
 * @param {boolean} isFavorite
 */
export async function updateFavorite(organizationId, id, isFavorite) {
  const r = await pool.query(
    `UPDATE fiche_techniques SET is_favorite = $3 WHERE id = $1 AND organization_id = $2
     RETURNING id, is_favorite`,
    [id, organizationId, !!isFavorite]
  );
  if (r.rows.length === 0) throw err404("Fiche technique introuvable");
  return r.rows[0];
}

/**
 * @param {string} organizationId
 * @param {string} id
 */
export async function readFicheFileStreamContext(organizationId, id) {
  const row = await getFicheTechniqueRow(organizationId, id);
  if (!row) throw err404("Fiche technique introuvable");
  const filePath = getAbsolutePath(row.storageKey);
  const displayName = String(row.file_name || "fiche.pdf").trim() || "fiche.pdf";
  if (!existsSync(filePath)) {
    const e = new Error("Fichier non trouvé sur le disque");
    e.statusCode = 404;
    e.code = "FILE_NOT_ON_DISK";
    throw e;
  }
  return { filePath, displayName, mimeType: "application/pdf" };
}

async function pickSendableMailAccountId(p) {
  const { userId, organizationId, preferredMailAccountId } = p;
  if (preferredMailAccountId) {
    const ok = await canSendMailAccount({
      userId,
      organizationId,
      mailAccountId: String(preferredMailAccountId),
    });
    if (ok) return String(preferredMailAccountId);
  }
  const ids = await getAccessibleMailAccountIds({ userId, organizationId });
  for (const mid of ids) {
    if (await canSendMailAccount({ userId, organizationId, mailAccountId: mid })) {
      return mid;
    }
  }
  return null;
}

/**
 * @param {{
 *   organizationId: string,
 *   userId: string,
 *   ficheId: string,
 *   to: string,
 *   mailAccountId?: string | null,
 * }} p
 */
export async function sendFicheTechniquePdfEmail(p) {
  const { organizationId, userId, ficheId, to, mailAccountId: preferredMailAccountId } = p;
  const row = await getFicheTechniqueRow(organizationId, ficheId);
  if (!row) throw err404("Fiche technique introuvable");

  const toList = String(to || "")
    .split(/[,;]/)
    .map((s) => s.trim())
    .filter(Boolean);
  if (!toList.length) {
    throw err(400, "VALIDATION_ERROR", "Adresse email destinataire requise");
  }

  const mailAccountId = await pickSendableMailAccountId({
    userId,
    organizationId,
    preferredMailAccountId: preferredMailAccountId || null,
  });
  if (!mailAccountId) {
    const e = new Error(
      "Aucun compte mail disponible pour l'envoi. Ajoutez une boîte ou une délégation d'envoi, ou précisez mail_account_id."
    );
    e.statusCode = 400;
    e.code = "MAIL_ACCOUNT_REQUIRED";
    throw e;
  }

  const { filePath } = await readFicheFileStreamContext(organizationId, ficheId);
  const pdfBuffer = await fs.readFile(filePath);
  assertPdfBuffer(pdfBuffer);

  const attachName = `${String(row.reference || "fiche").replace(/[/\\?%*:|"<>]/g, "_")}.pdf`;

  const subject = `Fiche technique – ${row.name}`;
  const bodyText =
    "Bonjour,\n\nVeuillez trouver ci-joint la fiche technique.\n\nCordialement,\n";
  const bodyHtml =
    "<p>Bonjour,</p><p>Veuillez trouver ci-joint la fiche technique.</p><p>Cordialement,</p>";

  return sendMailViaSmtp({
    mailAccountId,
    organizationId,
    actorUserId: userId,
    to: toList,
    subject,
    bodyText,
    bodyHtml,
    attachments: [
      {
        filename: attachName,
        content: pdfBuffer,
        contentType: "application/pdf",
      },
    ],
  });
}
