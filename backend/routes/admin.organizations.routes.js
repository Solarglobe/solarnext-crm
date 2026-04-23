/**
 * Super admin — organisations (hors /api/organizations unifié).
 */
import express from "express";
import { verifyJWT } from "../middleware/auth.middleware.js";
import * as controller from "../controllers/admin.organizations.controller.js";

const router = express.Router();

router.get("/", verifyJWT, controller.list);
router.post("/:id/impersonate", verifyJWT, controller.impersonate);
router.patch("/:id/archive", verifyJWT, controller.archive);
router.patch("/:id/restore", verifyJWT, controller.restore);
router.delete("/:id", verifyJWT, controller.remove);

export default router;
