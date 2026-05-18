/**
 * CP-076 - En-tetes HTTP securite (sans dependance helmet).
 *
 * CSP demarre en report-only par defaut. Basculer avec:
 * SECURITY_CSP_MODE=enforce
 */

const HSTS_VALUE = "max-age=31536000; includeSubDomains; preload";
const PERMISSIONS_POLICY = "camera=(), microphone=(), geolocation=(self), payment=(self)";

const CSP_DIRECTIVES = {
  "default-src": ["'self'"],
  "base-uri": ["'self'"],
  "object-src": ["'none'"],
  "frame-ancestors": ["'self'"],
  "form-action": ["'self'"],
  "script-src": ["'self'", "'wasm-unsafe-eval'", "https://js.stripe.com"],
  "style-src": ["'self'", "'unsafe-inline'"],
  "img-src": [
    "'self'",
    "data:",
    "blob:",
    "https:",
    "https://*.tile.openstreetmap.org",
    "https://data.geopf.fr",
    "https://api.maptiler.com",
  ],
  "font-src": ["'self'", "data:"],
  "connect-src": [
    "'self'",
    "https://solarnext-crm.fr",
    "https://api.solarnext-crm.fr",
    "https://re.jrc.ec.europa.eu",
    "https://api.stripe.com",
    "https://*.ingest.sentry.io",
    "https://data.geopf.fr",
    "https://openmaptiles.data.gouv.fr",
    "https://api.maptiler.com",
    "wss:",
    "ws:",
  ],
  "frame-src": ["'self'", "https://js.stripe.com", "https://hooks.stripe.com"],
  "worker-src": ["'self'", "blob:"],
  "media-src": ["'self'", "data:", "blob:"],
  "manifest-src": ["'self'"],
  "upgrade-insecure-requests": [],
};

function buildCspHeader() {
  return Object.entries(CSP_DIRECTIVES)
    .map(([name, values]) => (values.length ? `${name} ${values.join(" ")}` : name))
    .join("; ");
}

function isProductionHttps(req) {
  if (process.env.NODE_ENV !== "production") return false;
  if (req.secure) return true;
  return String(req.headers["x-forwarded-proto"] ?? "").split(",")[0].trim() === "https";
}

function cspHeaderName() {
  const mode = String(process.env.SECURITY_CSP_MODE ?? process.env.CSP_MODE ?? "report-only").toLowerCase();
  return mode === "enforce" ? "Content-Security-Policy" : "Content-Security-Policy-Report-Only";
}

export function securityHeadersMiddleware(req, res, next) {
  res.setHeader("X-Content-Type-Options", "nosniff");
  res.setHeader("X-Frame-Options", "SAMEORIGIN");
  res.setHeader("Referrer-Policy", "strict-origin-when-cross-origin");
  res.setHeader(cspHeaderName(), buildCspHeader());
  res.setHeader("Permissions-Policy", PERMISSIONS_POLICY);
  if (isProductionHttps(req)) {
    res.setHeader("Strict-Transport-Security", HSTS_VALUE);
  }
  next();
}
