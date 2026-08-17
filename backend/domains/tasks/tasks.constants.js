export const TASK_TYPES = Object.freeze([
  "CALL",
  "EMAIL",
  "ADMIN",
  "POST_INSTALL",
  "SAV",
  "PARRAINAGE",
  "OTHER",
]);

export const TASK_STATUSES = Object.freeze(["OPEN", "DONE", "SNOOZED", "CANCELLED"]);
export const ACTIVE_TASK_STATUSES = Object.freeze(["OPEN", "SNOOZED"]);
export const TASK_PRIORITIES = Object.freeze(["LOW", "NORMAL", "HIGH", "URGENT"]);
export const TASK_CREATED_FROM = Object.freeze(["MANUAL", "STAGE_RULE", "INACTIVITY_RULE", "PROJECT_RULE"]);

export const TASK_READ_PERMISSIONS = Object.freeze(["crm_task.read.all", "crm_task.read.self"]);
export const TASK_UPDATE_PERMISSIONS = Object.freeze(["crm_task.update.all", "crm_task.update.self"]);
export const TASK_WRITE_PERMISSIONS = Object.freeze(["crm_task.create", ...TASK_UPDATE_PERMISSIONS]);

export function isTaskType(value) {
  return TASK_TYPES.includes(String(value || "").toUpperCase());
}

export function isTaskStatus(value) {
  return TASK_STATUSES.includes(String(value || "").toUpperCase());
}

export function isTaskPriority(value) {
  return TASK_PRIORITIES.includes(String(value || "").toUpperCase());
}

export function isTaskCreatedFrom(value) {
  return TASK_CREATED_FROM.includes(String(value || "").toUpperCase());
}
