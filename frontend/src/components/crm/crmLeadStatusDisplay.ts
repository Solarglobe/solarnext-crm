/** Tonalités badge statut CRM — couleurs unifiées (liste, kanban, fiche). */

export type CrmLeadStatusTone = "lead" | "qualified" | "client" | "lost";

export interface CrmLeadStatusResolveOptions {
  stageName?: string | null;
  stageCode?: string | null;
}

const SHORT_LABELS: Record<string, string> = {
  LEAD: "Lead",
  NEW: "Nouveau",
  QUALIFIED: "Qualifié",
  APPOINTMENT: "RDV",
  STUDY: "Étude",
  OFFER_SENT: "Offre",
  FOLLOW_UP: "À relancer",
  LOST: "Perdu",
  CONTACTED: "Injoignable",
  CLIENT: "Client",
  ARCHIVED: "Archivé",
  SIGNED: "Signé",
};

/**
 * Résout la tonalité couleur à partir du statut API et optionnellement pipeline.
 */
export function resolveCrmLeadStatusTone(
  status?: string | null,
  options?: CrmLeadStatusResolveOptions
): CrmLeadStatusTone {
  const code = String(options?.stageCode || "").toUpperCase();
  if (code === "LOST") return "lost";

  const s = String(status || "LEAD").toUpperCase();
  if (s === "CLIENT") return "client";
  if (s === "LOST") return "lost";
  if (s === "QUALIFIED") return "qualified";

  const stg = String(options?.stageName || "").toLowerCase();
  if (/\bperdu\b|lost/i.test(stg)) return "lost";
  if (/\bqualifi/i.test(stg) && s !== "CLIENT") return "qualified";

  return "lead";
}

/** Libellé court affiché dans le badge (lisible au premier coup d’œil). */
export function crmLeadStatusShortLabel(
  status: string | null | undefined,
  tone: CrmLeadStatusTone
): string {
  const s = String(status || "").toUpperCase();
  if (tone === "client") return "Client";
  if (tone === "lost") return "Perdu";
  if (tone === "qualified") {
    if (s === "QUALIFIED") return "Qualifié";
    return SHORT_LABELS[s] || "Qualifié";
  }
  return SHORT_LABELS[s] || "Lead";
}
