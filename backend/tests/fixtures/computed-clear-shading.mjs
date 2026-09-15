// Explicit surveyed-clear assumption for nominal finance/PDF unit fixtures only.
// Physical correctness is tested separately by shadingAssessmentReference and local PostgreSQL E2E.
export const computedClearShading = () => ({ assessment: { status: 'computed', nearStatus: 'computed', farStatus: 'computed' }, near: { totalLossPct: 0 }, far: { totalLossPct: 0 }, combined: { totalLossPct: 0 } });
