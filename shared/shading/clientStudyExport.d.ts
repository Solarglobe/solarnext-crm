export const CLIENT_STUDY_EXPORT_BLOCKED: string;
export const CLIENT_STUDY_EXPORT_MESSAGE: string;
export interface ClientStudyExportBlock { blocked: boolean; code: string; message: string; reasons: string[]; }
export function getClientStudyExportBlock(value: unknown): ClientStudyExportBlock;
export function assertClientStudyExportable(value: unknown): ClientStudyExportBlock;
export const SHADING_EXPORT_WARNING: string;
export const SHADING_EXCLUSION_METHODOLOGY: string;
export interface StudyShadingState { shadingIncluded: boolean; shadingApplied: boolean; shadingLossPct: number | null; shadingExclusionReason: string | null; }
export function getStudyShadingState(value: unknown): StudyShadingState;
export function studyArchiveWarning(date: string | Date | null | undefined): string;
