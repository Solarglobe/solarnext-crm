export type ShadingAssessmentStatus = "computed" | "not_calculated" | "insufficient_data" | "error" | "stale";
export type ShadingAssessment = { status: ShadingAssessmentStatus; nearStatus: ShadingAssessmentStatus; farStatus: ShadingAssessmentStatus; reasons: string[]; [key: string]: unknown };
export function validShadingLossPct(value: unknown): number | null;
export function getShadingStatusLabel(status: string): string;
export function getShadingAssessment(shading: unknown): ShadingAssessment;
export function getShadingComponentLossPct(shading: unknown, component?: "near" | "far" | "combined"): number | null;
export function formatShadingLossPct(value: unknown, status?: string): string;

export function getEnergyTemporalProfile(shading: unknown): null | {dayParts: {key: string; label: string; value: number}[]; seasons: {key: string; label: string; value: number}[]};
