import express from "express";
import multer from "multer";
import { calculateSmartpitch } from "../controllers/calc.controller.js";

// dossier où seront stockés les CSV uploadés
const upload = multer({ dest: "backend/data/uploads/" });

const router = express.Router();

// ROUTE PRINCIPALE SMARTPITCH AVEC UPLOAD CSV
router.post(
  "/calc",
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
