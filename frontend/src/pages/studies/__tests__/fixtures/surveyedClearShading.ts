/** Mock API contract for freshness/history UI tests. Real assessment and receipt
 * validation are exercised by shading tests and the local HTTP qualification. */
export const surveyedClearShading = () => ({
  assessment: { status: "computed", nearStatus: "computed", farStatus: "computed" },
  near: { totalLossPct: 0 }, far: { totalLossPct: 0 }, combined: { totalLossPct: 0 },
});
