import pino from "pino";

const logLevel = (process.env.LOG_LEVEL || "info").toLowerCase();

const REDACT_PATHS = [
  "password",
  "token",
  "accessToken",
  "refreshToken",
  "authorization",
  "headers.authorization",
  "body.password",
  "body.token",
  "body.accessToken",
  "body.refreshToken",
  "req.headers.authorization",
  "context.gps",
  "context.lat",
  "context.lon",
  "context.lng",
  "context.latitude",
  "context.longitude",
];

const baseLogger = pino({
  level: logLevel,
  timestamp: pino.stdTimeFunctions.isoTime,
  messageKey: "event",
  redact: {
    paths: REDACT_PATHS,
    censor: "[REDACTED]",
  },
  formatters: {
    level(label) {
      return { level: label };
    },
  },
});

function normalizeError(error) {
  if (!error) return undefined;
  if (error instanceof Error) {
    return {
      message: error.message,
      name: error.name,
      stack: error.stack,
    };
  }
  return error;
}

function normalizePayload(eventOrObject, meta) {
  if (typeof eventOrObject === "string") {
    return { event: eventOrObject, ...(meta ?? {}) };
  }
  if (eventOrObject && typeof eventOrObject === "object") {
    return { ...eventOrObject };
  }
  return { event: String(eventOrObject ?? "LOG") };
}

function write(level, eventOrObject, meta) {
  const payload = normalizePayload(eventOrObject, meta);
  if (payload.error) payload.error = normalizeError(payload.error);
  if (payload.err) payload.err = normalizeError(payload.err);
  baseLogger[level](payload);
}

const logger = {
  trace: (eventOrObject, meta) => write("trace", eventOrObject, meta),
  debug: (eventOrObject, meta) => write("debug", eventOrObject, meta),
  info: (eventOrObject, meta) => write("info", eventOrObject, meta),
  warn: (eventOrObject, meta) => write("warn", eventOrObject, meta),
  error: (eventOrObject, meta) => write("error", eventOrObject, meta),
  child: (bindings) => baseLogger.child(bindings),
};

function serializeConsoleArg(arg) {
  if (arg instanceof Error) return normalizeError(arg);
  if (arg && typeof arg === "object") return arg;
  return String(arg);
}

function installProductionConsoleBridge() {
  if (globalThis.__SOLARNEXT_PINO_CONSOLE_BRIDGE__) return;
  if (process.env.NODE_ENV !== "production" && process.env.STRUCTURED_CONSOLE !== "1") return;
  globalThis.__SOLARNEXT_PINO_CONSOLE_BRIDGE__ = true;

  console.log = (...args) => write("info", "CONSOLE_LOG", { args: args.map(serializeConsoleArg) });
  console.info = (...args) => write("info", "CONSOLE_INFO", { args: args.map(serializeConsoleArg) });
  console.warn = (...args) => write("warn", "CONSOLE_WARN", { args: args.map(serializeConsoleArg) });
  console.error = (...args) => write("error", "CONSOLE_ERROR", { args: args.map(serializeConsoleArg) });
}

installProductionConsoleBridge();

export default logger;
