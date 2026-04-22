import type { PvgisHourlySeriesDocumentV1, PvgisProxyEnvelope } from "../roofModelShadingV1Types";

export type { PvgisProxyEnvelope };

function num(x: unknown): number {
  const n = typeof x === "number" ? x : Number(x);
  return Number.isFinite(n) ? n : 0;
}

/**
 * Extrait les séries horaires Wh/m² depuis l’enveloppe proxy + JSON PVGIS brut.
 */
export function parsePvgisHourlyFromProxyResponse(
  envelope: PvgisProxyEnvelope,
  ctx: Readonly<{
    lat: number;
    lon: number;
    tiltDeg: number;
    aspectPvgisDeg: number;
    raddatabase: string;
    usehorizon: 0 | 1;
    year: number;
  }>,
): PvgisHourlySeriesDocumentV1 | null {
  const root = envelope.pvgis;
  if (root == null || typeof root !== "object") return null;
  const outputs = (root as Record<string, unknown>).outputs as Record<string, unknown> | undefined;
  const hourly = outputs?.hourly;
  if (!Array.isArray(hourly) || hourly.length < 8760) return null;

  const globalHorizontalHourlyWhM2: number[] = [];
  const planeOfArrayHourlyWhM2: number[] = [];

  for (const row of hourly) {
    if (row == null || typeof row !== "object") {
      globalHorizontalHourlyWhM2.push(0);
      planeOfArrayHourlyWhM2.push(0);
      continue;
    }
    const h = row as Record<string, unknown>;
    const gh =
      num(h["G(h)"]) ||
      num(h.G_h) ||
      num(h["Gb(n)"]) + num(h["Gd(h)"]) ||
      num(h.H_h) ||
      0;
    const gi = num(h["G(i)"]) || num(h.G_i) || num(h["G"]) || gh;
    globalHorizontalHourlyWhM2.push(Math.max(0, gh));
    planeOfArrayHourlyWhM2.push(Math.max(0, gi));
  }

  const hourCount = planeOfArrayHourlyWhM2.length;
  const fetchedAtIso = envelope.proxyMeta?.fetchedAt ?? new Date().toISOString();

  return {
    schemaId: "pvgisHourly.v1",
    year: ctx.year,
    hourCount,
    globalHorizontalHourlyWhM2,
    planeOfArrayHourlyWhM2,
    lat: ctx.lat,
    lon: ctx.lon,
    tiltDeg: ctx.tiltDeg,
    aspectPvgisDeg: ctx.aspectPvgisDeg,
    raddatabase: ctx.raddatabase,
    usehorizon: ctx.usehorizon,
    fetchedAtIso,
  };
}
