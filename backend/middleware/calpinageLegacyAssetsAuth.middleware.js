/**
 * Assets legacy Calpinage sous /calpinage/* : JWT utilisateur OU renderToken PDF (Playwright).
 * Les bundles ne sont pas servis depuis frontend/public (pas d’accès anonyme au dev server / dist).
 */
import { verifyJWT } from "./auth.middleware.js";
import { verifyPdfRenderToken } from "../services/pdfRenderToken.service.js";

export default async function calpinageLegacyAssetsAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (authHeader && authHeader.startsWith("Bearer ")) {
    return verifyJWT(req, res, next);
  }

  const rt = req.query?.renderToken;
  const sid = req.query?.studyId;
  const vid = req.query?.versionId;
  if (rt && sid && vid) {
    try {
      verifyPdfRenderToken(String(rt), String(sid), String(vid));
      return next();
    } catch (e) {
      const code = e?.code || "RENDER_TOKEN_INVALID";
      return res.status(401).json({
        error: e?.message || "renderToken invalide",
        code,
      });
    }
  }

  return res.status(401).json({ error: "Token manquant" });
}
