/**
 * CP-SNAPSHOT — Validation calpinage → création snapshot versionné (verrouillé, immuable).
 * POST /api/studies/:studyId/calpinage/validate
 */

import { createCalpinageValidateService } from "../services/calpinage/calpinageValidate.service.js";

const DEBUG = process.env.DEBUG_CALPINAGE_VALIDATE === "1";
let defaultServicePromise = null;

export function createValidateCalpinageHandler(service) {
  if (!service?.validate) {
    throw new Error("service validate calpinage manquant");
  }

  return async function validateCalpinageHandler(req, res) {
    const result = await service.validate({
      studyId: req.params.studyId,
      body: req.body || {},
      query: req.query || {},
      user: req.user,
      req,
    });
    return res.status(result.status).json(result.body);
  };
}

export async function createDefaultValidateCalpinageService() {
  const [
    { createCalpinageValidatePostgresRepository },
    { createCalpinageSnapshot },
    { logAuditEvent },
    { AuditActions },
  ] = await Promise.all([
    import("../services/calpinage/calpinageValidatePostgres.repository.js"),
    import("../services/calpinage/calpinageSnapshot.service.js"),
    import("../services/audit/auditLog.service.js"),
    import("../services/audit/auditActions.js"),
  ]);

  return createCalpinageValidateService({
    repository: createCalpinageValidatePostgresRepository(),
    snapshotService: { createCalpinageSnapshot },
    logAuditEvent,
    auditActions: AuditActions,
    debug: DEBUG,
  });
}

export async function validateCalpinage(req, res) {
  defaultServicePromise ??= createDefaultValidateCalpinageService();
  const service = await defaultServicePromise;
  return createValidateCalpinageHandler(service)(req, res);
}
