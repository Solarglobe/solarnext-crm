/**
 * CP-FAR-IGN-01 — Configuration et URLs officielles IGN RGE ALTI (Open Data Etalab 2.0)
 * Pas d'URL en dur pour une tuile spécifique : base + découverte via API officielle.
 * @see https://geoservices.ign.fr/documentation/donnees/alti/rgealti
 * @see https://geoservices.ign.fr/telechargement-api/RGEALTI
 */

import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** Base officielle téléchargement IGN Open Data (Géoplateforme) */
export const IGN_RGEALTI_BASE_URL =
  process.env.IGN_RGEALTI_BASE_URL || "https://data.geopf.fr/telechargement/download/RGEALTI";

/** Page API de listage des ressources RGE ALTI (pour résoudre la ressource par département) */
export const IGN_RGEALTI_CATALOG_URL =
  process.env.IGN_RGEALTI_CATALOG_URL || "https://geoservices.ign.fr/telechargement-api/RGEALTI";

/** Répertoire local de stockage des tuiles (GeoTIFF) */
export function getIgnDsmDataDir() {
  const base = process.env.IGN_DSM_DATA_DIR;
  if (base) return base;
  return path.join(__dirname, "..", "..", "..", "data", "dsm", "ign");
}
