/**
 * CP-032 — Routes Documents (Stockage Local VPS)
 * CP-032C — withTx, assertOrgEntity (archived → 404)
 * GET /api/documents — liste globale organisation (Document Center, query search|type|limit|offset)
 * POST /api/documents — upload
 * GET /api/documents/:id/download — téléchargement sécurisé
 * GET /api/documents/:entityType/:entityId — liste par entité
 * DELETE /api/documents/:id — suppression physique + DB (transaction)
 */

import express from "express";
import { existsSync } from "fs";
import multer from "multer";
import logger from "../app/core/logger.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import { pool } from "../config/db.js";
import {
  uploadFile as localStorageUpload,
  getAbsolutePath
} from "../services/localStorage.service.js";
import { deleteDocument, listOrganizationDocuments, patchEntityDocument } from "../services/documents.service.js";
import { deleteFile as localStorageDelete } from "../services/localStorage.service.js";
import { archiveEntity, restoreEntity } from "../services/archive.service.js";
import {
  addDocumentApiAliases,
  resolveManualUploadDocumentMeta,
} from "../services/documentMetadata.service.js";
import { sensitiveUserRateLimiter } from "../middleware/security/rateLimit.presets.js";

const router = express.Router();
const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

const ALLOWED_ENTITY_TYPES = ["lead", "client", "study", "quote", "study_version", "organization"];
const MAX_FILE_SIZE = 20 * 1024 * 1024; // 20MB
const FORBIDDEN_EXTENSIONS = [".exe", ".bat", ".sh", ".js", ".php"];

const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE }
});

function getFileExtension(filename) {
  const idx = filename.lastIndexOf(".");
  return idx >= 0 ? filename.slice(idx).toLowerCase() : "";
}

function isForbiddenExtension(filename) {
  const ext = getFileExtension(filename);
  return FORBIDDEN_EXTENSIONS.includes(ext);
}

async function assertEntityInOrg(entityType, entityId, organizationId) {
  if (entityType === "organization") {
    if (entityId !== organizationId) {
      throw new Error("Organisation non trouvée ou n'appartient pas à l'utilisateur");
    }
    return;
  }
  if (entityType === "study_version") {
    const r = await pool.query(
      `SELECT id FROM study_versions WHERE id = $1 AND organization_id = $2`,
      [entityId, organizationId]
    );
    if (r.rows.length === 0) {
      throw new Error("Version d'étude non trouvée ou n'appartient pas à l'organisation");
    }
    return;
  }
  const tables = {
    lead: "leads",
    client: "clients",
    study: "studies",
    quote: "quotes"
  };
  const table = tables[entityType];
  if (!table) throw new Error("entity_type invalide");
  const r = await pool.query(
    `SELECT id FROM ${table} WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)`,
    [entityId, organizationId]
  );
  if (r.rows.length === 0) {
    throw new Error(`Entité ${entityType} non trouvée ou n'appartient pas à l'organisation`);
  }
}

const DOC_PERMS = ["client.read.all", "lead.read.all", "study.manage", "quote.manage", "org.settings.manage"];

/**
 * GET /api/documents — Liste globale organisation (Document Center), paginée.
 * Query: search, type (all|quote|invoice|study|dp|admin|other), limit, offset
 * Doit rester déclaré AVANT /:id/download et /:entityType/:entityId.
 */
router.get("/", verifyJWT, requireAnyPermission(DOC_PERMS), async (req, res) => {
  try {
    const org = orgId(req);
    if (!org) {
      return res.status(403).json({ error: "FORBIDDEN", code: "INVALID_ORG" });
    }
    const search = typeof req.query.search === "string" ? req.query.search : "";
    const type = typeof req.query.type === "string" ? req.query.type : "all";
    const limit = req.query.limit != null ? Number(req.query.limit) : undefined;
    const offset = req.query.offset != null ? Number(req.query.offset) : undefined;

    const listResult = await listOrganizationDocuments({
      organizationId: org,
      search,
      type,
      limit,
      offset,
    });
    const rows = listResult.rows ?? [];
    const total = typeof listResult.total === "number" ? listResult.total : 0;
    const listOk = listResult.success !== false;

    const lim = Math.min(Math.max(Number(limit) || 50, 1), 100);
    const off = Math.max(Number(offset) || 0, 0);

    const documents = rows.map((row) => {
      const base = addDocumentApiAliases(row);
      return {
        ...base,
        entity_type: row.entity_type,
        entity_id: row.entity_id,
        lead_id: row.lead_id ?? null,
        lead_name: row.lead_name ?? null,
        client_name: row.client_name ?? null,
        download_url: `/api/documents/${row.id}/download`,
        updated_at: null,
        is_visible_to_client: row.is_client_visible === true,
      };
    });

    res.json({
      success: listOk,
      documents,
      total,
      limit: lim,
      offset: off,
    });
  } catch (e) {
    console.error("GET /api/documents (liste org):", e);
    res.status(500).json({ error: e.message || "DOCUMENTS_LIST_ERROR" });
  }
});

/**
 * GET /api/documents/:id/download — Téléchargement sécurisé via API
 * Pas d'accès direct aux fichiers
 */
router.get(
  "/:id/download",
  verifyJWT,
  requireAnyPermission(DOC_PERMS),
  async (req, res) => {
    try {
      const org = orgId(req);
      const { id } = req.params;

      const doc = await pool.query(
        `SELECT id, storage_key, file_name, organization_id FROM entity_documents WHERE id = $1 AND (archived_at IS NULL)`,
        [id]
      );

      if (doc.rows.length === 0) {
        return res.status(404).json({ error: "Document non trouvé" });
      }
      if (doc.rows[0].organization_id !== org) {
        return res.status(403).json({ error: "Document n'appartient pas à votre organisation" });
      }

      const storageKey = doc.rows[0].storage_key;
      const displayName = doc.rows[0].file_name;
      const filePath = getAbsolutePath(storageKey);

      logger.info("DOCUMENT_DOWNLOAD_START", {
        documentId: id,
        storageKey,
        filePath,
        organizationId: org,
        fileName: displayName,
      });

      if (!existsSync(filePath)) {
        logger.error("DOCUMENT_DOWNLOAD_FILE_MISSING", {
          documentId: id,
          storageKey,
          filePath,
          organizationId: org,
        });
        return res.status(404).json({ error: "Fichier non trouvé sur le disque" });
      }

      res.download(filePath, displayName);
    } catch (e) {
      if (e.code === "ENOENT") {
        return res.status(404).json({ error: "Fichier non trouvé sur le disque" });
      }
      res.status(400).json({ error: e.message || "Erreur téléchargement" });
    }
  }
);

/**
 * POST /api/documents
 * multipart/form-data: entityType, entityId, file [, document_type]
 * document_type optionnel : ex. "consumption_csv" pour CSV conso depuis le CRM
 */
router.post(
  "/",
  verifyJWT,
  requireAnyPermission(DOC_PERMS),
  sensitiveUserRateLimiter,
  upload.single("file"),
  async (req, res) => {
    try {
      const org = orgId(req);
      const uid = userId(req);
      const entityType = (req.body.entityType || "").toLowerCase().trim();
      const entityId = req.body.entityId?.trim();

      if (!ALLOWED_ENTITY_TYPES.includes(entityType)) {
        return res.status(400).json({ error: "entity_type invalide (lead|client|study|quote|study_version|organization)" });
      }
      if (!entityId) {
        return res.status(400).json({ error: "entityId requis" });
      }
      if (!req.file || !req.file.buffer) {
        return res.status(400).json({ error: "Fichier requis" });
      }
      const originalName = req.file.originalname || "document";

      if (isForbiddenExtension(originalName)) {
        return res.status(400).json({ error: "Extension de fichier non autorisée" });
      }

      await assertEntityInOrg(entityType, entityId, org);

      const allowedDocumentTypes = [
        "consumption_csv",
        "lead_attachment",
        "study_attachment",
        "study_pdf",
        "organization_pdf_cover",
        "organization_legal_cgv",
        "organization_legal_rge",
        "organization_legal_decennale",
        "dp_pdf"
      ];
      let documentType = (req.body.document_type || "").trim() || null;
      if (documentType && !allowedDocumentTypes.includes(documentType)) {
        return res.status(400).json({ error: "INVALID_DOCUMENT_TYPE" });
      }
      // Si fichier .csv sur lead ou study et pas de document_type fourni → consumption_csv (pour que le resolver le trouve)
      if (!documentType && (entityType === "lead" || entityType === "study") && originalName.toLowerCase().endsWith(".csv")) {
        documentType = "consumption_csv";
      }
      const orgSinglePdfTypes = [
        "organization_legal_cgv",
        "organization_legal_rge",
        "organization_legal_decennale",
      ];
      // Pour organization : couverture PDF (image) ou documents légaux (PDF)
      if (entityType === "organization") {
        const orgAllowed =
          documentType === "organization_pdf_cover" || orgSinglePdfTypes.includes(documentType);
        if (!orgAllowed) {
          return res.status(400).json({
            error:
              "Pour une organisation, document_type doit être organization_pdf_cover, organization_legal_cgv, organization_legal_rge ou organization_legal_decennale",
          });
        }
        if (documentType === "organization_pdf_cover") {
          const old = await pool.query(
            `SELECT id, storage_key FROM entity_documents
             WHERE organization_id = $1 AND entity_type = 'organization' AND document_type = 'organization_pdf_cover' AND (archived_at IS NULL)`,
            [org]
          );
          for (const row of old.rows) {
            try {
              await localStorageDelete(row.storage_key);
            } catch (_) {}
            await pool.query("DELETE FROM entity_documents WHERE id = $1", [row.id]);
          }
        } else if (documentType === "organization_legal_cgv") {
          if (!String(req.file.mimetype || "").toLowerCase().includes("pdf")) {
            return res.status(400).json({ error: "Le fichier CGV doit être un PDF" });
          }
          const oldCgv = await pool.query(
            `SELECT id, storage_key FROM entity_documents
             WHERE organization_id = $1 AND entity_type = 'organization' AND document_type = 'organization_legal_cgv' AND (archived_at IS NULL)`,
            [org]
          );
          for (const row of oldCgv.rows) {
            try {
              await localStorageDelete(row.storage_key);
            } catch (_) {}
            await pool.query("DELETE FROM entity_documents WHERE id = $1", [row.id]);
          }
        } else if (documentType === "organization_legal_rge" || documentType === "organization_legal_decennale") {
          if (!String(req.file.mimetype || "").toLowerCase().includes("pdf")) {
            return res.status(400).json({ error: "Le fichier doit être un PDF" });
          }
          const oldRows = await pool.query(
            `SELECT id, storage_key FROM entity_documents
             WHERE organization_id = $1 AND entity_type = 'organization' AND document_type = $2 AND (archived_at IS NULL)`,
            [org, documentType]
          );
          for (const row of oldRows.rows) {
            try {
              await localStorageDelete(row.storage_key);
            } catch (_) {}
            await pool.query("DELETE FROM entity_documents WHERE id = $1", [row.id]);
          }
        }
      }

      const { storage_path, file_name } = await localStorageUpload(
        req.file.buffer,
        org,
        entityType,
        entityId,
        originalName
      );

      const metaRes = resolveManualUploadDocumentMeta(documentType, req.body);
      if (!metaRes.ok) {
        return res.status(400).json({ error: metaRes.error });
      }
      const bm = metaRes.meta;

      const ins = await pool.query(
        `INSERT INTO entity_documents
         (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type,
          document_category, source_type, is_client_visible, display_name, description)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15)
         RETURNING id, file_name, file_size, mime_type, created_at, storage_key,
                   document_category, source_type, is_client_visible, display_name, description`,
        [
          org,
          entityType,
          entityId,
          originalName,
          req.file.size,
          req.file.mimetype || "application/octet-stream",
          storage_path,
          "local",
          uid,
          documentType,
          bm.document_category,
          bm.source_type,
          bm.is_client_visible,
          bm.display_name,
          bm.description,
        ]
      );

      const row = ins.rows[0];
      if (documentType === "organization_legal_cgv") {
        const { saveLegalCgvSettings } = await import("../services/legalCgv.service.js");
        await saveLegalCgvSettings(org, {
          mode: "pdf",
          html: null,
          url: null,
          pdf_document_id: row.id,
        });
      }
      const payload = {
        id: row.id,
        file_name: row.file_name,
        file_size: row.file_size,
        mime_type: row.mime_type,
        created_at: row.created_at,
        document_type: documentType,
      };
      if (row.storage_key) payload.storage_key = row.storage_key;
      res.status(201).json(addDocumentApiAliases({ ...payload, ...row }));
    } catch (e) {
      res.status(400).json({ error: e.message || "Erreur upload" });
    }
  }
);

/**
 * GET /api/documents/:entityType/:entityId
 */
router.get(
  "/:entityType/:entityId",
  verifyJWT,
  requireAnyPermission(DOC_PERMS),
  async (req, res) => {
    try {
      const org = orgId(req);
      const { entityType, entityId } = req.params;
      const type = (entityType || "").toLowerCase();

      if (!ALLOWED_ENTITY_TYPES.includes(type)) {
        return res.status(400).json({ error: "entity_type invalide" });
      }

      await assertEntityInOrg(type, entityId, org);

      const r = await pool.query(
        `SELECT id, file_name, file_size, mime_type, created_at, document_type,
                document_category, source_type, is_client_visible, display_name, description
         FROM entity_documents
         WHERE organization_id = $1 AND entity_type = $2 AND entity_id = $3 AND (archived_at IS NULL)
         ORDER BY created_at DESC`,
        [org, type, entityId]
      );

      res.json(r.rows.map((row) => addDocumentApiAliases(row)));
    } catch (e) {
      res.status(400).json({ error: e.message || "Erreur" });
    }
  }
);

/**
 * PATCH /api/documents/:id — champs whitelistés (ex. is_client_visible)
 */
router.patch(
  "/:id",
  verifyJWT,
  requireAnyPermission(DOC_PERMS),
  async (req, res) => {
    try {
      const org = orgId(req);
      const row = await patchEntityDocument(org, req.params.id, req.body || {});
      res.json(addDocumentApiAliases(row));
    } catch (e) {
      const code = e.statusCode === 404 ? 404 : e.statusCode === 400 ? 400 : 500;
      res.status(code).json({ error: e.message || "Erreur" });
    }
  }
);

/**
 * PATCH /api/documents/:id/archive
 */
router.patch(
  "/:id/archive",
  verifyJWT,
  requireAnyPermission(DOC_PERMS),
  async (req, res) => {
    try {
      const org = orgId(req);
      const uid = userId(req);
      const data = await archiveEntity("entity_documents", req.params.id, org, uid);
      if (!data) return res.status(404).json({ error: "Document non trouvé" });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/**
 * PATCH /api/documents/:id/restore
 */
router.patch(
  "/:id/restore",
  verifyJWT,
  requireAnyPermission(DOC_PERMS),
  async (req, res) => {
    try {
      const org = orgId(req);
      const data = await restoreEntity("entity_documents", req.params.id, org);
      if (!data) return res.status(404).json({ error: "Document non trouvé" });
      res.json(data);
    } catch (e) {
      res.status(400).json({ error: e.message });
    }
  }
);

/**
 * DELETE /api/documents/:id
 * Transaction : delete file puis DB. Si file delete échoue → rollback DB (doc conservé)
 * 404 si document archivé
 */
router.delete(
  "/:id",
  verifyJWT,
  requireAnyPermission(DOC_PERMS),
  async (req, res) => {
    try {
      const org = orgId(req);
      const { id } = req.params;
      await deleteDocument(id, org);
      res.status(204).send();
    } catch (e) {
      const code = e.statusCode || 500;
      res.status(code).json({ error: e.message || "Erreur" });
    }
  }
);

export default router;
