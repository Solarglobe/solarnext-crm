import { api, createLeadStudyVersion, expect, test } from "./support/e2eTest";

test.describe("study geometry critical guards", () => {
  test("rejects an incomplete calepinage snapshot with a precise business error", async ({ seed }) => {
    const ids = await createLeadStudyVersion(seed);

    const res = await api(seed, "POST", `/api/studies/${ids.studyId}/versions/${ids.versionId}/calpinage`, {
      geometry_json: {
        panels: [{ id: "outside-roof", x: 999999, y: 999999 }],
      },
    });

    expect(res.status, JSON.stringify(res.data)).toBe(400);
    expect(res.data.error).toMatch(/calpinage incompletes|calpinage incompl/i);
  });

  test.fixme("placing a panel outside the roof is rejected with the dedicated geometry error", async () => {
    // The current backend validates snapshot completeness, but no dedicated panel-vs-roof endpoint is exposed yet.
  });
});
