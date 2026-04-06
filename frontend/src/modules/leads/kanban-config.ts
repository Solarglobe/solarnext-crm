/**
 * Pipeline Kanban — ordre colonnes, libellés, classes (code pipeline_stages.code)
 */

export const KANBAN_COLUMN_ORDER = [
  "NEW",
  "QUALIFIED",
  "APPOINTMENT",
  "OFFER_SENT",
  "IN_REFLECTION",
  "FOLLOW_UP",
  "SIGNED",
  "LOST",
  "CONTACTED",
] as const;

export type KanbanPipelineCode = (typeof KANBAN_COLUMN_ORDER)[number] | string;

/** Libellés UI pour codes (priorité sur le nom brut si défini) */
export const STATUS_LABELS: Partial<Record<string, string>> = {
  IN_REFLECTION: "En réflexion",
  FOLLOW_UP: "Relance",
  LOST: "Devis perdu",
};

/** Classes colonnes — dégradé inversé (270°) pour « fermeture » visuelle du pipeline */
export const COLUMN_CLASS_BY_CODE: Partial<Record<string, string>> = {
  IN_REFLECTION: "kanban-column-reflection",
  FOLLOW_UP: "kanban-column-followup",
};

/** Modificateurs cartes (prioritaires sur .stage-N) */
export const CARD_PIPELINE_CLASS_BY_CODE: Partial<Record<string, string>> = {
  IN_REFLECTION: "lead-card--pipeline-reflection",
  FOLLOW_UP: "lead-card--pipeline-followup",
};

export interface StageLike {
  name: string;
  position?: number;
  code?: string | null;
}

/** Infère le code métier depuis pipeline_stages.code ou le nom (FR / patterns). */
export function inferStageCode(stage: StageLike): string | null {
  const raw = stage.code?.trim();
  if (raw) return raw.toUpperCase();
  const n = stage.name.toLowerCase();
  if (/nouveau|^new\b/i.test(n)) return "NEW";
  if (/qualif/i.test(n)) return "QUALIFIED";
  if (/rdv|appoint|planif/i.test(n)) return "APPOINTMENT";
  if (/offre|envoy|offer/i.test(n)) return "OFFER_SENT";
  if (/réflexion|reflexion|reflection/i.test(n)) return "IN_REFLECTION";
  if (/relance|follow|suivi/i.test(n)) return "FOLLOW_UP";
  if (/perdu|lost/i.test(n)) return "LOST";
  if (/signé|signed/i.test(n)) return "SIGNED";
  if (/contact/i.test(n)) return "CONTACTED";
  return null;
}

export function getKanbanColumnTitle(stage: StageLike): string {
  const c = inferStageCode(stage);
  if (c && STATUS_LABELS[c]) return STATUS_LABELS[c];
  return stage.name;
}

/** Ordre d’affichage : KANBAN_COLUMN_ORDER, puis colonnes inconnues par position. */
export function sortStagesForKanban<T extends StageLike>(stages: T[]): T[] {
  const orderIndex = (code: string | null) => {
    if (!code) return 900;
    const i = (KANBAN_COLUMN_ORDER as readonly string[]).indexOf(code);
    return i === -1 ? 800 : i;
  };
  return [...stages].sort((a, b) => {
    const ca = inferStageCode(a);
    const cb = inferStageCode(b);
    const da = orderIndex(ca);
    const db = orderIndex(cb);
    if (da !== db) return da - db;
    return (a.position ?? 0) - (b.position ?? 0);
  });
}
