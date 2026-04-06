/** Pas de 15 minutes — aligné missions planning (création / édition). */

export function snapToQuarter(date: Date): Date {
  const ms = 1000 * 60 * 15;
  return new Date(Math.round(date.getTime() / ms) * ms);
}
