// ======================================================================
// Routes CRUD Calpinage — GET / POST / DELETE par leadId
// Stockage fichier, validation schema v1, pas d'auth
// ======================================================================

import express from "express";
import {
  loadCalpinage,
  saveCalpinage,
  deleteCalpinage,
} from "./storage/fileStore.js";
import { validateCalpinage } from "./schema/validateCalpinage.js";
import { migrateCalpinage } from "./schema/migrateCalpinage.js";

const router = express.Router();

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
