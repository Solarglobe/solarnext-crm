import express from "express";
import multer from "multer";
import { calculateSmartpitch } from "../controllers/calc.controller.js";
import { publicHeavyRateLimiter } from "../middleware/security/rateLimit.presets.js";
import { verifyJWT } from "../middleware/auth.middleware.js";

// dossier où seront stockés les CSV uploadés
const upload = multer({ dest: "backend/data/uploads/" });

const router = express.Router();

// ROUTE PRINCIPALE SMARTPITCH AVEC UPLOAD CSV
router.post(
  "/calc",
  publicHeavyRateLimiter,
  verifyJWT,
  upload.single("csv"),   // ⬅️ le fichier CSV doit arriver sous la clé "file"
  (req, res, next) => {
    if (process.env.NODE_ENV !== "production") {
      console.log(">> ROUTE /api/calc HIT");
      console.log("req.file =", req.file);
      console.log("body.keys =", Object.keys(req.body || {}));
    }

    // Pas de parsing ici → on laisse le controller gérer proprement
    next();
  },
  calculateSmartpitch
);

export default router;
