/**
 * CP-MAIRIES-002 — Validation payloads API mairies (sans accès DB).
 * CP-MAIRIES-HARDENING — Normalisations écriture, validations renforcées.
 *
 * Évolutions futures (non implémentées) :
 * - insee_code sur `mairies` pour corrélation officielle
 * - recherche full-text / pg_trgm sur nom + ville
 * - auto-match adresse chantier ↔ mairie (CP dédié)
 */

export const PORTAL_TYPES = new Set(["online", "email", "paper"]);
export const ACCOUNT_STATUSES = new Set(["none", "to_create", "created"]);

const FORBIDDEN_BODY_KEYS = new Set([
  "password",
  "pwd",
  "password_hash",
  "secret",
  "token",
  "otp",
  "credentials",
  "authorization",
  "cookie",
  "session",
  "organization_id",
  "org_id",
]);

const ALLOWED_CREATE_KEYS = new Set([
  "name",
  "postal_code",
  "city",
  "portal_url",
  "portal_type",
  "account_status",
  "account_email",
  "bitwarden_ref",
  "notes",
  "last_used_at",
]);

const ALLOWED_PATCH_KEYS = ALLOWED_CREATE_KEYS;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Protocoles URL portail autorisés (hors mailto). */
const ALLOWED_URL_PROTOCOLS = new Set(["http:", "https:"]);

/** Préfixes dangereux / non URL pour refus explicite. */
const BLOCKED_URL_PROTOCOL_PREFIXES = /^(javascript|data|vbscript|file|ftp|ftps):/i;

/** @param {string | undefined} id */
export function isUuid(id) {
  return Boolean(id && UUID_RE.test(String(id)));
}

/**
 * Espaces : trim + suites d’espaces → un seul espace (affichage humain préservé pour la casse).
 * @param {string | null | undefined} s
 */
export function normalizeWhitespace(s) {
  if (s == null || s === "") return null;
  return String(s).trim().replace(/\s+/g, " ");
}

/**
 * Clé de comparaison / matching futur (ville) — pas stockée en DB.
 * @param {string | null | undefined} city
 */
export function cityComparisonKey(city) {
  const n = normalizeWhitespace(city);
  if (!n) return "";
  return n
    .toLowerCase()
    .replace(/[-']/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Normalise une URL http(s) ou mailto pour stockage cohérent (unicité, pas de faux doublons).
 * À n’utiliser qu’à l’écriture ; ne modifie pas les lignes déjà en base.
 * @param {string} raw — déjà validée par validatePortalUrl
 * @returns {string|null}
 */
export function normalizePortalUrlForStorage(raw) {
  if (raw == null || raw === "") return null;
  const t = String(raw).trim();
  if (!t) return null;

  if (t.toLowerCase().startsWith("mailto:")) {
    const rest = t.slice("mailto:".length).trim();
    const low = rest.toLowerCase();
    return `mailto:${low}`;
  }

  const u = new URL(t);
  const protocol = u.protocol.toLowerCase();
  const hostname = u.hostname.toLowerCase();
  const port = u.port ? `:${u.port}` : "";
  let pathname = u.pathname;
  if (pathname.length > 1 && pathname.endsWith("/")) {
    pathname = pathname.slice(0, -1);
  }
  if (pathname === "/") pathname = "";
  return `${protocol}//${hostname}${port}${pathname}${u.search}${u.hash}`;
}

/**
 * @param {unknown} body
 * @returns {{ ok: true } | { ok: false, error: string, code?: string }}
 */
export function assertSafeMairieBody(body) {
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body JSON attendu", code: "INVALID_BODY" };
  }
  for (const k of Object.keys(body)) {
    if (FORBIDDEN_BODY_KEYS.has(k)) {
      return { ok: false, error: `Champ non autorisé : ${k}`, code: "FORBIDDEN_FIELD" };
    }
  }
  return { ok: true };
}

/**
 * @param {unknown} body
 * @param {"create"|"patch"} mode
 */
export function assertKnownKeysOnly(body, mode) {
  const allowed = mode === "create" ? ALLOWED_CREATE_KEYS : ALLOWED_PATCH_KEYS;
  if (body == null || typeof body !== "object" || Array.isArray(body)) {
    return { ok: false, error: "Body JSON attendu", code: "INVALID_BODY" };
  }
  for (const k of Object.keys(body)) {
    if (!allowed.has(k)) {
      return { ok: false, error: `Champ inconnu : ${k}`, code: "UNKNOWN_FIELD" };
    }
  }
  return { ok: true };
}

/**
 * Corps PATCH : ne traite pas les clés `undefined` (si jamais présentes).
 * @param {Record<string, unknown>} body
 */
function sanitizePatchBodyUndefined(body) {
  if (body == null || typeof body !== "object") return body;
  const out = { ...body };
  for (const k of Object.keys(out)) {
    if (out[k] === undefined) delete out[k];
  }
  return out;
}

/**
 * @param {unknown} value
 * @param {boolean} required
 */
function trimString(value, required) {
  if (value === undefined || value === null) {
    if (required) return { error: "Valeur requise" };
    return { value: null };
  }
  if (typeof value !== "string") return { error: "Chaîne attendue" };
  const t = value.trim();
  if (!t && required) return { error: "Valeur requise" };
  if (!t) return { value: null };
  return { value: t };
}

/**
 * @param {string | null | undefined} s
 * @returns {{ value: string | null } | { error: string, code: string }}
 */
export function validatePortalUrl(s) {
  if (s == null || s === "") return { value: null };
  const raw = String(s).trim();
  if (!raw) return { value: null };
  if (raw.length > 8000) return { error: "URL trop longue", code: "INVALID_PORTAL_URL" };

  if (BLOCKED_URL_PROTOCOL_PREFIXES.test(raw)) {
    return { error: "Schéma d’URL non autorisé", code: "INVALID_PORTAL_URL" };
  }

  const lower = raw.toLowerCase();
  try {
    if (lower.startsWith("mailto:")) {
      const rest = raw.slice("mailto:".length).trim();
      if (rest.length < 3) return { error: "URL mailto invalide", code: "INVALID_PORTAL_URL" };
      const em = validateAccountEmailInternal(rest);
      if (em.error) return { error: em.error, code: "INVALID_PORTAL_URL" };
      return { value: raw };
    }

    const u = new URL(raw);
    if (!ALLOWED_URL_PROTOCOLS.has(u.protocol)) {
      return { error: "Seuls http et https sont autorisés pour une URL portail", code: "INVALID_PORTAL_URL" };
    }
    if (u.username || u.password) {
      return { error: "Identifiants dans l’URL non autorisés", code: "INVALID_PORTAL_URL" };
    }
    return { value: raw };
  } catch {
    return { error: "URL portail invalide", code: "INVALID_PORTAL_URL" };
  }
}

/** Email métier : trim, lowercase, validation stricte. */
function validateAccountEmailInternal(s) {
  if (s == null || s === "") return { value: null };
  const t = String(s).trim().toLowerCase();
  if (!t) return { value: null };
  if (t.length > 255) return { error: "Email trop long" };
  if (!STRICT_EMAIL_RE.test(t)) return { error: "Format email invalide" };
  return { value: t };
}

/** Lettre locale + TLD 2+ ; refuse espaces. */
const STRICT_EMAIL_RE =
  /^[a-z0-9](?:[a-z0-9._%+~-]*[a-z0-9])?@[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)+$/i;

/** @param {string | null} s */
export function validateAccountEmail(s) {
  return validateAccountEmailInternal(s);
}

/** @param {unknown} v */
export function parseLastUsedAt(v) {
  if (v === undefined || v === null || v === "") return { value: null };
  const s = typeof v === "string" ? v : null;
  if (!s) return { error: "last_used_at invalide" };
  const d = Date.parse(s);
  if (Number.isNaN(d)) return { error: "last_used_at invalide" };
  return { value: new Date(d).toISOString() };
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ data: object } | { error: string, code?: string }}
 */
export function parseCreatePayload(body) {
  const safe = assertSafeMairieBody(body);
  if (!safe.ok) return { error: safe.error, code: safe.code };
  const keys = assertKnownKeysOnly(body, "create");
  if (!keys.ok) return { error: keys.error, code: keys.code };

  const nameRaw = trimString(body.name, true);
  if (nameRaw.error) return { error: "name : " + nameRaw.error, code: "VALIDATION" };
  const name = normalizeWhitespace(nameRaw.value);
  if (!name) return { error: "name : Valeur requise", code: "VALIDATION" };

  const postalRaw = trimString(body.postal_code, true);
  if (postalRaw.error) return { error: "postal_code : " + postalRaw.error, code: "VALIDATION" };
  const postal_sp = normalizeWhitespace(postalRaw.value);
  if (!postal_sp) return { error: "postal_code : Valeur requise", code: "VALIDATION" };
  if (postal_sp.length > 20) return { error: "postal_code trop long", code: "VALIDATION" };

  const cityRaw = trimString(body.city, false);
  if (cityRaw.error) return { error: "city : " + cityRaw.error, code: "VALIDATION" };
  const city = cityRaw.value ? normalizeWhitespace(cityRaw.value) : null;
  if (city && city.length > 150) return { error: "city trop longue", code: "VALIDATION" };

  const ptRaw = body.portal_type !== undefined ? body.portal_type : "online";
  const portal_type = typeof ptRaw === "string" ? ptRaw.trim() : "";
  if (!PORTAL_TYPES.has(portal_type)) return { error: "portal_type invalide", code: "VALIDATION" };

  const stRaw = body.account_status !== undefined ? body.account_status : "none";
  const account_status = typeof stRaw === "string" ? stRaw.trim() : "";
  if (!ACCOUNT_STATUSES.has(account_status)) return { error: "account_status invalide", code: "VALIDATION" };

  const pu = validatePortalUrl(body.portal_url !== undefined ? body.portal_url : null);
  if (pu.error) return { error: pu.error, code: pu.code || "VALIDATION" };
  const portal_url_norm = pu.value != null ? normalizePortalUrlForStorage(pu.value) : null;

  const em = validateAccountEmail(body.account_email !== undefined ? body.account_email : null);
  if (em.error) return { error: em.error, code: "VALIDATION" };

  const bit = trimString(body.bitwarden_ref, false);
  if (bit.error) return { error: "bitwarden_ref : " + bit.error, code: "VALIDATION" };
  if (bit.value && bit.value.length > 500) return { error: "bitwarden_ref trop long", code: "VALIDATION" };

  const notes = body.notes !== undefined && body.notes !== null ? String(body.notes) : null;
  if (notes != null && notes.length > 50000) return { error: "notes trop longues", code: "VALIDATION" };

  const lua = parseLastUsedAt(body.last_used_at);
  if (lua.error) return { error: lua.error, code: "VALIDATION" };

  return {
    data: {
      name,
      postal_code: postal_sp,
      city,
      portal_url: portal_url_norm,
      portal_type,
      account_status,
      account_email: em.value,
      bitwarden_ref: bit.value,
      notes: notes != null && String(notes).trim() === "" ? null : notes,
      last_used_at: lua.value,
    },
  };
}

/**
 * @param {Record<string, unknown>} body
 * @returns {{ data: object } | { error: string, code?: string }}
 */
export function parsePatchPayload(body) {
  const cleaned = sanitizePatchBodyUndefined(body);

  const safe = assertSafeMairieBody(cleaned);
  if (!safe.ok) return { error: safe.error, code: safe.code };
  const keys = assertKnownKeysOnly(cleaned, "patch");
  if (!keys.ok) return { error: keys.error, code: keys.code };

  const out = {};
  if (Object.prototype.hasOwnProperty.call(cleaned, "name")) {
    const name = trimString(cleaned.name, true);
    if (name.error) return { error: "name : " + name.error, code: "VALIDATION" };
    const nw = normalizeWhitespace(name.value);
    if (!nw) return { error: "name : Valeur requise", code: "VALIDATION" };
    out.name = nw;
  }
  if (Object.prototype.hasOwnProperty.call(cleaned, "postal_code")) {
    const postal = trimString(cleaned.postal_code, true);
    if (postal.error) return { error: "postal_code : " + postal.error, code: "VALIDATION" };
    const pw = normalizeWhitespace(postal.value);
    if (!pw) return { error: "postal_code : Valeur requise", code: "VALIDATION" };
    if (pw.length > 20) return { error: "postal_code trop long", code: "VALIDATION" };
    out.postal_code = pw;
  }
  if (Object.prototype.hasOwnProperty.call(cleaned, "city")) {
    const city = trimString(cleaned.city, false);
    if (city.error) return { error: "city : " + city.error, code: "VALIDATION" };
    const cw = city.value ? normalizeWhitespace(city.value) : null;
    if (cw && cw.length > 150) return { error: "city trop longue", code: "VALIDATION" };
    out.city = cw;
  }
  if (Object.prototype.hasOwnProperty.call(cleaned, "portal_type")) {
    const portal_type = typeof cleaned.portal_type === "string" ? cleaned.portal_type.trim() : "";
    if (!PORTAL_TYPES.has(portal_type)) return { error: "portal_type invalide", code: "VALIDATION" };
    out.portal_type = portal_type;
  }
  if (Object.prototype.hasOwnProperty.call(cleaned, "account_status")) {
    const account_status = typeof cleaned.account_status === "string" ? cleaned.account_status.trim() : "";
    if (!ACCOUNT_STATUSES.has(account_status)) return { error: "account_status invalide", code: "VALIDATION" };
    out.account_status = account_status;
  }
  if (Object.prototype.hasOwnProperty.call(cleaned, "portal_url")) {
    const pu = validatePortalUrl(cleaned.portal_url);
    if (pu.error) return { error: pu.error, code: pu.code || "VALIDATION" };
    out.portal_url = pu.value != null ? normalizePortalUrlForStorage(pu.value) : null;
  }
  if (Object.prototype.hasOwnProperty.call(cleaned, "account_email")) {
    const em = validateAccountEmail(cleaned.account_email);
    if (em.error) return { error: em.error, code: "VALIDATION" };
    out.account_email = em.value;
  }
  if (Object.prototype.hasOwnProperty.call(cleaned, "bitwarden_ref")) {
    const bit = trimString(cleaned.bitwarden_ref, false);
    if (bit.error) return { error: "bitwarden_ref : " + bit.error, code: "VALIDATION" };
    if (bit.value && bit.value.length > 500) return { error: "bitwarden_ref trop long", code: "VALIDATION" };
    out.bitwarden_ref = bit.value;
  }
  if (Object.prototype.hasOwnProperty.call(cleaned, "notes")) {
    const n = cleaned.notes !== undefined && cleaned.notes !== null ? String(cleaned.notes) : null;
    if (n != null && n.length > 50000) return { error: "notes trop longues", code: "VALIDATION" };
    out.notes = n != null && String(n).trim() === "" ? null : n;
  }
  if (Object.prototype.hasOwnProperty.call(cleaned, "last_used_at")) {
    const lua = parseLastUsedAt(cleaned.last_used_at);
    if (lua.error) return { error: lua.error, code: "VALIDATION" };
    out.last_used_at = lua.value;
  }

  if (Object.keys(out).length === 0) {
    return { error: "Aucun champ à mettre à jour", code: "EMPTY_PATCH" };
  }

  return { data: out };
}
