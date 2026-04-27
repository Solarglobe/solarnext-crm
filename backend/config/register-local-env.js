/**
 * À importer en premier dans les scripts (après shebang si présent).
 * Si `DATABASE_URL` est déjà défini (Railway, `railway run`, CI) : **aucun** chargement
 * de fichiers `.env` et **aucune** importation du module `dotenv` → pas de logs
 * « injecting env from .env.dev ».
 */
if (process.env.DATABASE_URL) {
  // Intentionnellement vide — ne jamais invoquer dotenv lorsque l’URL est injectée.
} else {
  const { loadBackendLocalEnvFiles } = await import("./load-local-env.js");
  loadBackendLocalEnvFiles();
}
