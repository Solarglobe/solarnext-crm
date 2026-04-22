/**
 * Règles métier simples — alertes à partir d’un payload normalisé (pas d’API).
 */

import type { VisiteTechniquePayload } from "./visiteTechnique.mapper";

export type VisiteTechniqueProjectStatus = "OK" | "WARNING" | "BLOCKED";

export type VisiteTechniqueChantierDifficulte =
  | "FACILE"
  | "MOYENNE"
  | "DIFFICILE";

export type VisiteTechniqueChantierSummary = {
  checklist: string[];
  contraintes: string[];
  difficulte: VisiteTechniqueChantierDifficulte;
  materiel: string[];
};

export type VisiteTechniqueEvaluationResult = {
  alerts: {
    blocking: string[];
    warning: string[];
  };
  score: number;
  status: VisiteTechniqueProjectStatus;
  chantier_summary: VisiteTechniqueChantierSummary;
};

function isNonEmptyString(value: string | null | undefined): boolean {
  if (value == null) return false;
  return String(value).trim() !== "";
}

const SCORE_BASE = 100;
const SCORE_BLOCKING = 50;
const SCORE_WARNING = 10;

function computeScore(blockingCount: number, warningCount: number): number {
  const raw =
    SCORE_BASE - blockingCount * SCORE_BLOCKING - warningCount * SCORE_WARNING;
  if (!Number.isFinite(raw)) {
    return 0;
  }
  return Math.max(0, Math.min(100, raw));
}

function computeStatus(
  blockingCount: number,
  warningCount: number
): VisiteTechniqueProjectStatus {
  if (blockingCount >= 1) return "BLOCKED";
  if (warningCount >= 1) return "WARNING";
  return "OK";
}

function dedupeStrings(items: string[]): string[] {
  return [...new Set(items)];
}

/** Payload CRM : `tri` ; variante texte possible côté API. */
function isTriphase(typeRaccordement: string | null | undefined): boolean {
  const v = typeRaccordement ?? "";
  return v === "tri" || v === "triphasé";
}

function buildChantierSummary(
  payload: VisiteTechniquePayload,
  warningCount: number
): VisiteTechniqueChantierSummary {
  const checklist: string[] = [];
  const contraintes: string[] = [];
  const materiel: string[] = [];

  const toiture = payload?.toiture;
  const electrique = payload?.electrique;
  const chantier = payload?.chantier;
  const environnement = payload?.environnement;

  const typeRaccordement = electrique?.type_raccordement ?? null;

  if (electrique?.linky === true) {
    checklist.push("Vérifier le raccordement sur compteur Linky");
  }
  if (isTriphase(typeRaccordement)) {
    checklist.push("Vérifier l'équilibrage des phases");
  }
  if (chantier?.point_ancrage === true) {
    checklist.push("Contrôler les points d'ancrage existants");
  }
  if (chantier?.stockage === true) {
    checklist.push("Prévoir zone de stockage");
  }

  if (chantier?.acces_toit === "difficile") {
    contraintes.push("Accès toiture difficile");
  }
  if (environnement?.ombrage === true) {
    contraintes.push("Présence d'ombrage");
  }
  if (toiture?.combles_accessibles === false) {
    contraintes.push("Combles non accessibles");
  }

  let difficulte: VisiteTechniqueChantierDifficulte = "FACILE";
  if (chantier?.acces_toit === "difficile") {
    difficulte = "DIFFICILE";
  } else if (warningCount >= 2) {
    difficulte = "MOYENNE";
  }

  if (chantier?.acces_toit === "difficile") {
    materiel.push("Nacelle ou échafaudage");
  }
  if (chantier?.point_ancrage === false) {
    materiel.push("Système d'ancrage temporaire");
  }
  if (isTriphase(typeRaccordement)) {
    materiel.push("Matériel équilibrage triphasé");
  }

  return {
    checklist: dedupeStrings(checklist),
    contraintes: dedupeStrings(contraintes),
    difficulte,
    materiel: dedupeStrings(materiel),
  };
}

/**
 * Évalue des risques simples (chantier / sécurité / accès).
 * Tolère des champs absents ou null sans lever d’exception.
 */
export function evaluateVisiteTechnique(
  payload: VisiteTechniquePayload
): VisiteTechniqueEvaluationResult {
  const blocking: string[] = [];
  const warning: string[] = [];

  const toiture = payload?.toiture;
  const electrique = payload?.electrique;
  const chantier = payload?.chantier;
  const environnement = payload?.environnement;

  if (toiture?.amiante === true) {
    blocking.push("Présence d'amiante");
  }

  const valeurTerre = electrique?.valeur_terre;
  if (
    typeof valeurTerre === "number" &&
    Number.isFinite(valeurTerre) &&
    valeurTerre > 100
  ) {
    blocking.push("Prise de terre non conforme");
  }

  if (electrique?.ddr_30ma === false) {
    blocking.push("Absence de protection DDR 30mA");
  }

  if (toiture?.combles_accessibles === false) {
    warning.push("Combles non accessibles");
  }

  if (chantier?.acces_toit === "difficile") {
    warning.push("Accès toiture difficile");
  }

  if (environnement?.ombrage === true) {
    warning.push("Présence d'ombrage");
  }

  const typeCouverture = toiture?.type_couverture;
  if (!isNonEmptyString(typeCouverture)) {
    warning.push("Type de couverture non renseigné");
  }

  const nbBlocking = blocking.length;
  const nbWarning = warning.length;
  const score = computeScore(nbBlocking, nbWarning);
  const status = computeStatus(nbBlocking, nbWarning);

  return {
    alerts: { blocking, warning },
    score,
    status,
    chantier_summary: buildChantierSummary(payload, nbWarning),
  };
}
