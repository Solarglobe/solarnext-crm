/**
 * Fiches techniques PDF — liste paginée + meta + upload + download + favoris + envoi.
 */

import express from "express";
import multer from "multer";
import { createReadStream, existsSync } from "fs";
import logger from "../app/core/logger.js";
import { verifyJWT } from "../middleware/auth.middleware.js";
import { requireAnyPermission } from "../rbac/rbac.middleware.js";
import { requireMailUseStrict } from "../middleware/mailAccess.middleware.js";
import { sensitiveUserRateLimiter } from "../middleware/security/rateLimit.presets.js";
import {
  listFicheTechniques,
  createFicheTechnique,
  updateFavorite,
  readFicheFileStreamContext,
  sendFicheTechniquePdfEmail,
} from "../services/ficheTechniques.service.js";
import { FICHE_TECHNIQUE_CATEGORY_META } from "../services/ficheTechniques.constants.js";
import { SmtpErrorCodes, mapSmtpError } from "../services/mail/smtp.service.js";

const router = express.Router();

const DOC_PERMS = ["client.read.all", "lead.read.all", "study.manage", "quote.manage", "org.settings.manage"];

const orgId = (req) => req.user.organizationId ?? req.user.organization_id;
const userId = (req) => req.user.userId ?? req.user.id;

const MAX_FILE_SIZE = 10 * 1024 * 1024;
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: MAX_FILE_SIZE },
});

function jsonError(res, status, code, message) {
  const body = { error: code };
  if (message) body.message = message;
  return res.status(status).json(body);
}

function smtpHttpStatus(code) {
  if (code === SmtpErrorCodes.AUTH_FAILED) return 401;
  if (code === SmtpErrorCodes.SMTP_UNAVAILABLE) return 503;
  if (code === SmtpErrorCodes.INVALID_CONFIG) return 400;
  if (code === SmtpErrorCodes.SEND_FAILED) return 502;
  return 500;
}

function handleSmtpRouteError(res, err) {
  if (err?.code && Object.values(SmtpErrorCodes).includes(err.code)) {
    return res.status(smtpHttpStatus(err.code)).json({
      success: false,
      code: err.code,
      message: err.message,
    });
  }
  try {
    mapSmtpError(err);
  } catch (e2) {
    if (e2?.code && Object.values(SmtpErrorCodes).includes(e2.code)) {
      return res.status(smtpHttpStatus(e2.code)).json({
        success: false,
        code: e2.code,
        message: e2.message,
      });
    }
  }
  return res.status(500).json({ success: false, code: "UNKNOWN", message: String(err) });
}

/** Catégories canoniques (source unique pour le front). */
router.get("/meta", verifyJWT, requireAnyPermission(DOC_PERMS), (req, res) => {
  res.json({ success: true, categories: [...FICHE_TECHNIQUE_CATEGORY_META] });
});

router.get("/", verifyJWT, requireAnyPermission(DOC_PERMS), async (req, res) => {
  try {
    const org = orgId(req);
    if (!org) return jsonError(res, 403, "FORBIDDEN", "Organisation invalide");

    const category = typeof req.query.category === "string" ? req.query.category.trim() : "";
    const search = typeof req.query.search === "string" ? req.query.search : "";
    const brand = typeof req.query.brand === "string" ? req.query.brand.trim() : "";
    const status = typeof req.query.status === "string" ? req.query.status.trim() : "";
    const limit = req.query.limit != null ? Number(req.query.limit) : 20;
    const offset = req.query.offset != null ? Number(req.query.offset) : 0;
    const sortBy = typeof req.query.sort_by === "string" ? req.query.sort_by.trim() : "created_at";
    const sortOrder = typeof req.query.sort_order === "string" ? req.query.sort_order.trim() : "desc";

    const result = await listFicheTechniques(org, {
      category: category || null,
      search: search.trim() || null,
      brand: brand || null,
      status: status || null,
      limit,
      offset,
      sortBy,
      sortOrder,
    });

    const data = result.data.map((r) => ({
      id: r.id,
      name: r.name,
      reference: r.reference,
      brand: r.brand,
      category: r.category,
      status: r.status,
      file_name: r.file_name,
      created_at: r.created_at,
      is_favorite: r.is_favorite === true,
      download_url: `/api/fiche-techniques/${r.id}/download`,
    }));

    res.json({
      success: true,
      data,
      total: result.total,
      limit: result.limit,
      offset: result.offset,
    });
  } catch (e) {
    const sc = e.statusCode === 400 ? 400 : 500;
    if (sc === 500) console.error("GET /api/fiche-techniques", e);
    if (e.code && sc === 400) {
      return jsonError(res, 400, e.code, e.message);
    }
    res.status(500).json({ error: "SERVER_ERROR", message: e.message || "LIST_ERROR" });
  }
});

function multerSinglePdf(req, res, next) {
  upload.single("file")(req, res, (err) => {
    if (!err) return next();
    if (err instanceof multer.MulterError && err.code === "LIMIT_FILE_SIZE") {
      return jsonError(res, 400, "FILE_TOO_LARGE", "Fichier trop volumineux (max 10 Mo)");
    }
    return jsonError(res, 400, "UPLOAD_ERROR", err.message || "Erreur upload");
  });
}

router.post(
  "/",
  verifyJWT,
  requireAnyPermission(DOC_PERMS),
  sensitiveUserRateLimiter,
  multerSinglePdf,
  async (req, res) => {
    try {
      const org = orgId(req);
      const uid = userId(req);
      if (!org) return jsonError(res, 403, "FORBIDDEN", "Organisation invalide");
      if (!req.file?.buffer) return jsonError(res, 400, "MISSING_FILE", "Fichier PDF requis (champ file)");

      const mime = String(req.file.mimetype || "").toLowerCase();
      if (!mime.includes("pdf")) {
        return jsonError(res, 400, "INVALID_FILE_TYPE", "Type MIME : PDF uniquement");
      }

      const row = await createFicheTechnique({
        organizationId: org,
        userId: uid,
        name: req.body.name,
        reference: req.body.reference,
        brand: req.body.brand,
        category: req.body.category,
        status: req.body.status,
        fileBuffer: req.file.buffer,
        originalFilename: req.file.originalname,
      });

      res.status(201).json({ id: row.id, storage_key: row.storageKey });
    } catch (e) {
      const sc = e.statusCode === 400 ? 400 : e.statusCode === 404 ? 404 : 500;
      if (sc === 500) console.error("POST /api/fiche-techniques", e);
      if (e.code) {
        return jsonError(res, sc, e.code, e.message);
      }
      return jsonError(res, sc, "UPLOAD_ERROR", e.message || "UPLOAD_ERROR");
    }
  }
);

router.patch("/:id/favorite", verifyJWT, requireAnyPermission(DOC_PERMS), async (req, res) => {
  try {
    const org = orgId(req);
    if (!org) return jsonError(res, 403, "FORBIDDEN", "Organisation invalide");
    const { id } = req.params;
    const raw = req.body?.is_favorite ?? req.body?.isFavorite;
    const isFavorite = raw === true || raw === "true" || raw === 1 || raw === "1";
    const row = await updateFavorite(org, id, isFavorite);
    res.json({ success: true, id: row.id, is_favorite: row.is_favorite });
  } catch (e) {
    const sc = e.statusCode === 404 ? 404 : 500;
    if (sc === 500) console.error("PATCH /api/fiche-techniques/:id/favorite", e);
    if (e.code === "NOT_FOUND") return jsonError(res, 404, "NOT_FOUND", e.message);
    res.status(500).json({ error: "SERVER_ERROR", message: e.message || "FAVORITE_ERROR" });
  }
});

router.post(
  "/:id/send",
  verifyJWT,
  requireAnyPermission(DOC_PERMS),
  requireMailUseStrict(),
  sensitiveUserRateLimiter,
  async (req, res) => {
    try {
      const org = orgId(req);
      const uid = userId(req);
      if (!org) return jsonError(res, 403, "FORBIDDEN", "Organisation invalide");
      const { id } = req.params;
      const to = req.body?.to;
      const mailAccountId = req.body?.mail_account_id ?? req.body?.mailAccountId ?? null;

      const out = await sendFicheTechniquePdfEmail({
        organizationId: org,
        userId: uid,
        ficheId: id,
        to,
        mailAccountId,
      });

      res.json({
        success: true,
        messageId: out.messageId ?? null,
        persisted: out.persisted ?? null,
      });
    } catch (e) {
      if (e?.code === "MAIL_SEND_DENIED") {
        return res.status(403).json({ success: false, code: "MAIL_SEND_DENIED", message: e.message });
      }
      if (e?.code === "MAIL_ACCOUNT_REQUIRED") {
        return res.status(400).json({ success: false, code: e.code, message: e.message });
      }
      if (e?.statusCode === 404 || e?.code === "NOT_FOUND") {
        return jsonError(res, 404, "NOT_FOUND", e.message);
      }
      if (e?.statusCode === 400) {
        return jsonError(res, 400, e.code || "VALIDATION_ERROR", e.message);
      }
      return handleSmtpRouteError(res, e);
    }
  }
);

router.get("/:id/download", verifyJWT, requireAnyPermission(DOC_PERMS), async (req, res) => {
  try {
    const org = orgId(req);
    const { id } = req.params;
    if (!org) return jsonError(res, 403, "FORBIDDEN", "Organisation invalide");

    const { filePath, displayName, mimeType } = await readFicheFileStreamContext(org, id);

    if (!existsSync(filePath)) {
      return jsonError(res, 404, "FILE_NOT_ON_DISK", "Fichier non trouvé sur le disque");
    }

    logger.info("FICHE_TECHNIQUE_DOWNLOAD", { ficheId: id, organizationId: org });

    res.setHeader("Content-Type", mimeType);
    res.setHeader("Content-Disposition", `attachment; filename*=UTF-8''${encodeURIComponent(displayName)}`);

    const stream = createReadStream(filePath);
    stream.on("error", () => {
      if (!res.headersSent) res.status(500).end();
    });
    stream.pipe(res);
  } catch (e) {
    if (e.statusCode === 404 || e.code === "NOT_FOUND" || e.code === "FILE_NOT_ON_DISK") {
      return jsonError(res, 404, e.code || "NOT_FOUND", e.message);
    }
    console.error("GET /api/fiche-techniques/:id/download", e);
    res.status(500).json({ error: "SERVER_ERROR", message: e.message || "DOWNLOAD_ERROR" });
  }
});

export default router;
