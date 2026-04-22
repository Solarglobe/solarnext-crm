export type PvgisProxyEnvelope = Readonly<{
  proxyMeta?: { proxiedUrl?: string; fetchedAt?: string };
  pvgis?: unknown;
}>;

export type PvgisHourlySeriesDocumentV1 = Readonly<{
  schemaId: "pvgisHourly.v1";
  year: number;
  hourCount: number;
  globalHorizontalHourlyWhM2: number[];
  planeOfArrayHourlyWhM2: number[];
  lat: number;
  lon: number;
  tiltDeg: number;
  aspectPvgisDeg: number;
  raddatabase: string;
  usehorizon: 0 | 1;
  fetchedAtIso: string;
}>;

export type RoofShadingPhase6V1 = Readonly<{
  schemaId: "roofShadingBundle.v1";
  updatedAtIso: string;
  horizonMask?: unknown;
  pvgisHourly?: PvgisHourlySeriesDocumentV1;
  shadowPresentation: Readonly<Record<string, unknown>>;
}>;

export type Any = any;
