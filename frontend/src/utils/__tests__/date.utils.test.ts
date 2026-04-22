import { describe, it, expect } from "vitest";
import { formatDateFR } from "../date.utils";

describe("formatDateFR", () => {
  it("formate une ISO YYYY-MM-DD en JJ/MM/AAAA", () => {
    expect(formatDateFR("1990-05-15")).toBe("15/05/1990");
  });

  it("retourne null pour vide / invalide", () => {
    expect(formatDateFR(null)).toBeNull();
    expect(formatDateFR("")).toBeNull();
    expect(formatDateFR("pas-une-date")).toBeNull();
  });

  it("accepte un objet Date (jour local)", () => {
    expect(formatDateFR(new Date(1990, 4, 15))).toBe("15/05/1990");
  });
});
