import { describe, expect, it } from "vitest";
import { finiteRoofHeightMOrUndefined, parseExplicitRoofVertexHeightM } from "../vertexHeightSemantics";

describe("vertexHeightSemantics (Prompt 3)", () => {
  it("Cas absent — pas de conversion implicite en 0", () => {
    expect(parseExplicitRoofVertexHeightM(undefined).kind).toBe("absent");
    expect(parseExplicitRoofVertexHeightM(null).kind).toBe("absent");
    expect(finiteRoofHeightMOrUndefined(undefined)).toBeUndefined();
  });

  it("Cas h = 0 — cote réelle valide", () => {
    expect(parseExplicitRoofVertexHeightM(0).kind).toBe("explicit_zero");
    expect(finiteRoofHeightMOrUndefined(0)).toBe(0);
  });

  it("Cas NaN / Infinity — invalide", () => {
    expect(parseExplicitRoofVertexHeightM(NaN).kind).toBe("invalid");
    expect(parseExplicitRoofVertexHeightM(Infinity).kind).toBe("invalid");
    expect(finiteRoofHeightMOrUndefined(NaN)).toBeUndefined();
  });
});
