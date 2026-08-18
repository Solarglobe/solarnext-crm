export const BACKEND_COMMERCIAL_GEOMETRY_CONTRACT_VERSION = "backend-commercial-geometry-v1";

const CLIENT_OFFICIAL_KEYS = new Set([
  "officialPvPlacementAllowed",
  "officialNearShadingAllowed",
  "commercialGeometryVerdict",
]);

function fail(code, message, path = "$") {
  const error = new Error(message);
  error.code = code;
  error.path = path;
  return error;
}

function isPlainObject(value) {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function cloneStrictJson(value, path = "$") {
  if (typeof value === "number") {
    if (!Number.isFinite(value)) {
      throw fail("CALPINAGE_INVALID_JSON", `Nombre non fini refusé dans geometry_json (${path})`, path);
    }
    return value;
  }
  if (value == null || typeof value === "string" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map((item, index) => cloneStrictJson(item, `${path}[${index}]`));
  if (typeof value !== "object") {
    throw fail("CALPINAGE_INVALID_JSON", `Type JSON non supporté dans geometry_json (${path})`, path);
  }

  const out = {};
  for (const [key, child] of Object.entries(value)) {
    if (CLIENT_OFFICIAL_KEYS.has(key)) continue;
    out[key] = cloneStrictJson(child, `${path}.${key}`);
  }
  return out;
}

function normalizeKind(raw) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "FLAT") return "FLAT";
  if (s === "PITCHED" || s === "SLOPED" || s === "MONOPENTE" || s === "GABLE" || s === "HIP") return "PITCHED";
  if (s === "PARTIAL") return "PARTIAL";
  return "UNKNOWN";
}

function normalizeProvenance(raw, kind) {
  const s = String(raw ?? "").trim().toUpperCase();
  if (s === "EXPLICIT" || s === "MIGRATED_DETERMINISTIC" || s === "INFERRED_HIGH_CONFIDENCE") return s;
  if (kind === "UNKNOWN") return "UNRESOLVED";
  return "EXPLICIT";
}

function collectPans(geometry) {
  const candidates = [
    geometry?.pans,
    geometry?.roofState?.pans,
    geometry?.roof?.roofPans,
    geometry?.validatedRoofData?.pans,
  ];
  const byId = new Map();
  for (const value of candidates) {
    if (!Array.isArray(value)) continue;
    for (const pan of value) {
      if (!isPlainObject(pan)) continue;
      const id = String(pan.id ?? pan.panId ?? byId.size);
      if (!byId.has(id)) byId.set(id, pan);
    }
  }
  return [...byId.values()];
}

function containsHeightFallback(value) {
  if (value == null) return false;
  if (typeof value === "string") return value === "HEIGHT_FALLBACK_DEFAULT_ON_CORNERS";
  if (Array.isArray(value)) return value.some(containsHeightFallback);
  if (typeof value === "object") {
    return Object.values(value).some(containsHeightFallback);
  }
  return false;
}

export function deriveBackendCommercialGeometryVerdict(geometry) {
  const pans = collectPans(geometry);
  const panVerdicts = pans.map((pan) => {
    const kind = normalizeKind(pan.roofKind ?? pan.roofType ?? pan.type);
    const provenance = normalizeProvenance(pan.roofKindProvenance ?? pan.roofTypeProvenance, kind);
    const unresolved = kind === "UNKNOWN" || provenance === "UNRESOLVED";
    const heightFallback = containsHeightFallback(pan);
    const status = unresolved || heightFallback ? "INVALID" : "UNCERTIFIED";
    return {
      panId: String(pan.id ?? pan.panId ?? ""),
      kind,
      provenance,
      status,
      officialPvPlacementAllowed: false,
      officialNearShadingAllowed: false,
      blockingCodes: [
        ...(unresolved ? ["COMMERCIAL_ROOF_KIND_UNRESOLVED"] : []),
        ...(heightFallback ? ["COMMERCIAL_ROOF_HEIGHT_FALLBACK"] : []),
      ],
    };
  });
  const hasInvalid = panVerdicts.some((p) => p.status === "INVALID");
  return {
    contractVersion: BACKEND_COMMERCIAL_GEOMETRY_CONTRACT_VERSION,
    source: "BACKEND_DERIVED_FROM_PERSISTED_GEOMETRY",
    status: hasInvalid ? "INVALID" : "UNCERTIFIED",
    officialPvPlacementAllowed: false,
    officialNearShadingAllowed: false,
    panVerdicts,
  };
}

export function sanitizeCalpinageGeometryForPersistence(geometry) {
  if (!geometry || typeof geometry !== "object" || Array.isArray(geometry)) {
    throw fail("CALPINAGE_INVALID_JSON", "geometry_json requis (objet JSON)");
  }
  const sanitized = cloneStrictJson(geometry);
  sanitized.backendCommercialGeometry = deriveBackendCommercialGeometryVerdict(sanitized);
  return sanitized;
}
