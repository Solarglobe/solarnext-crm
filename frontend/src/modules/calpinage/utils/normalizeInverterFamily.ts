/**
 * Normalise la famille d'onduleur à partir de inverter_family ou inverter_type (legacy).
 * Lecture seule, pas de modification DB.
 */

export function normalizeInverterFamily(inv: unknown): "MICRO" | "CENTRAL" | null {
  if (!inv || typeof inv !== "object") return null;
  const rec = inv as Record<string, unknown>;
  const fam = rec.inverter_family;
  if (fam === "MICRO" || fam === "CENTRAL") return fam;
  const t = String(rec.inverter_type ?? rec.type ?? "").toLowerCase();
  if (t === "micro") return "MICRO";
  if (t === "string") return "CENTRAL";
  return null;
}
