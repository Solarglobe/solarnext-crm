/**
 * CP-FAR-IGN-01 — Conversion EPSG:4326 (WGS84) <-> EPSG:2154 (Lambert-93) via proj4.
 * Définitions standard, aucune formule approchée.
 */

import proj4 from "proj4";

proj4.defs(
  "EPSG:2154",
  "+proj=lcc +lat_0=46.5 +lon_0=3 +lat_1=49 +lat_2=44 +x_0=700000 +y_0=6600000 +ellps=GRS80 +units=m +no_defs"
);
proj4.defs("EPSG:4326", "+proj=longlat +datum=WGS84 +no_defs");

/**
 * @param {{ lat: number, lon: number }} wgs84 - degrés
 * @returns {{ x: number, y: number }} - mètres Lambert-93
 */
export function wgs84ToLambert93({ lat, lon }) {
  const [x, y] = proj4("EPSG:4326", "EPSG:2154", [lon, lat]);
  return { x, y };
}

/**
 * @param {{ x: number, y: number }} lambert93 - mètres
 * @returns {{ lat: number, lon: number }} - degrés WGS84
 */
export function lambert93ToWgs84({ x, y }) {
  const [lon, lat] = proj4("EPSG:2154", "EPSG:4326", [x, y]);
  return { lat, lon };
}
