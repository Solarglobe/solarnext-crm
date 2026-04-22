/**
 * Portail client SolarGlobe — routes publiques (sans JWT).
 * Ordre : routes les plus spécifiques en premier.
 */

import express from "express";
import {
  getClientPortal,
  getClientPortalDocumentFile,
  getClientPortalOrgLogo,
} from "../controllers/clientPortal.controller.js";

const router = express.Router();

router.get("/client-portal/organization/logo", getClientPortalOrgLogo);
router.get("/client-portal/documents/:documentId/file", getClientPortalDocumentFile);
router.get("/client-portal/:token", getClientPortal);

export default router;
