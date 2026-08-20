import { describe, expect, it } from "vitest";
import { mailShortcutActionForKey } from "../useMailKeyboardShortcuts";

describe("mail keyboard shortcuts", () => {
  it("mappe les raccourcis demandes avec touches compatibles clavier francais", () => {
    expect(mailShortcutActionForKey("j")).toBe("next");
    expect(mailShortcutActionForKey("ArrowDown")).toBe("next");
    expect(mailShortcutActionForKey("k")).toBe("prev");
    expect(mailShortcutActionForKey("ArrowUp")).toBe("prev");
    expect(mailShortcutActionForKey("Enter")).toBe("open");
    expect(mailShortcutActionForKey("r")).toBe("reply");
    expect(mailShortcutActionForKey("f")).toBe("forward");
    expect(mailShortcutActionForKey("e")).toBe("archive");
    expect(mailShortcutActionForKey("Delete")).toBe("trash");
    expect(mailShortcutActionForKey("Backspace")).toBe("trash");
    expect(mailShortcutActionForKey("u")).toBe("toggleUnread");
    expect(mailShortcutActionForKey("Escape")).toBe("escape");
  });

  it("ignore les touches non prevues", () => {
    expect(mailShortcutActionForKey("a")).toBeNull();
    expect(mailShortcutActionForKey("Control")).toBeNull();
  });
});
