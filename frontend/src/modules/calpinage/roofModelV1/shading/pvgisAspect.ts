/** Météo azimuth (0=N) → aspect PVGIS (0=S). */
export function meteoAzimuthDegToPvgisAspectDeg(meteoAzimuthDeg: number): number {
  if (!Number.isFinite(meteoAzimuthDeg)) return 0;
  return (180 + meteoAzimuthDeg) % 360;
}
