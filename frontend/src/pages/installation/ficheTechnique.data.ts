/**
 * Types fiches techniques — catégories canoniques = réponse GET /api/fiche-techniques/meta.
 */

export type FicheTechniqueCategory =
  | "panneaux"
  | "onduleurs"
  | "micro-onduleurs"
  | "batteries"
  | "tableaux-de-protection"
  | "fixations";

export type FicheTechniqueStatus = "active" | "obsolete" | "recommended";

export interface FicheTechniqueRow {
  id: string;
  name: string;
  reference: string;
  brand: string | null;
  category: FicheTechniqueCategory;
  status: FicheTechniqueStatus;
  createdAt: string;
  isFavorite: boolean;
  /** URL relative API (Bearer) pour téléchargement / aperçu. */
  downloadUrl: string;
}
