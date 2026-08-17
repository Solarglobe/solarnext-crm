import express from "express";
import { verifyJWT } from "../../middleware/auth.middleware.js";
import { requireAnyPermission, requirePermission } from "../../rbac/rbac.middleware.js";
import * as controller from "./installers.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requirePermission("installer.read"), controller.list);
router.post("/", verifyJWT, requirePermission("installer.write"), controller.create);
router.get("/:id", verifyJWT, requirePermission("installer.read"), controller.get);
router.patch("/:id", verifyJWT, requirePermission("installer.write"), controller.patch);

router.put("/:id/zones", verifyJWT, requirePermission("installer.write"), controller.replaceZones);

router.get(
  "/:id/tariff-versions",
  verifyJWT,
  requireAnyPermission(["installer.pricing.read", "installer.pricing.write"]),
  controller.listTariffVersions
);
router.post("/:id/tariff-versions", verifyJWT, requirePermission("installer.pricing.write"), controller.createTariffVersion);
router.get(
  "/:id/tariff-versions/:versionId",
  verifyJWT,
  requireAnyPermission(["installer.pricing.read", "installer.pricing.write"]),
  controller.getTariffVersion
);
router.post(
  "/:id/tariff-versions/:versionId/activate",
  verifyJWT,
  requirePermission("installer.pricing.write"),
  controller.activateTariffVersion
);
router.put(
  "/:id/tariff-versions/:versionId/catalog",
  verifyJWT,
  requirePermission("installer.pricing.write"),
  controller.replaceCatalog
);

router.post(
  "/:id/compute-installation-cost",
  verifyJWT,
  requirePermission("installer.pricing.read"),
  controller.compute
);

export default router;
