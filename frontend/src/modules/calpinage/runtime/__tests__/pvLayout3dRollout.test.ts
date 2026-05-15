import { describe, expect, it } from "vitest";
import {
  PVLAYOUT3D_LS_KEY,
  PVPROBE_VITE_KEY,
  PVLAYOUT3D_VITE_KEY,
  getPvLayout3dProductRolloutResolution,
  resolveBooleanRollout,
} from "../pvLayout3dRollout";

describe("pvLayout3dRollout - resolveBooleanRollout", () => {
  it("localStorage 0 / 1 prime sur tout", () => {
    expect(
      resolveBooleanRollout({
        localStorageValue: "0",
        viteEnvValue: true,
        defaultOn: true,
      }),
    ).toEqual({ value: false, source: "localStorage" });
    expect(
      resolveBooleanRollout({
        localStorageValue: "1",
        viteEnvValue: false,
        defaultOn: false,
      }),
    ).toEqual({ value: true, source: "localStorage" });
  });

  it("VITE ensuite", () => {
    expect(
      resolveBooleanRollout({
        localStorageValue: null,
        viteEnvValue: "false",
        defaultOn: true,
      }),
    ).toEqual({ value: false, source: "vite" });
    expect(
      resolveBooleanRollout({
        localStorageValue: undefined,
        viteEnvValue: true,
        defaultOn: false,
      }),
    ).toEqual({ value: true, source: "vite" });
  });

  it("defaut si rien ne matche", () => {
    expect(
      resolveBooleanRollout({
        localStorageValue: null,
        viteEnvValue: undefined,
        defaultOn: true,
      }),
    ).toEqual({ value: true, source: "default" });
    expect(
      resolveBooleanRollout({
        localStorageValue: null,
        viteEnvValue: undefined,
        defaultOn: false,
      }),
    ).toEqual({ value: false, source: "default" });
  });
});

describe("pvLayout3dRollout - cles exportees", () => {
  it("noms stables pour doc / rollout", () => {
    expect(PVLAYOUT3D_VITE_KEY).toBe("VITE_CALPINAGE_3D_PV_LAYOUT_MODE");
    expect(PVPROBE_VITE_KEY).toBe("VITE_CALPINAGE_3D_PV_PLACE_PROBE");
  });
});

describe("pvLayout3dRollout - defaut produit", () => {
  it("active le mode PV 3D produit par defaut", () => {
    localStorage.removeItem(PVLAYOUT3D_LS_KEY);
    expect(getPvLayout3dProductRolloutResolution()).toEqual({
      value: true,
      source: "default",
    });
  });
});
