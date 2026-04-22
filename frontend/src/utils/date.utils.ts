/**
 * Utilitaires de dates en heure locale (évite les décalages timezone avec toISOString)
 */

export function toLocalISODate(date: Date): string {
  const y = date.getFullYear();
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

/** ISO date (YYYY-MM-DD ou avec temps) → JJ/MM/AAAA ; `null` si vide ou invalide. */
export function formatDateFR(date: string | Date | null | undefined): string | null {
  if (date == null || date === "") return null;
  const head = typeof date === "string" ? date.slice(0, 10) : toLocalISODate(date);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(head)) return null;
  const d = new Date(`${head}T12:00:00`);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit", year: "numeric" });
}
