/**
 * Normalise la famille d'onduleur à partir de inverter_family ou inverter_type (legacy).
 * Lecture seule, pas de modification DB.
 */

export function normalizeInverterFamily(inv: any): "MICRO" | "CENTRAL" | null {
  if (!inv) return null;
  const fam = inv.inverter_family;
  if (fam === "MICRO" || fam === "CENTRAL") return fam;
  const t = (inv.inverter_type || inv.type || "").toLowerCase();
  if (t === "micro") return "MICRO";
  if (t === "string") return "CENTRAL";
  return null;
}
