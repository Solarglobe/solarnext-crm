import express from "express";
import { verifyJWT } from "../../middleware/auth.middleware.js";
import { requireAnyPermission } from "../../rbac/rbac.middleware.js";
import {
  TASK_READ_PERMISSIONS,
  TASK_UPDATE_PERMISSIONS,
  TASK_WRITE_PERMISSIONS,
} from "./tasks.constants.js";
import * as controller from "./tasks.controller.js";

const router = express.Router();

router.get("/", verifyJWT, requireAnyPermission(TASK_READ_PERMISSIONS), controller.listTasks);
router.post("/", verifyJWT, requireAnyPermission(TASK_WRITE_PERMISSIONS), controller.createTask);
router.patch("/:id", verifyJWT, requireAnyPermission(TASK_UPDATE_PERMISSIONS), controller.updateTask);
router.post("/:id/complete", verifyJWT, requireAnyPermission(TASK_UPDATE_PERMISSIONS), controller.completeTask);
router.post("/:id/snooze", verifyJWT, requireAnyPermission(TASK_UPDATE_PERMISSIONS), controller.snoozeTask);
router.post("/:id/cancel", verifyJWT, requireAnyPermission(TASK_UPDATE_PERMISSIONS), controller.cancelTask);

export default router;

export const leadTasksRouter = express.Router({ mergeParams: true });
leadTasksRouter.get("/", verifyJWT, requireAnyPermission(TASK_READ_PERMISSIONS), controller.listLeadTasks);
leadTasksRouter.post("/", verifyJWT, requireAnyPermission(TASK_WRITE_PERMISSIONS), controller.createLeadTask);

export const clientTasksRouter = express.Router({ mergeParams: true });
clientTasksRouter.get("/", verifyJWT, requireAnyPermission(TASK_READ_PERMISSIONS), controller.listClientTasks);
clientTasksRouter.post("/", verifyJWT, requireAnyPermission(TASK_WRITE_PERMISSIONS), controller.createClientTask);
