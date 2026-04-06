/**
 * Formatage FR des valeurs énergie / puissance pour l’UI Lead Detail (affichage commercial).
 */

const LOCALE = "fr-FR";

/** Entier avec espaces insécables typographiques (ex. 16 995). */
export function formatIntegerFr(value: number): string {
  if (!Number.isFinite(value)) return "—";
  return Math.round(value).toLocaleString(LOCALE);
}

/** kWh — arrondi à l’unité, pas de décimales parasites. */
export function formatEnergyKwh(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatIntegerFr(value)} kWh`;
}

/** kWh/an (libellé court pour lignes de statut). */
export function formatEnergyKwhPerYear(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${formatIntegerFr(value)} kWh/an`;
}

/**
 * kVA — entier si proche d’un entier, sinon une décimale max.
 */
export function formatPowerKva(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = value;
  const isInt = Math.abs(v - Math.round(v)) < 1e-6;
  if (isInt) {
    return `${Math.round(v).toLocaleString(LOCALE)} kVA`;
  }
  const rounded = Math.round(v * 10) / 10;
  return `${rounded.toLocaleString(LOCALE, { minimumFractionDigits: 1, maximumFractionDigits: 1 })} kVA`;
}

/** Production ou énergie annuelle (même règle que kWh). */
export function formatProductionKwh(value: number | null | undefined): string {
  return formatEnergyKwh(value);
}

/** Montants € (TTC, capex, etc.) — sans décimales si entier. */
export function formatEuroAmount(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const v = value;
  const isInt = Math.abs(v - Math.round(v)) < 0.005;
  if (isInt) {
    return `${Math.round(v).toLocaleString(LOCALE)} €`;
  }
  return `${v.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 2 })} €`;
}

/** €/kWh — typiquement 2–4 décimales utiles. */
export function formatEuroPerKwh(value: number | null | undefined): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return `${value.toLocaleString(LOCALE, { minimumFractionDigits: 2, maximumFractionDigits: 4 })} €/kWh`;
}
