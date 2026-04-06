/**
 * CP-028 — Routes Address + Geo
 * Toutes les routes exigent JWT. Org isolation dans le controller.
 */

import express from "express";
import { verifyJWT } from "../../middleware/auth.middleware.js";
import * as controller from "./address.controller.js";

const router = express.Router();

// Geo (JWT requis)
router.get("/geo/autocomplete", verifyJWT, controller.geoAutocomplete);
router.post("/geo/resolve", verifyJWT, controller.geoResolve);

// Addresses CRUD
router.post("/addresses", verifyJWT, controller.createAddress);
router.get("/addresses/:id", verifyJWT, controller.getAddress);
router.patch("/addresses/:id", verifyJWT, controller.patchAddress);

// Verify-pin
router.post("/addresses/verify-pin", verifyJWT, controller.verifyPin);

export default router;
