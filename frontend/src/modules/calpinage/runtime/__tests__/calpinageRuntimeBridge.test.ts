import { afterEach, describe, expect, it, vi } from "vitest";
import {
  getCalpinageLegacyBridgeStatus,
  getCalpinageLegacyCapability,
  registerCalpinageRuntime,
  subscribeCalpinageLegacyEvent,
  unregisterCalpinageRuntime,
} from "../calpinageRuntime";

describe("calpinageRuntime legacy bridge", () => {
  afterEach(() => {
    unregisterCalpinageRuntime();
    delete (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE;
    delete (window as unknown as { pvPlacementEngine?: unknown }).pvPlacementEngine;
    vi.restoreAllMocks();
  });

  it("expose un contrat versionné et des diagnostics pour capacité obligatoire absente", () => {
    registerCalpinageRuntime();
    (window as unknown as { CALPINAGE_STATE?: unknown }).CALPINAGE_STATE = { pans: [] };

    const status = getCalpinageLegacyBridgeStatus(["state", "placementEngine"]);

    expect(status.contractVersion).toBe("calpinage-legacy-bridge-v1");
    expect(status.active).toBe(true);
    expect(status.capabilities.state).toBe(true);
    expect(status.capabilities.placementEngine).toBe(false);
    expect(status.available).toBe(false);
    expect(status.missingRequired).toEqual(["placementEngine"]);
    expect(status.diagnostics[0]?.code).toBe("CALPINAGE_LEGACY_CAPABILITY_MISSING");
  });

  it("lit les capacités via la façade unique au lieu d'un accès window dispersé", () => {
    const engine = { getAllPanels: () => [{ id: "pv-1" }] };
    registerCalpinageRuntime();
    (window as unknown as { pvPlacementEngine?: unknown }).pvPlacementEngine = engine;

    expect(getCalpinageLegacyCapability("placementEngine")).toBe(engine);
    expect(getCalpinageLegacyBridgeStatus(["placementEngine"]).available).toBe(true);
  });

  it("nettoie les abonnements global event et supporte un remount Strict Mode", () => {
    const add = vi.spyOn(window, "addEventListener");
    const remove = vi.spyOn(window, "removeEventListener");
    const handler = vi.fn();

    const disposeA = subscribeCalpinageLegacyEvent("phase3:update", handler);
    disposeA();
    disposeA();
    const disposeB = subscribeCalpinageLegacyEvent("phase3:update", handler);
    window.dispatchEvent(new Event("phase3:update"));
    disposeB();
    window.dispatchEvent(new Event("phase3:update"));

    expect(handler).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledTimes(2);
    expect(remove).toHaveBeenCalledTimes(2);
  });
});
