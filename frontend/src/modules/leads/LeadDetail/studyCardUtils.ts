import type { Study } from "../../../services/studies.service";

export type StudyWorkflowBadge = "non_calc" | "calcule" | "devis" | "signe";

/** NON CALCULÉ → CALCULÉ → DEVIS GÉNÉRÉ → SIGNÉ (priorité signé si au moins un devis signé). */
export function getStudyWorkflowBadge(
  study: Pick<Study, "has_scenarios_v2" | "quote_has_signed" | "quote_exists">
): StudyWorkflowBadge {
  if (!study.has_scenarios_v2) return "non_calc";
  if (study.quote_has_signed === true) return "signe";
  if (study.quote_exists === true) return "devis";
  return "calcule";
}

export function workflowBadgeLabel(key: StudyWorkflowBadge): string {
  switch (key) {
    case "signe":
      return "SIGNÉ";
    case "devis":
      return "DEVIS GÉNÉRÉ";
    case "calcule":
      return "CALCULÉ";
    default:
      return "NON CALCULÉ";
  }
}

/** Puissance pour la ligne « installée » (calpinage puis scénario BASE). */
export function formatStudyPowerKw(study: Pick<Study, "calpinage_power_kwc" | "scenario_hardware_kwc">): string {
  const raw = study.calpinage_power_kwc ?? study.scenario_hardware_kwc;
  if (raw == null || raw === "") return "—";
  const n = typeof raw === "number" ? raw : Number(String(raw).replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return "—";
  return `${n.toFixed(1)} kWc`;
}

export function formatStudyUpdatedAt(iso: string | undefined): string {
  if (!iso) return "—";
  try {
    return new Date(iso).toLocaleDateString("fr-FR", {
      day: "2-digit",
      month: "short",
      year: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return "—";
  }
}

/** Sous-titre nom métier si différent du numéro SGS. */
export function studyCustomTitleSubtitle(study: Pick<Study, "title" | "study_number">): string | null {
  const t = study.title?.trim();
  if (!t) return null;
  if (t === study.study_number?.trim()) return null;
  return t;
}
