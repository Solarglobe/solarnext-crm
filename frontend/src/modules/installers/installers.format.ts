import type { ElectricalType, InstallationType } from "./installers.types";

export const INSTALLATION_TYPE_LABELS: Record<InstallationType, string> = {
  ROOF_SUPERIMPOSED: "Toiture inclinée / surimposition",
  FLAT_ROOF: "Toit plat",
  GROUND: "Installation au sol",
};

export const ELECTRICAL_TYPE_LABELS: Record<ElectricalType, string> = {
  MONO: "Monophasé",
  TRI: "Triphasé",
};

export function centsToEuros(cents: number | null | undefined): number {
  const n = Number(cents);
  return Number.isFinite(n) ? Math.round(n) / 100 : 0;
}

export function eurosToCents(euros: number | string | null | undefined): number {
  const n = typeof euros === "string" ? Number(euros.replace(",", ".")) : Number(euros);
  return Number.isFinite(n) ? Math.round(n * 100) : 0;
}

export function formatEuroHtFromCents(cents: number | null | undefined): string {
  return `${centsToEuros(cents).toLocaleString("fr-FR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })} € HT`;
}

export function formatKwcFromWc(wc: number | null | undefined): string {
  const n = Number(wc);
  if (!Number.isFinite(n)) return "—";
  return `${(Math.round((n / 1000) * 100) / 100).toLocaleString("fr-FR", {
    minimumFractionDigits: 0,
    maximumFractionDigits: 2,
  })} kWc`;
}

export function formatDateFr(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("fr-FR");
}
