/**
 * Persistance UI + clés cache liste + messages erreur API fiches techniques.
 */

import type { FicheTechniqueStatus } from "./ficheTechnique.data";

export const FICHE_TECHNIQUE_UI_STORAGE_KEY = "ficheTechniques.uiState";

export type FicheTechniquePersistedUi = {
  activeCategory: string;
  search: string;
  brandFilter: string;
  statusFilter: "all" | FicheTechniqueStatus;
  sortPreset: string;
  /** Index de page (0 = première page), pas offset brut */
  page: number;
};

const DEFAULT_UI: FicheTechniquePersistedUi = {
  activeCategory: "panneaux",
  search: "",
  brandFilter: "",
  statusFilter: "all",
  sortPreset: "created_desc",
  page: 0,
};

export function readFicheTechniqueUiState(): FicheTechniquePersistedUi {
  if (typeof window === "undefined") return { ...DEFAULT_UI };
  try {
    const raw = localStorage.getItem(FICHE_TECHNIQUE_UI_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_UI };
    const j = JSON.parse(raw) as Partial<FicheTechniquePersistedUi>;
    return {
      activeCategory: typeof j.activeCategory === "string" ? j.activeCategory : DEFAULT_UI.activeCategory,
      search: typeof j.search === "string" ? j.search : "",
      brandFilter: typeof j.brandFilter === "string" ? j.brandFilter : "",
      statusFilter:
        j.statusFilter === "active" || j.statusFilter === "obsolete" || j.statusFilter === "recommended"
          ? j.statusFilter
          : "all",
      sortPreset: typeof j.sortPreset === "string" ? j.sortPreset : DEFAULT_UI.sortPreset,
      page: typeof j.page === "number" && j.page >= 0 && Number.isFinite(j.page) ? Math.floor(j.page) : 0,
    };
  } catch {
    return { ...DEFAULT_UI };
  }
}

export function writeFicheTechniqueUiState(s: FicheTechniquePersistedUi): void {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(FICHE_TECHNIQUE_UI_STORAGE_KEY, JSON.stringify(s));
  } catch {
    /* quota / private mode */
  }
}

export type FicheListCacheParams = {
  category: string;
  search: string;
  brand: string;
  status: string;
  sort_by: string;
  sort_order: string;
  page: number;
  limit: number;
};

export function buildFicheListCacheKey(p: FicheListCacheParams): string {
  return [
    "v1",
    p.category,
    String(p.page),
    p.search,
    p.brand,
    p.status,
    p.sort_by,
    p.sort_order,
    String(p.limit),
  ].join("|");
}

/** Corps JSON erreur API CRM (liste / upload / etc.) */
export type FicheApiErrorJson = {
  error?: string;
  code?: string;
  message?: string;
  success?: boolean;
};

export function mapFicheTechniqueUserMessage(p?: {
  code?: string | null;
  httpStatus?: number;
  isNetwork?: boolean;
}): string {
  const x = p ?? {};
  if (x.isNetwork) return "Problème de connexion";
  const c = (x.code || "").toUpperCase();
  if (c === "FILE_TOO_LARGE") return "Fichier trop volumineux";
  if (c === "INVALID_FILE_TYPE") return "Format PDF requis";
  if (c === "LIMIT_FILE_SIZE") return "Fichier trop volumineux";
  if (httpImpliesNetwork(x.httpStatus)) return "Problème de connexion";
  return "Une erreur est survenue";
}

function httpImpliesNetwork(status?: number): boolean {
  if (status == null) return false;
  return status === 502 || status === 503 || status === 504;
}

export async function parseFicheApiErrorJson(res: Response): Promise<{ code: string | null; message: string }> {
  try {
    const j = (await res.json()) as FicheApiErrorJson;
    const code = (j.error || j.code || null) as string | null;
    const message = typeof j.message === "string" ? j.message : "";
    return { code, message };
  } catch {
    return { code: null, message: "" };
  }
}
