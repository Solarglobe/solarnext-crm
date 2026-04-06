/**
 * Flux métier « déclaration préalable refusée » — payloads PATCH /api/leads/:id
 * DP_REFUSED n’est pas un project_status persisté : uniquement déclencheur UI.
 */

export type DPRefusedChoice = "corriger" | "attente" | "perdu";

export const LOST_REASON_DP_REFUSED = "DP_REFUSED";

/** Tag traçable côté activité (option « mise en attente ») */
export const ACTIVITY_TAG_DP_RETRY_LATER = "DP_RETRY_LATER";

export interface DpRefusedPatchBody {
  status: string;
  project_status?: string | null;
  lost_reason?: string | null;
}

export function buildDpRefusedPatch(choice: DPRefusedChoice): DpRefusedPatchBody {
  switch (choice) {
    case "corriger":
      return { status: "IN_REFLECTION", project_status: null, lost_reason: null };
    case "attente":
      return { status: "FOLLOW_UP", project_status: null, lost_reason: null };
    case "perdu":
      return {
        status: "LOST",
        lost_reason: LOST_REASON_DP_REFUSED,
        project_status: null,
      };
    default:
      return { status: "FOLLOW_UP", project_status: null, lost_reason: null };
  }
}
