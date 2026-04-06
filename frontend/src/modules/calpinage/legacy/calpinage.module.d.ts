/**
 * Déclarations TypeScript pour le module calpinage legacy (JS).
 * Le fichier .js n'a pas de types ; ce .d.ts fournit la signature pour l'IDE et le compilateur.
 */

export interface CalpinageInitOptions {
  studyId?: string | null;
  versionId?: string | null;
  /** Callback appelé à la validation du calpinage. Données flexibles (legacy). */
  onValidate?: (data: unknown) => void;
}

/**
 * Initialise le calpinage dans un conteneur DOM.
 * Peut retourner une fonction de nettoyage (cleanup) pour le démontage React.
 */
export function initCalpinage(
  container: HTMLElement,
  options?: CalpinageInitOptions
): void | (() => void);
