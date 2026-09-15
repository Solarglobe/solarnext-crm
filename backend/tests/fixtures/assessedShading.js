/** Explicitly assessed fixture for consumer tests; physical validation lives in shadingAssessmentReference. */
export function assessedShading(value, near = value, far = 0) {
  return {
    assessment: { status: 'computed', nearStatus: 'computed', farStatus: 'computed', reasons: [] },
    near: { totalLossPct: near }, far: { totalLossPct: far }, combined: { totalLossPct: value },
  };
}
