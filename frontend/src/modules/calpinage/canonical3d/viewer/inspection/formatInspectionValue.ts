/**
 * Formatage FR lisible pour le panneau d’inspection (affichage uniquement).
 */

export function formatAngleDeg(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: 0 })}°`;
}

export function formatPercentFr(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: Number.isInteger(n) ? 0 : 1 })} %`;
}

export function formatLengthM(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: Number.isInteger(n) ? 0 : 2 })} m`;
}

export function formatAreaM2(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toLocaleString("fr-FR", { maximumFractionDigits: 1, minimumFractionDigits: Number.isInteger(n) ? 0 : 1 })} m²`;
}

export function formatDimsM(w: number, h: number): string {
  if (!Number.isFinite(w) || !Number.isFinite(h)) return "—";
  const a = w.toLocaleString("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  const b = h.toLocaleString("fr-FR", { maximumFractionDigits: 2, minimumFractionDigits: 2 });
  return `${a} × ${b} m`;
}

export function formatConfidenceFr(tier: string): string {
  switch (tier) {
    case "high":
      return "Élevée";
    case "medium":
      return "Moyenne";
    case "low":
      return "Faible";
    default:
      return "Inconnue";
  }
}
