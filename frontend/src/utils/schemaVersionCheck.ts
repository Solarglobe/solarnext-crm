/**
 * schemaVersionCheck.ts
 *
 * Detecte un changement de version de contrat entre le frontend charge et le backend deploye.
 * Le backend renvoie X-Schema-Version sur chaque reponse API (via schemaVersion.middleware.js).
 *
 * Comportement :
 *   - Au 1er appel API, memorise la version du backend.
 *   - Sur chaque reponse suivante, compare la version recue avec celle memorisee.
 *   - Si la version change -> toast d'information + rechargement propre apres 3 secondes.
 *     (3 secondes pour que l'utilisateur voie le message et ne soit pas surpris)
 *
 * Usage dans le client API central (ex. apiClient.ts / axios interceptor) :
 *   import { checkSchemaVersion } from "@/utils/schemaVersionCheck";
 *   // Dans l'intercepteur de reponse :
 *   checkSchemaVersion(response.headers["x-schema-version"]);
 */

export const SCHEMA_VERSION_HEADER = "x-schema-version";

/** Version connue du backend au moment du chargement de l'app. */
let _knownBackendVersion: string | null = null;

/** Guard pour ne recharger qu'une seule fois. */
let _reloadScheduled = false;

/**
 * Appeler a chaque reponse API avec la valeur du header X-Schema-Version.
 * Si la version change, programme un rechargement propre.
 *
 * @param incomingVersion - Valeur du header, ou undefined si absent.
 */
export function checkSchemaVersion(incomingVersion: string | undefined | null): void {
  if (!incomingVersion) return;

  if (_knownBackendVersion === null) {
    // Premiere reponse : on enregistre la version de reference.
    _knownBackendVersion = incomingVersion;
    return;
  }

  if (incomingVersion !== _knownBackendVersion && !_reloadScheduled) {
    _reloadScheduled = true;
    scheduleReload(incomingVersion, _knownBackendVersion);
  }
}

/**
 * Reinitialise l'etat (utile en tests unitaires).
 */
export function resetSchemaVersionCheck(): void {
  _knownBackendVersion = null;
  _reloadScheduled = false;
}

/**
 * Retourne la version courante connue du backend (null si aucune reponse recue).
 */
export function getKnownBackendSchemaVersion(): string | null {
  return _knownBackendVersion;
}

// ---------------------------------------------------------------------------
// Implementation interne
// ---------------------------------------------------------------------------

function scheduleReload(newVersion: string, oldVersion: string): void {
  const DELAY_MS = 3_000;

  console.info(
    `[SchemaVersion] Contrat mis a jour : ${oldVersion} -> ${newVersion}. ` +
    `Rechargement dans ${DELAY_MS / 1000}s...`
  );

  // Notifier l'utilisateur si le toast global est disponible.
  // On utilise une globalThis optionnelle pour ne pas creer de dependance circulaire.
  try {
    const toastFn = (globalThis as Record<string, unknown>).calpinageToast as
      | ((msg: string, opts?: { type?: string; duration?: number }) => void)
      | undefined;
    if (typeof toastFn === "function") {
      toastFn(
        "Une nouvelle version de l'application est disponible. Rechargement en cours...",
        { type: "info", duration: DELAY_MS }
      );
    }
  } catch {
    // Ignore si le toast n'est pas disponible (ex. tests)
  }

  setTimeout(() => {
    // Rechargement propre : vide le cache de navigation (hard reload).
    window.location.reload();
  }, DELAY_MS);
}
