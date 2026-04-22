/**
 * CP-077-BIS — Affichage inbox (pas de logique métier serveur).
 */

export function emailLocalPart(email: string | null | undefined): string {
  if (!email) return "?";
  const at = email.indexOf("@");
  return at > 0 ? email.slice(0, at) : email;
}

export function formatSmartDate(iso: string | null | undefined): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  const now = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const d0 = startOf(d);
  const n0 = startOf(now);
  const diffDays = Math.round((n0.getTime() - d0.getTime()) / 86400000);
  if (diffDays === 0) {
    return d.toLocaleTimeString("fr-FR", { hour: "2-digit", minute: "2-digit" });
  }
  if (diffDays === 1) return "Hier";
  if (diffDays < 7) {
    return d.toLocaleDateString("fr-FR", { weekday: "short" });
  }
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "short" });
}

export function getSenderLabel(t: {
  lastMessage?: {
    direction?: string | null;
    fromName?: string | null;
    from?: string | null;
  } | null;
}): string {
  const dir = t.lastMessage?.direction;
  if (dir === "OUTBOUND") return "Vous";
  const name = t.lastMessage?.fromName?.trim();
  if (name) return name;
  return emailLocalPart(t.lastMessage?.from ?? null);
}

export function avatarLetter(label: string): string {
  const c = label.trim().charAt(0);
  return c ? c.toUpperCase() : "?";
}
