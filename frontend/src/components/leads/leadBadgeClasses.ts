/** Classes badges Leads — sémantique unifiée (carte + liste) via sn-badge */

/** Indice colonne pipeline (1–5) à partir du libellé de stage API */
export function stageIndexFromStageName(name?: string | null): number {
  if (!name) return 1;
  const n = name.toLowerCase();
  if (/signé|signe|gagné|gagne|closed|won/i.test(n)) return 5;
  if (/offre|proposition|devis|quote/i.test(n)) return 4;
  if (/rdv|rendez|entretien|meeting/i.test(n)) return 3;
  if (/contact|contacté|contacte|qualif/i.test(n)) return 2;
  if (/nouveau|new|entrant/i.test(n)) return 1;
  return 1;
}

function stageTone(stageIndex: number): "neutral" | "info" | "warn" | "success" {
  const i = Math.min(5, Math.max(1, Math.floor(stageIndex)));
  if (i <= 1) return "neutral";
  if (i <= 3) return "info";
  if (i === 4) return "warn";
  return "success";
}

export function stagePillClass(stageIndex: number): string {
  const t = stageTone(stageIndex);
  return `sn-badge sn-badge-${t}`;
}

export function scoreBadgeClass(score: number): string {
  if (score >= 70) return "sn-badge sn-badge-success";
  if (score >= 40) return "sn-badge sn-badge-warn";
  return "sn-badge sn-badge-neutral";
}

export function inactivityBadgeClass(level: string): string {
  switch (level) {
    case "warning":
      return "sn-badge sn-badge-warn";
    case "danger":
      return "sn-badge sn-badge-warn";
    case "critical":
      return "sn-badge sn-badge-danger";
    case "none":
      return "sn-badge sn-badge-success";
    default:
      return "";
  }
}

export function inactivityLabelShort(level: string): string {
  switch (level) {
    case "warning":
      return "≥3 j";
    case "danger":
      return "≥7 j";
    case "critical":
      return "≥14 j";
    default:
      return "—";
  }
}

/** Libellé palier seul (seuils ≥3 / ≥7 / ≥14 j) — ne pas présenter comme durée exacte. */
export function inactivityLabelLong(level: string): string {
  switch (level) {
    case "warning":
      return "Palier ≥3 j";
    case "danger":
      return "Palier ≥7 j";
    case "critical":
      return "Palier ≥14 j";
    default:
      return "";
  }
}

/**
 * Calcule le nombre de jours entiers écoulés depuis une date.
 * Retourne null si la date est absente ou invalide.
 */
function daysSince(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const d = new Date(dateStr);
  if (isNaN(d.getTime())) return null;
  const diffMs = Date.now() - d.getTime();
  return Math.floor(diffMs / (1000 * 60 * 60 * 24));
}

/**
 * Formate le nombre de jours en texte court humain.
 * Exemples : "aujourd'hui", "1j", "4j", "18j"
 */
function formatDays(days: number): string {
  if (days <= 0) return "aujourd'hui";
  if (days === 1) return "1j";
  return `${days}j`;
}

/**
 * Retourne le label hybride "Texte métier · Xj" pour la colonne Inactivité.
 * Affichage premium : lisible commercialement ET informatif.
 *
 * Exemples :
 *  - "À jour · aujourd'hui"
 *  - "À jour · 2j"
 *  - "À surveiller · 4j"
 *  - "Relance · 9j"
 *  - "Critique · 18j"
 */
export function inactivityLabelHybrid(
  level: string,
  lastActivityAt: string | null | undefined
): string {
  const days = daysSince(lastActivityAt);
  const dayPart = days !== null ? ` · ${formatDays(days)}` : "";

  switch (level) {
    case "critical":
      return `Critique${dayPart}`;
    case "danger":
      return `Relance${dayPart}`;
    case "warning":
      return `À surveiller${dayPart}`;
    case "none":
    default:
      return `Actif${dayPart}`;
  }
}

/** Badges très discrets — vue liste uniquement (ne pas utiliser sur cartes Kanban). */
export function listRowScoreClass(score: number): string {
  if (score >= 70) return "sn-badge sn-badge-success";
  if (score >= 40) return "sn-badge sn-badge-warn";
  return "sn-badge sn-badge-neutral";
}

export function listRowStageClass(stageIndex: number): string {
  const t = stageTone(stageIndex);
  return `sn-badge sn-badge-${t}`;
}

export function listRowInactivityClass(level: string): string {
  switch (level) {
    case "warning":
      return "sn-badge sn-badge-warn";
    case "danger":
      return "sn-badge sn-badge-warn";
    case "critical":
      return "sn-badge sn-badge-danger";
    case "none":
    default:
      return "sn-badge sn-badge-success";
  }
}
