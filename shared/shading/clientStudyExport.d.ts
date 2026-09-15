export const CLIENT_STUDY_EXPORT_BLOCKED: string;
export const CLIENT_STUDY_EXPORT_MESSAGE: string;
export interface ClientStudyExportBlock { blocked: boolean; code: string; message: string; reasons: string[]; }
export function getClientStudyExportBlock(value: unknown): ClientStudyExportBlock;
export function assertClientStudyExportable(value: unknown): ClientStudyExportBlock;
