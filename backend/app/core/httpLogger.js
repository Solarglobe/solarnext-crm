import logger from "./logger.js";
import { observeHttpRequestMetrics } from "./metrics.js";

const SLOW_WARN_MS = 1000;
const SLOW_ERROR_MS = 5000;

function userContext(req) {
  const user = req.user ?? {};
  return {
    userId: user.userId ?? user.id ?? null,
    organizationId: user.organizationId ?? user.organization_id ?? req.headers["x-organization-id"] ?? null,
    role: user.role ?? null,
  };
}

function calculationTypeFromPath(path) {
  const p = String(path ?? "").toLowerCase();
  if (p.includes("shading") || p.includes("calpinage") || p.includes("horizon")) return "shading";
  if (p.includes("financial") || p.includes("finance") || p.includes("scenario") || p.includes("roi") || p.includes("/calc")) return "financial";
  if (p.includes("pdf")) return "pdf";
  return null;
}

function requestContext(req) {
  const calculationType = req.calculationType ?? req.body?.calculation_type ?? req.query?.calculation_type ?? calculationTypeFromPath(req.originalUrl);
  return {
    studyId: req.params?.studyId ?? req.params?.id ?? req.body?.studyId ?? req.body?.study_id ?? null,
    scenarioVersion: req.params?.versionId ?? req.body?.scenarioVersion ?? req.body?.scenario_version ?? null,
    calculationType,
  };
}

function logLevelFor(durationMs, statusCode) {
  if (durationMs > SLOW_ERROR_MS || statusCode >= 500) return "error";
  if (durationMs > SLOW_WARN_MS || statusCode >= 400) return "warn";
  return "info";
}

export const httpLogger = (req, res, next) => {
  const start = Date.now();
  const requestId = req.auditRequestId ?? req.id ?? null;
  const path = req.originalUrl?.split("?")[0] ?? req.path;

  logger.info("HTTP_REQUEST_RECEIVED", {
    requestId,
    method: req.method,
    path,
    ...userContext(req),
    context: requestContext(req),
  });

  res.on("finish", () => {
    const duration = Date.now() - start;
    const statusCode = res.statusCode;
    const level = logLevelFor(duration, statusCode);
    const context = requestContext(req);

    observeHttpRequestMetrics({
      method: req.method,
      path,
      statusCode,
      durationMs: duration,
      calculationType: context.calculationType,
    });

    logger[level]("HTTP_REQUEST_COMPLETED", {
      requestId,
      ...userContext(req),
      method: req.method,
      path,
      statusCode,
      durationMs: duration,
      context,
    });
  });

  next();
};
