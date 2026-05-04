/**
 * Libellés & aide portail — tests unitaires légers possibles.
 */
import type { MairieDto, MairieAccountStatus, MairiePortalType } from "../../services/mairies.api";

const STATUS_LABEL: Record<MairieAccountStatus, string> = {
  none: "Non créé",
  to_create: "À créer",
  created: "OK",
};

/** Libellé liste terrain : couleur (emoji) + texte explicite — jamais couleur seule. */
const STATUS_BADGE_TEXT: Record<MairieAccountStatus, string> = {
  none: "🔴 Non créé",
  to_create: "🟠 À créer",
  created: "🟢 Compte OK",
};

const TYPE_LABEL: Record<MairiePortalType, string> = {
  online: "Online",
  email: "Email",
  paper: "Papier",
};

export function formatMairieStatusLabel(s: MairieAccountStatus): string {
  return STATUS_LABEL[s] ?? s;
}

/** Badge statut (tableau mairies) — emoji + texte lisible. */
export function formatMairieStatusBadgeText(s: MairieAccountStatus): string {
  return STATUS_BADGE_TEXT[s] ?? formatMairieStatusLabel(s);
}

export function formatMairiePortalTypeLabel(t: MairiePortalType): string {
  return TYPE_LABEL[t] ?? t;
}

export function statusBadgeClass(s: MairieAccountStatus): string {
  switch (s) {
    case "none":
      return "sn-badge sn-badge-danger";
    case "to_create":
      return "sn-badge sn-badge-warn";
    case "created":
      return "sn-badge sn-badge-success";
    default:
      return "sn-badge sn-badge-neutral";
  }
}

/**
 * Lien pour « Ouvrir » : URL portail si présente ;
 * sinon email compte → mailto (terrain : pas seulement type « email »).
 */
export function resolveOpenHref(row: MairieDto): string | null {
  const url = row.portal_url?.trim();
  if (url) return url;
  const em = row.account_email?.trim();
  if (em) return `mailto:${em}`;
  return null;
}

/** Tooltip bouton d’ouverture selon cible (web vs contact). */
export function getOpenPortalTooltip(href: string | null): string {
  if (!href) return "";
  return href.trim().toLowerCase().startsWith("mailto:") ? "Contacter la mairie" : "Ouvrir le portail";
}

const MS_DAY = 24 * 60 * 60 * 1000;

/** Indicateur « récent » : last_used_at dans les N derniers jours. */
export function isLastUsedWithinDays(iso: string | null | undefined, days: number): boolean {
  if (iso == null || iso === "") return false;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return false;
  return Date.now() - t < days * MS_DAY;
}
