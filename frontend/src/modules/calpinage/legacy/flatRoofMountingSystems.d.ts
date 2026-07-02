/**
 * Déclarations TS pour flatRoofMountingSystems.js (catalogue matériel de pose toit plat — LOT A).
 * Même pattern que calpinage.module.d.ts : le module reste en JS pur (partagé avec le legacy),
 * la présente déclaration donne les types au monde React/TS.
 */

export type MountingArrangement = "SOUTH_SINGLE" | "EAST_WEST_DUAL";

export interface FlatRoofMountingSystemPanelLimits {
  minLenMm: number | null;
  maxLenMm: number | null;
  minWidMm: number | null;
  maxWidMm: number | null;
  minThickMm: number | null;
  maxThickMm: number | null;
}

export interface FlatRoofMountingSystemSlopeRules {
  okMaxDeg: number;
  warnMaxDeg: number;
  warnMessage: string;
  blockMessage: string;
}

export interface FlatRoofMountingSystem {
  id: string;
  brand: "K2 Systems" | "ESDEC (Enstall)";
  label: string;
  arrangement: MountingArrangement;
  enabled: boolean;
  unavailableReason: string | null;
  tiltOptionsDeg: number[];
  defaultTiltDeg: number;
  orientationOptions: Array<"portrait" | "landscape">;
  defaultOrientation: "portrait" | "landscape";
  defaultRowSpacingCm: number;
  defaultSetbackRoofEdgeCm: number;
  defaultSetbackObstacleCm: number;
  panelLimits: FlatRoofMountingSystemPanelLimits | null;
  slopeRules: FlatRoofMountingSystemSlopeRules;
  ballastNote: string;
  calculatorUrl: string;
  calculatorLabel: string;
  quoteNotes: string[];
}

export interface SlopeStatus {
  level: "ok" | "warning" | "blocking" | "unknown";
  message: string;
}

export const MOUNTING_ARRANGEMENTS: Readonly<Record<MountingArrangement, MountingArrangement>>;
export const EAST_WEST_UNAVAILABLE_REASON: string;
export const FLAT_ROOF_MOUNTING_SYSTEMS: ReadonlyArray<FlatRoofMountingSystem>;

export function getMountingSystemById(id: unknown): FlatRoofMountingSystem | null;
export function resolveSlopeStatusForSystem(
  system: FlatRoofMountingSystem | null,
  slopeDeg: number | null | undefined,
): SlopeStatus;
export function checkPanelCompatibility(
  system: FlatRoofMountingSystem | null,
  panel: { lengthMm?: number | null; widthMm?: number | null } | null,
): { ok: boolean; message: string | null };
export function buildMountingSystemSnapshot(
  system: FlatRoofMountingSystem,
  tiltDeg: number,
): Record<string, unknown>;
