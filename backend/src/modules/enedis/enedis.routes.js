/**
 * Routes OAuth Enedis — module isolé
 * GET /api/enedis/connect  → redirection vers Enedis authorize
 * GET /api/enedis/callback → échange code → token, retourne { access_token }
 */

import express from "express";
import * as controller from "./enedis.controller.js";

const router = express.Router();

router.get("/connect", controller.connect);
router.get("/callback", controller.callback);

export default router;
