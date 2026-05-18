import * as Sentry from "@sentry/node";
import { FINANCIAL_ENGINE_VERSION } from "../constants/engineVersion.js";

let initialized = false;

const CALCULATION_TYPES = new Set(["shading", "financial", "roi"]);

function stringOrNull(value) {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
}

function readUserContext(req) {
  const user = req?.user ?? req?.auth?.user ?? null;
  return {
    id: stringOrNull(user?.id ?? user?.userId ?? req?.userId),
    organizationId: stringOrNull(user?.organizationId ?? user?.organization_id ?? req?.organizationId),
    role: stringOrNull(user?.role ?? user?.roleName ?? user?.rbacRole),
  };
}

function readPvContext(source = {}, req = null) {
  const body = req?.body ?? {};
  const query = req?.query ?? {};
  const params = req?.params ?? {};
  const raw = source.pv ?? source.pvContext ?? source.sentryPvContext ?? source.businessContext ?? {};
  const calculationType = stringOrNull(
    raw.calculation_type ?? raw.calculationType ?? body.calculation_type ?? body.calculationType ?? query.calculation_type
  );

  return {
    study_id: stringOrNull(raw.study_id ?? raw.studyId ?? params.studyId ?? params.id ?? body.study_id ?? body.studyId),
    scenario_version: stringOrNull(
      raw.scenario_version ?? raw.scenarioVersion ?? params.versionId ?? body.scenario_version ?? body.scenarioVersion
    ),
    engine_version: stringOrNull(raw.engine_version ?? raw.engineVersion ?? body.engine_version ?? body.engineVersion) ?? FINANCIAL_ENGINE_VERSION,
    geometry_hash: stringOrNull(raw.geometry_hash ?? raw.geometryHash ?? body.geometry_hash ?? body.geometryHash),
    calculation_type: CALCULATION_TYPES.has(calculationType) ? calculationType : null,
  };
}

export function initBackendSentry() {
  if (initialized || !process.env.SENTRY_DSN) return;
  initialized = true;

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? "development",
    release: process.env.SENTRY_RELEASE ?? process.env.npm_package_version,
    tracesSampleRate: Number(process.env.SENTRY_TRACES_SAMPLE_RATE ?? 0),
  });
}

export function withPvEngineContext(error, context) {
  if (error && typeof error === "object") {
    error.sentryPvContext = { ...(error.sentryPvContext ?? {}), ...context };
  }
  return error;
}

export function captureBackendException(error, options = {}) {
  initBackendSentry();
  if (!initialized) return null;

  const req = options.req ?? null;
  const user = readUserContext(req);
  const pv = readPvContext({ ...(error ?? {}), ...options }, req);

  return Sentry.withScope((scope) => {
    if (user.id || user.organizationId || user.role) {
      scope.setUser({ id: user.id ?? undefined, organizationId: user.organizationId ?? undefined, role: user.role ?? undefined });
      if (user.id) scope.setTag("user_id", user.id);
      if (user.organizationId) scope.setTag("organization_id", user.organizationId);
      if (user.role) scope.setTag("role", user.role);
    }
    if (req?.sentryRequestContext) scope.setContext("request", req.sentryRequestContext);

    if (pv.study_id || pv.scenario_version || pv.geometry_hash || pv.calculation_type) {
      scope.setContext("pv_calculation", pv);
      scope.setTag("engine_version", pv.engine_version);
      if (pv.study_id) scope.setTag("study_id", pv.study_id);
      if (pv.scenario_version) scope.setTag("scenario_version", pv.scenario_version);
      if (pv.geometry_hash) scope.setTag("geometry_hash", pv.geometry_hash);
      if (pv.calculation_type) {
        scope.setTag("calculation_type", pv.calculation_type);
        scope.setFingerprint(["pv-engine", pv.calculation_type, pv.geometry_hash ?? "{{ default }}"]);
      }
    }

    if (options.tags) {
      for (const [key, value] of Object.entries(options.tags)) scope.setTag(key, String(value));
    }
    if (options.extra) scope.setExtras(options.extra);

    return Sentry.captureException(error);
  });
}

export function sentryRequestContextMiddleware(req, _res, next) {
  initBackendSentry();
  req.sentryRequestContext = {
    id: req.auditRequestId ?? req.id ?? null,
    method: req.method,
    url: req.originalUrl,
  };
  next();
}

export function sentryErrorHandler(err, req, _res, next) {
  captureBackendException(err, { req });
  next(err);
}

export function flushBackendSentry(timeoutMs = 2000) {
  if (!initialized) return Promise.resolve(true);
  return Sentry.flush(timeoutMs);
}
