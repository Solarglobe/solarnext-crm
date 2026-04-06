/**
 * CP-004 — Scoping localStorage calpinage par studyId + versionId
 * Format strict : calpinage:{studyId}:{versionId}:{baseKey}
 * Aucune clé assemblée à la main ailleurs dans le code.
 */

const PREFIX = "calpinage";
const LEGACY_KEYS: Record<string, string> = {
  state: "calpinage-state",
  "pv-params": "calpinage-pv-params",
  "horizon-mask": "calpinage-horizon-mask",
};

const LEGACY_TO_BASE: Record<string, CalpinageBaseKey> = {
  "calpinage-state": "state",
  "calpinage-pv-params": "pv-params",
  "calpinage-horizon-mask": "horizon-mask",
};

export type CalpinageBaseKey = "state" | "pv-params" | "horizon-mask";

/**
 * Retourne la clé scopée à partir d'une clé legacy (calpinage-state, calpinage-pv-params, etc.).
 * Utilisé par le module legacy pour compatibilité.
 */
export function getCalpinageScopedKeyFromLegacy(
  legacyKey: string,
  studyId: string | null | undefined,
  versionId: string | null | undefined
): string | null {
  const baseKey = LEGACY_TO_BASE[legacyKey];
  if (!baseKey) return null;
  return getCalpinageScopedKey(baseKey, studyId, versionId);
}

/**
 * Retourne la clé localStorage scopée.
 * Format : calpinage:{studyId}:{versionId}:{baseKey}
 * @returns null si studyId ou versionId manquant
 */
export function getCalpinageScopedKey(
  baseKey: CalpinageBaseKey,
  studyId: string | null | undefined,
  versionId: string | null | undefined
): string | null {
  const sid = studyId ?? null;
  const vid = versionId ?? null;
  if (!sid || !vid) return null;
  return `${PREFIX}:${sid}:${vid}:${baseKey}`;
}

/**
 * Lit depuis localStorage avec migration legacy.
 * 1. Lit la clé scopée
 * 2. Si vide, lit la clé legacy, migre, supprime legacy
 */
export function getCalpinageItem(
  baseKey: CalpinageBaseKey,
  studyId: string | null | undefined,
  versionId: string | null | undefined
): string | null {
  const scopedKey = getCalpinageScopedKey(baseKey, studyId, versionId);
  if (scopedKey) {
    const raw = localStorage.getItem(scopedKey);
    if (raw) return raw;
  }
  const legacyKey = LEGACY_KEYS[baseKey];
  if (!legacyKey) return null;
  const legacyRaw = localStorage.getItem(legacyKey);
  if (!legacyRaw) return null;
  if (scopedKey) {
    try {
      localStorage.setItem(scopedKey, legacyRaw);
      localStorage.removeItem(legacyKey);
    } catch {
      /* ignore migration error */
    }
  }
  return legacyRaw;
}

/**
 * Écrit dans localStorage (clé scopée uniquement).
 */
export function setCalpinageItem(
  baseKey: CalpinageBaseKey,
  studyId: string | null | undefined,
  versionId: string | null | undefined,
  value: string
): void {
  const key = getCalpinageScopedKey(baseKey, studyId, versionId);
  if (key) localStorage.setItem(key, value);
}

/**
 * Supprime la clé scopée (cleanup).
 */
export function removeCalpinageItem(
  baseKey: CalpinageBaseKey,
  studyId: string | null | undefined,
  versionId: string | null | undefined
): void {
  const key = getCalpinageScopedKey(baseKey, studyId, versionId);
  if (key) localStorage.removeItem(key);
}
