import { expect, it } from "vitest";
import { getKanbanColumnTitle, inferStageCode, sortStagesForKanban } from "../kanban-config";

it("preserves the historically deployed long-term stage without a new application enum", () => {
  const stage = { name: "Relances lointaines", code: "LONG_TERM_FOLLOW_UP", position: 10 };
  expect(inferStageCode(stage)).toBe("LONG_TERM_FOLLOW_UP");
  expect(getKanbanColumnTitle(stage)).toBe("Relances lointaines");
  expect(sortStagesForKanban([stage, { name: "Nouveau lead", code: "NEW", position: 1 }])).toEqual([
    { name: "Nouveau lead", code: "NEW", position: 1 }, stage,
  ]);
});
