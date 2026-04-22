/** Extrait `roofExtensions` du runtime brut (ex. CALPINAGE_STATE) — lecture seule, pas de mutation. */

export function extractRuntimeRoofExtensions(debugRuntime: unknown): unknown[] {
  if (debugRuntime == null || typeof debugRuntime !== "object") return [];
  const rx = (debugRuntime as { roofExtensions?: unknown }).roofExtensions;
  return Array.isArray(rx) ? rx : [];
}
