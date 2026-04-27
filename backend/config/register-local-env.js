/**
 * Effet de bord : charge les `.env` locaux avant tout autre import `backend/config/*`
 * (ex. `database-url.js`). Importer cette ligne en premier dans les scripts.
 */
import { loadBackendLocalEnvFiles } from "./load-local-env.js";

loadBackendLocalEnvFiles();
