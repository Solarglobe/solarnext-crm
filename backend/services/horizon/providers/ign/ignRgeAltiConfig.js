/**
 * CP-FAR-IGN-01 — Configuration IGN RGE ALTI (cache local, API data.geopf.fr).
 * Répertoire de stockage + identifiants de ressource pour D075 (obtenus via catalogue).
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Répertoire racine cache IGN : backend/data/dsm/ign/ */
export function getIgnDsmDataDir() {
  const base = process.env.IGN_DSM_DATA_DIR;
  if (base) return path.resolve(base);
  return path.join(__dirname, "..", "..", "..", "..", "data", "dsm", "ign");
}

/** Nom de la ressource (produit) sur la Géoplateforme */
export const IGN_RGEALTI_RESOURCE =
  process.env.IGN_RGEALTI_RESOURCE || "RGE ALTI® 1M - D075 Paris - Juillet 2020";

/** Identifiant technique de la ressource (ex. geoservices / catalogue) */
export const IGN_RGEALTI_RESOURCE_ID =
  process.env.IGN_RGEALTI_RESOURCE_ID || "157349";

/** Sous-ressource (nom du jeu) pour le téléchargement — obtenu via API GetSubResource */
export const IGN_RGEALTI_SUBRESOURCE_NAME =
  process.env.IGN_RGEALTI_SUBRESOURCE_NAME || "RGEALTI_2-0_1M_ASC_LAMB93-IGN69_D075_2020-07-30";

/** Base URL API téléchargement Géoplateforme */
export const GEOPF_DOWNLOAD_BASE = "https://data.geopf.fr/telechargement";
