import type { Activity } from "../../../services/activities.service";
import type { Document } from "../../../components/DocumentUploader";
import type { Quote } from "../../../services/quotes.service";
import type { Study } from "../../../services/studies.service";
import type { LeadTabId } from "./constants";
import { pickPrimaryQuote } from "./financial/leadFinancialDerive";
import { getStudyWorkflowBadge } from "./studyCardUtils";

type PilotTone = "danger" | "warning" | "info" | "success" | "neutral";

export type CommercialPilotActionId =
  | "restore"
  | "complete_contact"
  | "complete_address"
  | "validate_address"
  | "complete_consumption"
  | "create_study"
  | "open_study"
  | "create_quote"
  | "open_financial"
  | "send_email"
  | "mark_signed"
  | "open_dp"
  | "open_documents"
  | "open_notes"
  | "none";

export interface CommercialPilotAction {
  id: CommercialPilotActionId;
  title: string;
  subtitle: string;
  ctaLabel: string;
  tone: PilotTone;
  targetTab?: LeadTabId;
  targetStudyId?: string;
  targetStageId?: string;
}

export interface CommercialPilotBlocker {
  id: string;
  label: string;
  tone: PilotTone;
  targetTab?: LeadTabId;
}

export interface CommercialPilotInteraction {
  label: string;
  title: string;
  dateLabel: string;
  tone: PilotTone;
}

export interface CommercialPilotModel {
  nextAction: CommercialPilotAction;
  lastInteraction: CommercialPilotInteraction | null;
  blockers: CommercialPilotBlocker[];
  primaryQuote: Quote | null;
  primaryStudy: Study | null;
}

interface PilotLead {
  status?: string;
  project_status?: string | null;
  email?: string;
  phone?: string;
  phone_mobile?: string;
  phone_landline?: string;
  consumption_annual_kwh?: number;
  consumption_annual_calculated_kwh?: number;
  consumption_mode?: "ANNUAL" | "MONTHLY" | "PDL";
  consumption_pdl?: string;
}

interface PilotStage {
  id: string;
  name: string;
  code?: string | null;
  position?: number;
}

interface PilotSiteAddress {
  id?: string;
  lat?: number | string | null;
  lon?: number | string | null;
  is_geo_verified?: boolean | string | number | null;
}

interface DeriveCommercialPilotInput {
  lead: PilotLead | null | undefined;
  stage: PilotStage | null | undefined;
  stages: PilotStage[];
  siteAddress: PilotSiteAddress | null | undefined;
  activities: Activity[];
  studies: Study[];
  quotes: Quote[];
  documents: Document[];
  clientDocuments: Document[];
  metersCount: number;
  hasEnergyEngine: boolean;
  hasMonthlyConsumption: boolean;
  isLead: boolean;
  isClient: boolean;
  isArchived: boolean;
  dpFolderAccessible: boolean;
}

const CONTACT_TYPES = new Set(["CALL", "MEETING", "EMAIL", "NOTE"]);

function hasText(v: unknown): boolean {
  return typeof v === "string" && v.trim().length > 0;
}

function daysSince(iso: string): number | null {
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return null;
  return Math.max(0, Math.floor((Date.now() - t) / 86_400_000));
}

function relativeDate(iso: string): string {
  const d = daysSince(iso);
  if (d == null) return "date inconnue";
  if (d === 0) return "aujourd'hui";
  if (d === 1) return "hier";
  return `il y a ${d} jours`;
}

function activityLabel(type: string): string {
  if (type === "CALL") return "Appel";
  if (type === "MEETING") return "RDV";
  if (type === "EMAIL") return "Email";
  if (type === "NOTE") return "Note";
  return type;
}

export function pickLastCommercialInteraction(activities: Activity[]): CommercialPilotInteraction | null {
  const latest = activities
    .filter((a) => CONTACT_TYPES.has(String(a.type)))
    .sort((a, b) => new Date(b.occurred_at).getTime() - new Date(a.occurred_at).getTime())[0];
  if (!latest) return null;

  const d = daysSince(latest.occurred_at);
  const tone: PilotTone = d == null ? "neutral" : d >= 7 ? "danger" : d >= 3 ? "warning" : "success";
  const title = latest.title?.trim() || latest.content?.trim() || "Interaction enregistrée";
  return {
    label: activityLabel(String(latest.type)),
    title,
    dateLabel: relativeDate(latest.occurred_at),
    tone,
  };
}

function pickPrimaryStudy(studies: Study[]): Study | null {
  if (!studies.length) return null;
  return [...studies].sort((a, b) => {
    const da = new Date(a.updated_at || a.created_at || 0).getTime();
    const db = new Date(b.updated_at || b.created_at || 0).getTime();
    return db - da;
  })[0] ?? null;
}

function hasConsumption(input: DeriveCommercialPilotInput): boolean {
  const lead = input.lead;
  return Boolean(
    input.metersCount > 0 ||
      input.hasEnergyEngine ||
      input.hasMonthlyConsumption ||
      (lead?.consumption_annual_kwh != null && Number(lead.consumption_annual_kwh) > 0) ||
      (lead?.consumption_annual_calculated_kwh != null && Number(lead.consumption_annual_calculated_kwh) > 0) ||
      hasText(lead?.consumption_pdl)
  );
}

function isTruthyFlag(value: unknown): boolean {
  return value === true || value === 1 || value === "1" || value === "true";
}

function hasFiniteCoordinate(value: unknown): boolean {
  return value !== null && value !== undefined && value !== "" && Number.isFinite(Number(value));
}

function isAddressVerified(site: PilotSiteAddress | null | undefined): boolean {
  return Boolean(isTruthyFlag(site?.is_geo_verified) && hasFiniteCoordinate(site?.lat) && hasFiniteCoordinate(site?.lon));
}

function signedStage(stages: PilotStage[]): PilotStage | null {
  return stages.find((s) => String(s.code || "").toUpperCase() === "SIGNED") ?? null;
}

function isStageSigned(stage: PilotStage | null | undefined): boolean {
  return String(stage?.code || "").toUpperCase() === "SIGNED";
}

export function deriveCommercialPilot(input: DeriveCommercialPilotInput): CommercialPilotModel {
  const lead = input.lead;
  const hasContact = hasText(lead?.phone_mobile) || hasText(lead?.phone_landline) || hasText(lead?.phone) || hasText(lead?.email);
  const hasAddress = Boolean(input.siteAddress?.id);
  const addressVerified = isAddressVerified(input.siteAddress);
  const consumptionOk = hasConsumption(input);
  const primaryStudy = pickPrimaryStudy(input.studies);
  const primaryQuote = pickPrimaryQuote(input.quotes);
  const quoteStatus = String(primaryQuote?.status || "").toUpperCase();
  const acceptedQuote = input.quotes.some((q) => String(q.status || "").toUpperCase() === "ACCEPTED");
  const signed = signedStage(input.stages);
  const blockers: CommercialPilotBlocker[] = [];

  if (!hasContact) blockers.push({ id: "contact", label: "Coordonnées manquantes", tone: "danger", targetTab: "overview" });
  if (!hasAddress) blockers.push({ id: "address", label: "Adresse chantier manquante", tone: "danger", targetTab: "overview" });
  else if (!addressVerified) blockers.push({ id: "address_verify", label: "Adresse à valider", tone: "warning", targetTab: "overview" });
  if (!consumptionOk) blockers.push({ id: "consumption", label: "Consommation à compléter", tone: "warning", targetTab: "overview" });
  if (input.studies.length === 0) blockers.push({ id: "study_missing", label: "Aucune étude", tone: "danger", targetTab: "studies" });
  if (primaryStudy && !primaryStudy.latest_version_id) {
    blockers.push({ id: "study_version", label: "Étude sans version", tone: "warning", targetTab: "studies" });
  } else if (primaryStudy && getStudyWorkflowBadge(primaryStudy) === "non_calc") {
    blockers.push({ id: "study_calc", label: "Calpinage à finaliser", tone: "warning", targetTab: "studies" });
  }
  if (primaryStudy && input.quotes.length === 0) blockers.push({ id: "quote_missing", label: "Aucun devis", tone: "warning", targetTab: "financial" });
  if (primaryQuote && quoteStatus === "DRAFT") blockers.push({ id: "quote_draft", label: "Devis brouillon", tone: "info", targetTab: "financial" });
  if (primaryQuote && quoteStatus === "SENT") blockers.push({ id: "quote_sent", label: "Devis non signé", tone: "warning", targetTab: "financial" });
  if (acceptedQuote && !isStageSigned(input.stage) && input.isLead) {
    blockers.push({ id: "stage_signed", label: "Étape Signé à confirmer", tone: "warning", targetTab: "financial" });
  }
  if (input.isClient && input.dpFolderAccessible && ["SIGNE", "DP_A_DEPOSER"].includes(String(lead?.project_status || "SIGNE"))) {
    blockers.push({ id: "dp", label: "DP à préparer", tone: "warning", targetTab: "documents" });
  }
  if (input.isClient && input.documents.length + input.clientDocuments.length === 0) {
    blockers.push({ id: "documents", label: "Documents absents", tone: "info", targetTab: "documents" });
  }

  let nextAction: CommercialPilotAction;
  if (input.isArchived) {
    nextAction = {
      id: "restore",
      title: "Dossier archivé",
      subtitle: "Restaurez le dossier pour reprendre le suivi commercial.",
      ctaLabel: "Restaurer",
      tone: "neutral",
    };
  } else if (!hasContact) {
    nextAction = {
      id: "complete_contact",
      title: "Compléter les coordonnées",
      subtitle: "Téléphone ou email requis pour relancer ce prospect.",
      ctaLabel: "Compléter",
      tone: "danger",
      targetTab: "overview",
    };
  } else if (!hasAddress) {
    nextAction = {
      id: "complete_address",
      title: "Compléter l'adresse chantier",
      subtitle: "L'adresse conditionne l'étude, le calpinage et la proposition.",
      ctaLabel: "Compléter",
      tone: "danger",
      targetTab: "overview",
    };
  } else if (!addressVerified) {
    nextAction = {
      id: "validate_address",
      title: "Valider l'emplacement",
      subtitle: "Confirmez la parcelle avant d'aller plus loin dans l'étude.",
      ctaLabel: "Valider",
      tone: "warning",
      targetTab: "overview",
    };
  } else if (!consumptionOk) {
    nextAction = {
      id: "complete_consumption",
      title: "Compléter la consommation",
      subtitle: "La consommation est nécessaire pour une proposition crédible.",
      ctaLabel: "Compléter",
      tone: "warning",
      targetTab: "overview",
    };
  } else if (!primaryStudy) {
    nextAction = {
      id: "create_study",
      title: "Créer l'étude photovoltaïque",
      subtitle: "Le dossier est prêt pour lancer la conception.",
      ctaLabel: "Créer étude",
      tone: "info",
      targetTab: "studies",
    };
  } else if (!primaryStudy.latest_version_id || getStudyWorkflowBadge(primaryStudy) === "non_calc") {
    nextAction = {
      id: "open_study",
      title: "Finaliser l'étude",
      subtitle: "Ouvrez le calpinage pour obtenir une base exploitable.",
      ctaLabel: "Ouvrir étude",
      tone: "warning",
      targetTab: "studies",
      targetStudyId: primaryStudy.id,
    };
  } else if (!primaryQuote) {
    nextAction = {
      id: "create_quote",
      title: "Créer le devis",
      subtitle: "L'étude est disponible, transformez-la en offre commerciale.",
      ctaLabel: "Créer devis",
      tone: "info",
      targetTab: "financial",
      targetStudyId: primaryStudy.id,
    };
  } else if (quoteStatus === "DRAFT" || quoteStatus === "READY_TO_SEND") {
    nextAction = {
      id: "open_financial",
      title: quoteStatus === "DRAFT" ? "Compléter le devis" : "Finaliser l'offre",
      subtitle: "Ouvrez le cockpit financier pour terminer l'offre.",
      ctaLabel: "Ouvrir financier",
      tone: "info",
      targetTab: "financial",
    };
  } else if (quoteStatus === "SENT") {
    nextAction = {
      id: hasText(lead?.email) ? "send_email" : "open_financial",
      title: "Relancer la signature",
      subtitle: "Le devis est envoyé mais pas encore signé.",
      ctaLabel: hasText(lead?.email) ? "Envoyer email" : "Ouvrir financier",
      tone: "warning",
      targetTab: "financial",
    };
  } else if (acceptedQuote && input.isLead && signed && !isStageSigned(input.stage)) {
    nextAction = {
      id: "mark_signed",
      title: "Confirmer l'étape Signé",
      subtitle: "Le devis est accepté : passez le dossier à l'étape Signé pour créer le client.",
      ctaLabel: "Marquer signé",
      tone: "success",
      targetStageId: signed.id,
    };
  } else if (input.dpFolderAccessible) {
    nextAction = {
      id: "open_dp",
      title: "Préparer le dossier DP",
      subtitle: "Le dossier est éligible au suivi DP.",
      ctaLabel: "Ouvrir DP",
      tone: "info",
    };
  } else {
    nextAction = {
      id: "open_notes",
      title: "Mettre à jour le suivi",
      subtitle: "Ajoutez une interaction ou vérifiez les informations du dossier.",
      ctaLabel: "Ajouter note",
      tone: "neutral",
      targetTab: "notes",
    };
  }

  return {
    nextAction,
    lastInteraction: pickLastCommercialInteraction(input.activities),
    blockers: blockers.sort((a, b) => {
      const rank = { danger: 0, warning: 1, info: 2, success: 3, neutral: 4 };
      return rank[a.tone] - rank[b.tone];
    }),
    primaryQuote,
    primaryStudy,
  };
}
