import * as Sentry from "@sentry/react";

let initialized = false;

function numericEnv(name: string, fallback: number): number {
  const env = import.meta.env as Record<string, string | undefined>;
  const value = Number(env[name]);
  return Number.isFinite(value) ? value : fallback;
}

function getStatusCode(event: Sentry.Event, hint: Sentry.EventHint): number | null {
  const original = hint.originalException as { status?: number; statusCode?: number; response?: { status?: number } } | undefined;
  const contexts = event.contexts as { response?: { status_code?: number; status?: number } } | undefined;
  return original?.status ?? original?.statusCode ?? original?.response?.status ?? contexts?.response?.status_code ?? contexts?.response?.status ?? null;
}

function isExpectedNetworkError(event: Sentry.Event, hint: Sentry.EventHint): boolean {
  if (getStatusCode(event, hint) === 429) return true;

  const message = [
    event.message,
    event.exception?.values?.map((value) => `${value.type ?? ""} ${value.value ?? ""}`).join(" "),
    hint.originalException instanceof Error ? hint.originalException.message : String(hint.originalException ?? ""),
  ]
    .join(" ")
    .toLowerCase();

  return (
    message.includes("networkerror") ||
    message.includes("network error") ||
    message.includes("failed to fetch") ||
    message.includes("load failed") ||
    message.includes("err_network") ||
    message.includes("connexion perdue") ||
    message.includes("connection lost")
  );
}

export function initFrontendSentry(): void {
  if (initialized || !import.meta.env.VITE_SENTRY_DSN) return;
  initialized = true;

  Sentry.init({
    dsn: import.meta.env.VITE_SENTRY_DSN,
    environment: import.meta.env.MODE,
    release: import.meta.env.VITE_SENTRY_RELEASE,
    integrations: [Sentry.browserTracingIntegration(), Sentry.replayIntegration()],
    tracesSampleRate: numericEnv("VITE_SENTRY_TRACES_SAMPLE_RATE", 0.05),
    replaysSessionSampleRate: numericEnv("VITE_SENTRY_REPLAY_SAMPLE_RATE", 0.05),
    replaysOnErrorSampleRate: numericEnv("VITE_SENTRY_REPLAY_ON_ERROR_SAMPLE_RATE", 1),
    beforeSend(event, hint) {
      if (isExpectedNetworkError(event, hint)) return null;
      return event;
    },
  });
}

export function captureFrontendException(
  error: unknown,
  context?: { tags?: Record<string, string>; extra?: Record<string, unknown> }
): string | null {
  initFrontendSentry();
  if (!initialized) return null;

  return Sentry.withScope((scope) => {
    if (context?.tags) {
      for (const [key, value] of Object.entries(context.tags)) scope.setTag(key, value);
    }
    if (context?.extra) scope.setExtras(context.extra);
    return Sentry.captureException(error);
  });
}
