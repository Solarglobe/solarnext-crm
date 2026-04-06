// ======================================================================
// Routes Calpinage — enregistrées uniquement si CALPINAGE_ENABLED est ON
// ======================================================================

import express from "express";

const router = express.Router();

// GET /api/calpinage/health — 200 { enabled: true } quand le module est actif
router.get("/health", (req, res) => {
  res.status(200).json({ enabled: true });
});

export default router;
