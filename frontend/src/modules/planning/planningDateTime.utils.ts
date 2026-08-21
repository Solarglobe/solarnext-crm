/** Pas de 15 minutes — aligné missions planning (création / édition). */

export function snapToQuarter(date: Date): Date {
  const ms = 1000 * 60 * 15;
  return new Date(Math.round(date.getTime() / ms) * ms);
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

/**
 * Format attendu par un input datetime-local: heure locale, sans fuseau.
 * Ne jamais utiliser `toISOString().slice(0, 16)` ici: ça tronque l'heure UTC.
 */
export function formatDateTimeLocal(value: Date | string): string {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return [
    date.getFullYear(),
    pad2(date.getMonth() + 1),
    pad2(date.getDate()),
  ].join("-") + `T${pad2(date.getHours())}:${pad2(date.getMinutes())}`;
}

export function parseDateTimeLocal(value: string): Date {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) {
    const fallback = new Date(value);
    if (Number.isNaN(fallback.getTime())) throw new Error("Date/heure invalide");
    return fallback;
  }
  const [, y, mo, d, h, mi] = match;
  return new Date(
    Number(y),
    Number(mo) - 1,
    Number(d),
    Number(h),
    Number(mi),
    0,
    0
  );
}

export function snapDateTimeLocal(value: string): string {
  return formatDateTimeLocal(snapToQuarter(parseDateTimeLocal(value)));
}

export function dateTimeLocalToServerIso(value: string): string {
  return parseDateTimeLocal(value).toISOString();
}
