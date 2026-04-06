import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tryBuildSolarScene3DForProduct } from "../tryBuildSolarScene3DForProduct";
import { minimalCalpinageRuntimeFixture } from "../../dev/minimalCalpinageRuntimeFixture";

describe("tryBuildSolarScene3DForProduct", () => {
  beforeEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { __CALPINAGE_CANONICAL_3D__?: boolean }).__CALPINAGE_CANONICAL_3D__;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { __CALPINAGE_CANONICAL_3D__?: boolean }).__CALPINAGE_CANONICAL_3D__;
  });

  it("flag OFF → disabledByFlag, pas de scène", () => {
    vi.stubEnv("VITE_CALPINAGE_CANONICAL_3D", "");
    const r = tryBuildSolarScene3DForProduct(minimalCalpinageRuntimeFixture);
    expect(r.disabledByFlag).toBe(true);
    expect(r.ok).toBe(false);
    expect(r.scene).toBeNull();
    expect(r.diagnostics.errors.some((e) => e.code === "CANONICAL_3D_PRODUCT_DISABLED")).toBe(true);
  });

  it("flag ON → même résultat qu’un build direct OK", () => {
    vi.stubEnv("VITE_CALPINAGE_CANONICAL_3D", "true");
    const r = tryBuildSolarScene3DForProduct(minimalCalpinageRuntimeFixture);
    expect(r.disabledByFlag).toBe(false);
    expect(r.ok).toBe(true);
    expect(r.scene).not.toBeNull();
  });
});
