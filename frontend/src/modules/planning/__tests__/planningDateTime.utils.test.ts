import { describe, expect, it } from "vitest";

import {
  dateTimeLocalToServerIso,
  formatDateTimeLocal,
  snapDateTimeLocal,
} from "../planningDateTime.utils";

describe("planningDateTime utils", () => {
  it("keeps datetime-local values in local time instead of slicing UTC", () => {
    const local = "2026-08-21T14:00";
    const serverIso = dateTimeLocalToServerIso(local);

    expect(formatDateTimeLocal(serverIso)).toBe(local);
  });

  it("snaps typed local times without shifting the displayed hour", () => {
    expect(snapDateTimeLocal("2026-08-21T14:07")).toBe("2026-08-21T14:00");
    expect(snapDateTimeLocal("2026-08-21T14:08")).toBe("2026-08-21T14:15");
  });
});
