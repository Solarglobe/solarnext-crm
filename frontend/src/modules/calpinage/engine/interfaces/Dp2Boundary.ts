/**
 * Phase A — Frontière d'isolation DP2.
 *
 * CONTRAT UNIQUEMENT — aucune implémentation, aucune référence à window.*.
 *
 * Rôle : documenter et typer la frontière entre le moteur calpinage (ce qu'on extrait)
 * et le module DP2 (qu'on ne touche PAS pendant la migration).
 *
 * Contexte (Section 3.4 du plan) :
 *   Le module DP2 est embarqué dans calpinage.module.js via 3 globals :
 *     - window.CALPINAGE_DP2_BEHAVIOR  (objet comportement)
 *     - window.CALPINAGE_DP2_STATE     (état courant)
 *     - window.CALPINAGE_DP2_INIT_DONE (flag d'initialisation)
 *
 *   L'extraction du moteur calpinage (Phases 2 et 3) ne doit PAS modifier les
 *   fonctions du module qui alimentent DP2. Cette frontière documente quels
 *   globals DP2 existent et ce que le moteur calpinage ne doit PAS supprimer
 *   ou modifier pendant la migration.
 *
 * Règle absolue (Section 2.4 du plan) :
 *   "Commencer Phase 2 (extraction placement) avant Phase A (interfaces) →
 *    code copié-collé qui plante silencieusement (DP2 peut casser silencieusement)."
 *
 * Ce fichier est LU par les développeurs Phase 2 et Phase 3 avant toute extraction.
 */

// ─────────────────────────────────────────────────────────────────────────────
// GLOBALS DP2 — NE PAS SUPPRIMER, NE PAS MODIFIER LEURS SIGNATURES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Liste des globals window exposés par DP2 dans calpinage.module.js.
 * Ces globals sont consommés par le module DP2 externe (pièces réglementaires).
 *
 * Statut de chaque global durant la migration :
 *   FROZEN  = ne pas toucher, ne pas déplacer, ne pas supprimer jusqu'à Phase 6
 *   MONITOR = surveiller si une extraction les référence (signaler, ne pas retirer)
 */
export const DP2_BOUNDARY_GLOBALS = [
  { name: "CALPINAGE_DP2_BEHAVIOR",  status: "FROZEN"  as const, phase: "Phase 2+" },
  { name: "CALPINAGE_DP2_STATE",     status: "FROZEN"  as const, phase: "Phase 2+" },
  { name: "CALPINAGE_DP2_INIT_DONE", status: "FROZEN"  as const, phase: "Phase 2+" },
] as const;

export type Dp2GlobalName = typeof DP2_BOUNDARY_GLOBALS[number]["name"];

// ─────────────────────────────────────────────────────────────────────────────
// FONCTIONS CALPINAGE QUE DP2 CONSOMME — NE PAS MODIFIER LEURS SIGNATURES
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Fonctions du module calpinage appelées par DP2 (ou dont DP2 dépend implicitement).
 * À compléter lors de l'audit de Phase 2 avant toute extraction.
 *
 * Instructions pour Phase 2 :
 *   1. Avant d'extraire une fonction du module, chercher son nom dans ce tableau.
 *   2. Si elle est listée ici → créer un SHIM dans le legacy qui délègue
 *      à l'implémentation extraite (ne jamais retirer la fonction window).
 *   3. Si elle n'est pas listée → l'extraire librement.
 *
 * Note : ce tableau est incomplet en Phase A — il sera complété lors de l'audit
 * DP2 prévu au début de Phase 2 (grep exhaustif des références DP2 dans le module).
 */
export const DP2_CONSUMED_CALPINAGE_FUNCTIONS: ReadonlyArray<{
  readonly functionName: string;
  readonly globalPath: string;
  readonly auditStatus: "confirmed" | "suspected" | "to_verify";
  readonly notes: string;
}> = [
  {
    functionName: "buildGeometryForExport",
    globalPath: "window.buildGeometryForExport (indirect via DP2 snapshot)",
    auditStatus: "suspected",
    notes: "DP2 peut lire le snapshot de géométrie exporté — à confirmer lors de l'audit Phase 2.",
  },
  {
    functionName: "getValidatedRoofData",
    globalPath: "window.CALPINAGE_STATE.validatedRoofData",
    auditStatus: "suspected",
    notes: "DP2 génère le plan de masse depuis la toiture validée — vérifier l'accès direct à CALPINAGE_STATE.",
  },
] as const;

// ─────────────────────────────────────────────────────────────────────────────
// CHECKLIST — à valider AVANT le début de Phase 2
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Checklist d'audit DP2 à compléter avant de commencer Phase 2.
 *
 * Pour chaque item : grep le module (22 637 lignes) sur le terme indiqué,
 * identifier les fonctions calpinage impliquées, les ajouter à DP2_CONSUMED_CALPINAGE_FUNCTIONS.
 */
export const DP2_AUDIT_CHECKLIST = [
  "grep 'CALPINAGE_DP2' calpinage.module.js → lister toutes les lignes",
  "grep 'DP2' calpinage.module.js → identifier fonctions appelées par DP2",
  "grep 'validatedRoofData' côté DP2 → confirmer/infirmer dépendance",
  "grep 'buildGeometryForExport' côté DP2 → confirmer/infirmer",
  "grep 'CALPINAGE_STATE' côté module DP2 (hors calpinage.module.js) → accès directs",
] as const;
