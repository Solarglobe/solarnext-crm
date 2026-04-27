/**
 * Fiches techniques — catégories canoniques (source unique backend + validation POST).
 * NB: `tableaux-de-protection` aligné sur les données existantes en prod (slug avec tirets).
 */

export const FICHE_TECHNIQUE_CATEGORY_IDS = Object.freeze([
  "panneaux",
  "onduleurs",
  "micro-onduleurs",
  "batteries",
  "tableaux-de-protection",
  "fixations",
]);

/** @type {ReadonlySet<string>} */
export const FICHE_TECHNIQUE_CATEGORY_ID_SET = new Set(FICHE_TECHNIQUE_CATEGORY_IDS);

export const FICHE_TECHNIQUE_CATEGORY_META = Object.freeze([
  { id: "panneaux", label: "Panneaux" },
  { id: "onduleurs", label: "Onduleurs" },
  { id: "micro-onduleurs", label: "Micro-onduleurs" },
  { id: "batteries", label: "Batteries" },
  { id: "tableaux-de-protection", label: "Tableaux de protection" },
  { id: "fixations", label: "Fixations" },
]);
