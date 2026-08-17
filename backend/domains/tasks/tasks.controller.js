import * as service from "./tasks.service.js";

function sendError(res, error) {
  const status = Number.isInteger(error?.statusCode) ? error.statusCode : 500;
  res.status(status).json({
    error: error?.message || "Erreur tâches CRM",
    code: error?.code,
  });
}

export async function listTasks(req, res) {
  try {
    const tasks = await service.listCrmTasks(req);
    res.json({ tasks });
  } catch (e) {
    sendError(res, e);
  }
}

export async function createTask(req, res) {
  try {
    const task = await service.createCrmTask(req);
    res.status(201).json(task);
  } catch (e) {
    sendError(res, e);
  }
}

export async function updateTask(req, res) {
  try {
    const task = await service.updateCrmTask(req);
    res.json(task);
  } catch (e) {
    sendError(res, e);
  }
}

export async function completeTask(req, res) {
  try {
    const task = await service.completeCrmTask(req);
    res.json(task);
  } catch (e) {
    sendError(res, e);
  }
}

export async function snoozeTask(req, res) {
  try {
    const task = await service.snoozeCrmTask(req);
    res.json(task);
  } catch (e) {
    sendError(res, e);
  }
}

export async function cancelTask(req, res) {
  try {
    const task = await service.cancelCrmTask(req);
    res.json(task);
  } catch (e) {
    sendError(res, e);
  }
}

export async function listLeadTasks(req, res) {
  req.query = { ...(req.query || {}), lead_id: req.params.id };
  return listTasks(req, res);
}

export async function createLeadTask(req, res) {
  req.body = { ...(req.body || {}), lead_id: req.params.id };
  return createTask(req, res);
}

export async function listClientTasks(req, res) {
  req.query = { ...(req.query || {}), client_id: req.params.id };
  return listTasks(req, res);
}

export async function createClientTask(req, res) {
  req.body = { ...(req.body || {}), client_id: req.params.id };
  return createTask(req, res);
}
