import { getUserPermissions } from "../../rbac/rbac.service.js";
import { effectiveSuperAdminRequestBypass } from "../../lib/superAdminUserGuards.js";
import {
  ACTIVE_TASK_STATUSES,
  isTaskCreatedFrom,
  isTaskPriority,
  isTaskStatus,
  isTaskType,
} from "./tasks.constants.js";
import * as repo from "./tasks.repository.js";
import { forbidden, httpError, notFound } from "./tasks.errors.js";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isUuid(value) {
  return typeof value === "string" && UUID_RE.test(value);
}

function normalizeOptionalUuid(value, field) {
  if (value == null || value === "") return null;
  const s = String(value);
  if (!isUuid(s)) throw httpError(`${field} invalide`, 400, "INVALID_UUID");
  return s;
}

function normalizeEnum(value, field, isValid, fallback = undefined) {
  const raw = value == null || value === "" ? fallback : value;
  const v = String(raw || "").toUpperCase();
  if (!isValid(v)) throw httpError(`${field} invalide`, 400, "INVALID_ENUM");
  return v;
}

function normalizeDueAt(value) {
  if (!value) throw httpError("due_at requis", 400, "DUE_AT_REQUIRED");
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) throw httpError("due_at invalide", 400, "INVALID_DUE_AT");
  return date.toISOString();
}

function trimText(value, max, field, required = false) {
  const s = value == null ? "" : String(value).trim();
  if (required && !s) throw httpError(`${field} requis`, 400, "FIELD_REQUIRED");
  if (s.length > max) throw httpError(`${field} trop long`, 400, "FIELD_TOO_LONG");
  return s || null;
}

export async function resolveTaskAccess(req) {
  const organizationId = req.user?.organizationId ?? req.user?.organization_id;
  const userId = req.user?.userId ?? req.user?.id;
  if (!organizationId || !userId) throw forbidden("Contexte utilisateur invalide");

  if (effectiveSuperAdminRequestBypass(req)) {
    return {
      organizationId,
      userId,
      readAll: true,
      readSelf: true,
      updateAll: true,
      updateSelf: true,
      canCreate: true,
    };
  }

  const perms = await getUserPermissions({ userId, organizationId });
  return {
    organizationId,
    userId,
    readAll: perms.has("crm_task.read.all"),
    readSelf: perms.has("crm_task.read.self"),
    updateAll: perms.has("crm_task.update.all"),
    updateSelf: perms.has("crm_task.update.self"),
    canCreate: perms.has("crm_task.create"),
  };
}

function assertReadAccess(access) {
  if (!access.readAll && !access.readSelf) throw forbidden("Vous n'avez pas accès aux tâches CRM.");
}

function assertUpdateAccess(access, task) {
  if (access.updateAll) return;
  if (access.updateSelf && task?.assigned_user_id && String(task.assigned_user_id) === String(access.userId)) return;
  throw forbidden("Vous ne pouvez modifier que vos propres tâches CRM.");
}

async function assertEntityOwnership(data) {
  const checks = [
    ["leads", data.lead_id, "lead_id"],
    ["clients", data.client_id, "client_id"],
    ["studies", data.project_id, "project_id"],
  ];
  for (const [table, id, field] of checks) {
    if (id && !(await repo.entityExists(table, id, data.organization_id))) {
      throw httpError(`${field} introuvable pour cette organisation`, 404, "ENTITY_NOT_FOUND");
    }
  }
  if (data.assigned_user_id && !(await repo.entityExists("users", data.assigned_user_id, data.organization_id))) {
    throw httpError("assigned_user_id introuvable pour cette organisation", 404, "ASSIGNED_USER_NOT_FOUND");
  }
}

export function normalizeTaskInput(body, { organizationId, userId, isAutomation = false } = {}) {
  const lead_id = normalizeOptionalUuid(body.lead_id, "lead_id");
  const client_id = normalizeOptionalUuid(body.client_id, "client_id");
  const project_id = normalizeOptionalUuid(body.project_id, "project_id");
  if (!lead_id && !client_id && !project_id) {
    throw httpError("Une tâche doit être rattachée à un lead, un client ou un projet", 400, "TASK_ENTITY_REQUIRED");
  }

  const assigned_user_id = normalizeOptionalUuid(body.assigned_user_id ?? userId, "assigned_user_id");
  if (!assigned_user_id) throw httpError("assigned_user_id requis", 400, "ASSIGNED_USER_REQUIRED");

  const created_from = normalizeEnum(
    body.created_from,
    "created_from",
    isTaskCreatedFrom,
    isAutomation ? "STAGE_RULE" : "MANUAL"
  );
  const automation_key = trimText(body.automation_key, 220, "automation_key", false);
  if (created_from !== "MANUAL" && !automation_key) {
    throw httpError("automation_key requis pour une tâche automatique", 400, "AUTOMATION_KEY_REQUIRED");
  }
  const status = normalizeEnum(body.status, "status", isTaskStatus, "OPEN");
  if (status === "DONE") {
    throw httpError("Une tâche ne peut pas être créée directement comme terminée", 400, "INVALID_INITIAL_STATUS");
  }

  return {
    organization_id: organizationId,
    lead_id,
    client_id,
    project_id,
    assigned_user_id,
    type: normalizeEnum(body.type, "type", isTaskType, "OTHER"),
    title: trimText(body.title, 180, "title", true),
    description: trimText(body.description, 5000, "description", false),
    due_at: normalizeDueAt(body.due_at),
    status,
    priority: normalizeEnum(body.priority, "priority", isTaskPriority, "NORMAL"),
    created_from,
    automation_key,
    created_by_user_id: normalizeOptionalUuid(body.created_by_user_id ?? userId, "created_by_user_id"),
    updated_by_user_id: normalizeOptionalUuid(body.updated_by_user_id ?? userId, "updated_by_user_id"),
  };
}

export function normalizeListFilters(query = {}) {
  const statusParam = query.status ? String(query.status).split(",").map((s) => s.trim().toUpperCase()).filter(Boolean) : [];
  const statuses = statusParam.length ? statusParam : ACTIVE_TASK_STATUSES;
  for (const status of statuses) {
    if (!isTaskStatus(status)) throw httpError("status invalide", 400, "INVALID_STATUS");
  }
  const bucket = query.bucket ? String(query.bucket).toLowerCase() : "all";
  if (!["all", "today", "overdue", "week"].includes(bucket)) throw httpError("bucket invalide", 400, "INVALID_BUCKET");

  const entity = query.entity ? String(query.entity).toLowerCase() : null;
  if (entity && !["lead", "client"].includes(entity)) throw httpError("entity invalide", 400, "INVALID_ENTITY");

  return {
    statuses,
    bucket,
    entity,
    assigned_user_id: normalizeOptionalUuid(query.assigned_user_id, "assigned_user_id"),
    type: query.type ? normalizeEnum(query.type, "type", isTaskType) : null,
    priority: query.priority ? normalizeEnum(query.priority, "priority", isTaskPriority) : null,
    lead_id: normalizeOptionalUuid(query.lead_id, "lead_id"),
    client_id: normalizeOptionalUuid(query.client_id, "client_id"),
    project_id: normalizeOptionalUuid(query.project_id, "project_id"),
  };
}

export async function listCrmTasks(req) {
  const access = await resolveTaskAccess(req);
  assertReadAccess(access);
  const filters = normalizeListFilters(req.query || {});
  if (!access.readAll && filters.assigned_user_id && filters.assigned_user_id !== access.userId) {
    throw forbidden("Vous ne pouvez filtrer que vos propres tâches.");
  }
  const limit = Math.min(200, Math.max(1, Number.parseInt(String(req.query?.limit || "100"), 10) || 100));
  const offset = Math.max(0, Number.parseInt(String(req.query?.offset || "0"), 10) || 0);
  return repo.listTasks({
    organizationId: access.organizationId,
    readAll: access.readAll,
    userId: access.userId,
    filters,
    limit,
    offset,
  });
}

export async function createCrmTask(req, overrides = {}) {
  const access = await resolveTaskAccess(req);
  if (!access.canCreate) throw forbidden("Vous ne pouvez pas créer de tâche CRM.");
  const data = normalizeTaskInput({ ...(req.body || {}), ...overrides }, access);
  if (!access.updateAll && data.assigned_user_id !== access.userId) {
    throw forbidden("Vous ne pouvez créer une tâche que pour vous-même.");
  }
  await assertEntityOwnership(data);
  const result = await repo.insertTask(data, { idempotent: !!data.automation_key });
  return result.row;
}

export async function createAutomatedTask(input) {
  const data = normalizeTaskInput(input, {
    organizationId: input.organization_id,
    userId: input.created_by_user_id ?? input.assigned_user_id,
    isAutomation: true,
  });
  await assertEntityOwnership(data);
  return repo.insertTask(data, { idempotent: true });
}

export async function updateCrmTask(req, patchBody = null) {
  const access = await resolveTaskAccess(req);
  const task = await repo.getTaskById(req.params.id, access.organizationId);
  if (!task) throw notFound();
  assertUpdateAccess(access, task);

  const body = patchBody || req.body || {};
  const patch = { updated_by_user_id: access.userId };
  if (Object.prototype.hasOwnProperty.call(body, "assigned_user_id")) {
    patch.assigned_user_id = normalizeOptionalUuid(body.assigned_user_id, "assigned_user_id");
    if (!patch.assigned_user_id) throw httpError("assigned_user_id requis", 400, "ASSIGNED_USER_REQUIRED");
    if (!access.updateAll && patch.assigned_user_id !== access.userId) {
      throw forbidden("Vous ne pouvez pas réassigner cette tâche.");
    }
    if (!(await repo.entityExists("users", patch.assigned_user_id, access.organizationId))) {
      throw httpError("assigned_user_id introuvable pour cette organisation", 404, "ASSIGNED_USER_NOT_FOUND");
    }
  }
  if (Object.prototype.hasOwnProperty.call(body, "type")) patch.type = normalizeEnum(body.type, "type", isTaskType);
  if (Object.prototype.hasOwnProperty.call(body, "title")) patch.title = trimText(body.title, 180, "title", true);
  if (Object.prototype.hasOwnProperty.call(body, "description")) patch.description = trimText(body.description, 5000, "description", false);
  if (Object.prototype.hasOwnProperty.call(body, "due_at")) patch.due_at = normalizeDueAt(body.due_at);
  if (Object.prototype.hasOwnProperty.call(body, "priority")) patch.priority = normalizeEnum(body.priority, "priority", isTaskPriority);
  if (Object.prototype.hasOwnProperty.call(body, "status")) {
    patch.status = normalizeEnum(body.status, "status", isTaskStatus);
    patch.completed_at = patch.status === "DONE" ? new Date().toISOString() : null;
  }
  return repo.updateTask(task.id, access.organizationId, patch);
}

export async function completeCrmTask(req) {
  return updateCrmTask(req, {
    status: "DONE",
    completed_at: new Date().toISOString(),
  });
}

export async function snoozeCrmTask(req) {
  const dueAt = req.body?.due_at;
  if (!dueAt) throw httpError("due_at requis pour reporter une tâche", 400, "DUE_AT_REQUIRED");
  return updateCrmTask(req, {
    status: "SNOOZED",
    due_at: dueAt,
    completed_at: null,
  });
}

export async function cancelCrmTask(req) {
  return updateCrmTask(req, {
    status: "CANCELLED",
    completed_at: null,
  });
}
