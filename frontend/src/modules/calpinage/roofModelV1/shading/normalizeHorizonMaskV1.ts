export function normalizeHorizonMaskV1(raw: unknown, updatedAtIso: string): Readonly<Record<string, unknown>> {
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return { ...((raw as Record<string, unknown>) || {}), updatedAtIso };
  }
  return { value: raw, updatedAtIso };
}
