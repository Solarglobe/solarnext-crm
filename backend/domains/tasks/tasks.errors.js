export function httpError(message, statusCode = 400, code = undefined) {
  const err = new Error(message);
  err.statusCode = statusCode;
  if (code) err.code = code;
  return err;
}

export function notFound(message = "Tâche introuvable") {
  return httpError(message, 404, "CRM_TASK_NOT_FOUND");
}

export function forbidden(message = "Accès interdit") {
  return httpError(message, 403, "CRM_TASK_FORBIDDEN");
}
