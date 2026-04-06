/**
 * Suivi projet PV — uniquement à partir de project_status (pas lead.status / Kanban)
 */

import type { Lead } from "../../services/leads.service";
import dayjs from "dayjs";
import relativeTime from "dayjs/plugin/relativeTime";
import "dayjs/locale/fr";

dayjs.extend(relativeTime);
dayjs.locale("fr");

/** Avancement % — statuts PV cible + mapping des statuts API existants */
export function getProjectProgress(status: string | undefined): number {
  if (!status) return 0;
  const s = status.toUpperCase();
  switch (s) {
    case "ETUDE":
      return 10;
    case "MAIRIE":
      return 30;
    case "ACCORD_MAIRIE":
      return 50;
    case "PLANIFICATION":
      return 70;
    case "INSTALLATION":
      return 85;
    case "RACCORDEMENT":
      return 95;
    case "TERMINE":
      return 100;
    case "SIGNE":
      return 10;
    case "DP_A_DEPOSER":
      return 18;
    case "DP_DEPOSE":
      return 32;
    case "DP_ACCEPTE":
      return 48;
    case "INSTALLATION_PLANIFIEE":
      return 72;
    case "INSTALLATION_REALISEE":
      return 84;
    case "CONSUEL_EN_ATTENTE":
      return 90;
    case "CONSUEL_OBTENU":
      return 93;
    case "MISE_EN_SERVICE":
      return 97;
    case "FACTURATION_TERMINEE":
      return 99;
    case "CLOTURE":
      return 100;
    default:
      return 0;
  }
}

export function getNextStep(status: string | undefined): string {
  if (!status) return "—";
  const s = status.toUpperCase();
  switch (s) {
    case "ETUDE":
      return "Finaliser étude";
    case "MAIRIE":
      return "Attente mairie";
    case "ACCORD_MAIRIE":
      return "Planifier installation";
    case "PLANIFICATION":
      return "Fixer date pose";
    case "INSTALLATION":
      return "Réaliser pose";
    case "RACCORDEMENT":
      return "Attente Enedis";
    case "TERMINE":
      return "Projet terminé";
    case "SIGNE":
      return "Lancer les démarches administratives";
    case "DP_A_DEPOSER":
      return "Déposer le dossier";
    case "DP_DEPOSE":
      return "Suivi instruction";
    case "DP_ACCEPTE":
      return "Planifier installation";
    case "INSTALLATION_PLANIFIEE":
      return "Fixer date pose";
    case "INSTALLATION_REALISEE":
      return "Suivi consuel / raccordement";
    case "CONSUEL_EN_ATTENTE":
      return "Attente passage consuel";
    case "CONSUEL_OBTENU":
      return "Mise en service";
    case "MISE_EN_SERVICE":
      return "Facturation";
    case "FACTURATION_TERMINEE":
      return "Clôturer le dossier";
    case "CLOTURE":
      return "Projet terminé";
    default:
      return "-";
  }
}

const STATUS_LABELS: Record<string, string> = {
  ETUDE: "Étude",
  MAIRIE: "Mairie",
  ACCORD_MAIRIE: "Accord mairie",
  PLANIFICATION: "Planification",
  INSTALLATION: "Installation",
  RACCORDEMENT: "Raccordement",
  TERMINE: "Terminé",
  SIGNE: "Signé",
  DP_A_DEPOSER: "DP à déposer",
  DP_DEPOSE: "DP déposé",
  DP_REFUSED: "DP refusé",
  DP_ACCEPTE: "DP accepté",
  INSTALLATION_PLANIFIEE: "Install. planifiée",
  INSTALLATION_REALISEE: "Install. réalisée",
  CONSUEL_EN_ATTENTE: "Consuel attente",
  CONSUEL_OBTENU: "Consuel obtenu",
  MISE_EN_SERVICE: "Mise en service",
  FACTURATION_TERMINEE: "Facturation OK",
  CLOTURE: "Clôturé",
};

export function formatProjectStatus(status: string | undefined): string {
  if (!status) return "—";
  const u = status.toUpperCase();
  return STATUS_LABELS[u] ?? status.replace(/_/g, " ");
}

/** Agrégat unique pour liste Clients + panneau détail (même %, étape, libellé) */
export type ProjectTracking = {
  progress: number;
  nextStep: string;
  statusLabel: string;
};

export function getProjectTracking(lead: Lead): ProjectTracking {
  const ps = lead.project_status;
  return {
    progress: getProjectProgress(ps),
    nextStep: getNextStep(ps),
    statusLabel: formatProjectStatus(ps),
  };
}

function startOfDay(d: Date): Date {
  const x = new Date(d);
  x.setHours(0, 0, 0, 0);
  return x;
}

function daysBetweenNowAnd(dateIso: string): number {
  return Math.round(
    (startOfDay(new Date()).getTime() - startOfDay(new Date(dateIso)).getTime()) /
      (24 * 60 * 60 * 1000)
  );
}

/** Dernière activité = updated_at uniquement (demande métier) */
export function formatUpdatedAtRelative(lead: Lead): {
  text: string;
  warn: boolean;
} {
  const u = lead.updated_at;
  if (!u) return { text: "—", warn: false };
  const days = daysBetweenNowAnd(u);
  return {
    text: dayjs(u).fromNow(),
    warn: days > 10,
  };
}

/** Date signature affichée : signed_at si exposé par l’API, sinon updated_at */
export function getSignatureDateRaw(lead: Lead): string | undefined {
  return lead.signed_at ?? lead.updated_at;
}

export function formatSignatureDate(lead: Lead): string {
  const raw = getSignatureDateRaw(lead);
  if (!raw) return "—";
  return new Date(raw).toLocaleDateString("fr-FR", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
}

export function isTerminalProjectStatus(ps: string | undefined): boolean {
  if (!ps) return false;
  const u = ps.toUpperCase();
  return (
    u === "CLOTURE" ||
    u === "TERMINE" ||
    u === "FACTURATION_TERMINEE"
  );
}

export function isInstallationPhase(ps: string | undefined): boolean {
  if (!ps) return false;
  const u = ps.toUpperCase();
  return (
    u === "INSTALLATION" ||
    u === "INSTALLATION_PLANIFIEE" ||
    u === "INSTALLATION_REALISEE"
  );
}

/** Dépôt / instruction / attentes type « mairie » ou consuel en attente */
export function isMairieOrDpPending(ps: string | undefined): boolean {
  if (!ps) return false;
  const u = ps.toUpperCase();
  return (
    u === "MAIRIE" ||
    u === "ACCORD_MAIRIE" ||
    u === "DP_A_DEPOSER" ||
    u === "DP_DEPOSE" ||
    u === "DP_ACCEPTE" ||
    u === "CONSUEL_EN_ATTENTE"
  );
}

export function computeProjectKpis(leads: Lead[]) {
  let enCours = 0;
  let enInstallation = 0;
  let attenteMairie = 0;
  let termines = 0;

  for (const lead of leads) {
    const ps = lead.project_status;
    if (isTerminalProjectStatus(ps)) {
      termines += 1;
      continue;
    }
    enCours += 1;
    if (isInstallationPhase(ps)) enInstallation += 1;
    if (isMairieOrDpPending(ps)) attenteMairie += 1;
  }

  return { enCours, enInstallation, attenteMairie, termines };
}
