/**
 * CP-LEAD-V2 — Constantes centralisées pour LeadDetail
 */

/** CP-LEAD-CLIENT-UNIFICATION — Structure unique : tous les onglets visibles pour Lead et Client */
export const ALL_TABS = [
  "overview",
  "studies",
  "rdv",
  "financial",
  "notes",
  "history",
  "documents",
] as const;

export type LeadTabId = (typeof ALL_TABS)[number];

export const PROJECT_CYCLE_STEPS = [
  "SIGNE",
  "DP_A_DEPOSER",
  "DP_DEPOSE",
  "DP_ACCEPTE",
  "INSTALLATION_PLANIFIEE",
  "INSTALLATION_REALISEE",
  "CONSUEL_EN_ATTENTE",
  "CONSUEL_OBTENU",
  "MISE_EN_SERVICE",
  "FACTURATION_TERMINEE",
  "CLOTURE",
] as const;

export const PROJECT_CYCLE_LABELS: Record<string, string> = {
  SIGNE: "Signé",
  DP_A_DEPOSER: "DP à déposer",
  DP_DEPOSE: "DP déposé",
  DP_REFUSED: "DP refusé",
  DP_ACCEPTE: "DP accepté",
  INSTALLATION_PLANIFIEE: "Install.",
  INSTALLATION_REALISEE: "Install. OK",
  CONSUEL_EN_ATTENTE: "Consuel",
  CONSUEL_OBTENU: "Consuel OK",
  MISE_EN_SERVICE: "Mise en service",
  FACTURATION_TERMINEE: "Facturé",
  CLOTURE: "Clôturé",
};

export const CYCLE_PROJECT_SELECT_OPTIONS = [
  { value: "SIGNE", label: "Signé" },
  { value: "DP_A_DEPOSER", label: "DP à déposer" },
  { value: "DP_DEPOSE", label: "DP déposé" },
  /** Valeur UI uniquement — ouvre le modal métier, non persistée telle quelle */
  { value: "DP_REFUSED", label: "DP refusé" },
  { value: "DP_ACCEPTE", label: "DP accepté" },
  { value: "INSTALLATION_PLANIFIEE", label: "Installation planifiée" },
  { value: "INSTALLATION_REALISEE", label: "Installation réalisée" },
  { value: "CONSUEL_EN_ATTENTE", label: "Consuel en attente" },
  { value: "CONSUEL_OBTENU", label: "Consuel obtenu" },
  { value: "MISE_EN_SERVICE", label: "Mise en service" },
  { value: "FACTURATION_TERMINEE", label: "Facturation terminée" },
  { value: "CLOTURE", label: "Clôturé" },
];

/**
 * Accès route dossier DP (`/leads/:id/dp`) — aligné règle backend `isDpAccessEligible`.
 */
export function isLeadDpFolderAccessible(lead: {
  status?: string;
  project_status?: string | null;
}): boolean {
  if (lead.status === "CLIENT") return true;
  const ps = lead.project_status;
  return ps === "SIGNE" || ps === "DP_A_DEPOSER";
}
