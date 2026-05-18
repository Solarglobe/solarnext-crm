import client from "prom-client";

const registry = new client.Registry();
client.collectDefaultMetrics({ register: registry, prefix: "solarnext_" });

const defaultBuckets = [0.1, 0.25, 0.5, 1, 2.5, 5, 10, 30, 60];

export const shadingCalculationDurationSeconds = new client.Histogram({
  name: "solarnext_shading_calculation_duration_seconds",
  help: "Duration of SolarNext shading calculations in seconds",
  buckets: defaultBuckets,
  labelNames: ["method", "path", "status_code"],
  registers: [registry],
});

export const financialCalculationDurationSeconds = new client.Histogram({
  name: "solarnext_financial_calculation_duration_seconds",
  help: "Duration of SolarNext financial calculations in seconds",
  buckets: defaultBuckets,
  labelNames: ["method", "path", "status_code"],
  registers: [registry],
});

export const pdfGenerationDurationSeconds = new client.Histogram({
  name: "solarnext_pdf_generation_duration_seconds",
  help: "Duration of SolarNext PDF generation in seconds",
  buckets: defaultBuckets,
  labelNames: ["method", "path", "status_code"],
  registers: [registry],
});

export const pvgisApiCallsTotal = new client.Counter({
  name: "solarnext_pvgis_api_calls_total",
  help: "Total number of PVGIS API calls",
  labelNames: ["status"],
  registers: [registry],
});

export const active3dSessions = new client.Gauge({
  name: "solarnext_active_3d_sessions",
  help: "Current active SolarNext 3D sessions",
  registers: [registry],
});

export function observeHttpRequestMetrics({ method, path, statusCode, durationMs, calculationType }) {
  const labels = {
    method: String(method ?? "GET"),
    path: String(path ?? "/unknown"),
    status_code: String(statusCode ?? 0),
  };
  const seconds = Number(durationMs ?? 0) / 1000;
  if (calculationType === "shading") shadingCalculationDurationSeconds.observe(labels, seconds);
  if (calculationType === "financial" || calculationType === "roi") financialCalculationDurationSeconds.observe(labels, seconds);
  if (calculationType === "pdf") pdfGenerationDurationSeconds.observe(labels, seconds);
}

export function recordPvgisApiCall(status = "unknown") {
  pvgisApiCallsTotal.inc({ status: String(status) });
}

export function incrementActive3dSessions() {
  active3dSessions.inc();
}

export function decrementActive3dSessions() {
  active3dSessions.dec();
}

export { registry as metricsRegistry };
