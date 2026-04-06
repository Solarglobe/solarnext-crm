import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  __resetCanonical3DFlagLogForTests,
  getCanonical3DFlagResolution,
  isCanonical3DEnabled,
  isCanonical3DProductMountAllowed,
  resolveCanonical3DPreviewEnabled,
} from "../featureFlags";

describe("canonical3d featureFlags", () => {
  beforeEach(() => {
    __resetCanonical3DFlagLogForTests();
    vi.unstubAllEnvs();
    delete (window as unknown as { __CALPINAGE_CANONICAL_3D__?: boolean }).__CALPINAGE_CANONICAL_3D__;
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    delete (window as unknown as { __CALPINAGE_CANONICAL_3D__?: boolean }).__CALPINAGE_CANONICAL_3D__;
  });

  it("défaut : OFF (source default)", () => {
    vi.stubEnv("VITE_CALPINAGE_CANONICAL_3D", "");
    const r = getCanonical3DFlagResolution();
    expect(r.productMountAllowed).toBe(false);
    expect(r.previewDevSurfacesAllowed).toBe(false);
    expect(r.mode).toBe("off");
    expect(isCanonical3DEnabled()).toBe(false);
  });

  it("env true → produit ON", () => {
    vi.stubEnv("VITE_CALPINAGE_CANONICAL_3D", "true");
    const r = getCanonical3DFlagResolution();
    expect(r.source).toBe("env");
    expect(r.mode).toBe("product");
    expect(isCanonical3DProductMountAllowed()).toBe(true);
    expect(resolveCanonical3DPreviewEnabled()).toBe(true);
  });

  it("env 1 → produit ON", () => {
    vi.stubEnv("VITE_CALPINAGE_CANONICAL_3D", "1");
    expect(isCanonical3DProductMountAllowed()).toBe(true);
  });

  it("env preview → surfaces preview en dev (vitest = DEV)", () => {
    vi.stubEnv("VITE_CALPINAGE_CANONICAL_3D", "preview");
    const r = getCanonical3DFlagResolution();
    expect(r.mode).toBe("preview_dev");
    expect(r.productMountAllowed).toBe(false);
    if (import.meta.env.DEV) {
      expect(resolveCanonical3DPreviewEnabled()).toBe(true);
      expect(isCanonical3DEnabled()).toBe(true);
    }
  });

  it("window true prioritaire sur env absent", () => {
    vi.stubEnv("VITE_CALPINAGE_CANONICAL_3D", "");
    (window as unknown as { __CALPINAGE_CANONICAL_3D__: boolean }).__CALPINAGE_CANONICAL_3D__ = true;
    expect(getCanonical3DFlagResolution().source).toBe("window");
    expect(isCanonical3DProductMountAllowed()).toBe(true);
  });

  it("window false prioritaire sur env true (rollback)", () => {
    vi.stubEnv("VITE_CALPINAGE_CANONICAL_3D", "true");
    (window as unknown as { __CALPINAGE_CANONICAL_3D__: boolean }).__CALPINAGE_CANONICAL_3D__ = false;
    const r = getCanonical3DFlagResolution();
    expect(r.source).toBe("window");
    expect(r.productMountAllowed).toBe(false);
    expect(r.mode).toBe("off");
  });
});
