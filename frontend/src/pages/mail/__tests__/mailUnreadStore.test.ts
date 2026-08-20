import { describe, expect, it } from "vitest";
import { formatMailUnreadBadge } from "../mailUnreadBadgeFormat";

describe("mail unread global badge", () => {
  it("n'affiche rien à zéro", () => {
    expect(formatMailUnreadBadge(0)).toBe("");
  });

  it("affiche le nombre exact jusqu'à 99", () => {
    expect(formatMailUnreadBadge(1)).toBe("1");
    expect(formatMailUnreadBadge(42)).toBe("42");
    expect(formatMailUnreadBadge(99)).toBe("99");
  });

  it("affiche 99+ au-delà", () => {
    expect(formatMailUnreadBadge(100)).toBe("99+");
    expect(formatMailUnreadBadge(348)).toBe("99+");
  });
});
