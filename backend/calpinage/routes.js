// ======================================================================
// Routes CRUD Calpinage — GET / POST / DELETE par leadId (stockage fichier)
// DÉMONTÉ du serveur : ancien montage /calpinage sans JWT (fuite données).
// Conservé pour référence / scripts locaux éventuels — ne pas remonter sur app sans auth.
// ======================================================================

import express from "express";
import {
  loadCalpinage,
  saveCalpinage,
  deleteCalpinage,
} from "./storage/fileStore.js";
import { validateCalpinage } from "./schema/validateCalpinage.js";
import { migrateCalpinage } from "./schema/migrateCalpinage.js";
import { publicHeavyRateLimiter } from "../middleware/security/rateLimit.presets.js";

const router = express.Router();

router.use((req, res, next) => {
  if (req.method === "POST" || req.method === "DELETE") {
    return publicHeavyRateLimiter(req, res, next);
  }
  next();
});

router.get("/:leadId", (req, res) => {
  const { leadId } = req.params;
  const data = loadCalpinage(leadId);
  if (!data) {
    return res.status(404).json({ error: "Calpinage not found" });
  }
  res.json(data);
});

router.post("/:leadId", (req, res) => {
  try {
    const { leadId } = req.params;
    const migrated = migrateCalpinage(req.body);
    validateCalpinage(migrated);
    saveCalpinage(leadId, migrated);
    res.json({ ok: true });
  } catch (e) {
    const status = e.statusCode || 500;
    return res.status(status).json({ error: e.message });
  }
});

router.delete("/:leadId", (req, res) => {
  const { leadId } = req.params;
  deleteCalpinage(leadId);
  res.json({ ok: true });
});

export default router;
