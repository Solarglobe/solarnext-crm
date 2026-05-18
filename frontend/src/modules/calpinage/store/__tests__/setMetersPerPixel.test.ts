/**
 * Tests : store.setMetersPerPixel + simulation resize
 *
 * Couverture :
 *   1. setMetersPerPixel met à jour le store correctement
 *   2. Valeurs invalides sont ignorées (guard ≤ 0 / non-fini)
 *   3. invalidateMppDependentCache appelle les listeners enregistrés
 *   4. Simulation resize : ResizeObserver déclenche setMetersPerPixel avec debounce 300ms
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useCalpinageStore } from "../calpinageStore";
import { invalidateMppDependentCache, onMppInvalidate } from "../../adapter/calpinageStateToLegacyRoofInput";

// ─── Reset store entre chaque test ──────────────────────────────────────────

beforeEach(() => {
  useCalpinageStore.setState({ metersPerPixel: null });
});

// ─── 1. setMetersPerPixel — cas nominal ─────────────────────────────────────

describe("setMetersPerPixel", () => {
  it("met à jour metersPerPixel dans le store", () => {
    useCalpinageStore.getState().setMetersPerPixel(0.123);
    expect(useCalpinageStore.getState().metersPerPixel).toBeCloseTo(0.123, 10);
  });

  it("met à jour plusieurs fois : garde la dernière valeur", () => {
    useCalpinageStore.getState().setMetersPerPixel(0.5);
    useCalpinageStore.getState().setMetersPerPixel(0.2);
    expect(useCalpinageStore.getState().metersPerPixel).toBeCloseTo(0.2, 10);
  });

  // ─── Guards ────────────────────────────────────────────────────────────────

  it("ignore les valeurs ≤ 0", () => {
    useCalpinageStore.setState({ metersPerPixel: 0.5 });
    useCalpinageStore.getState().setMetersPerPixel(0);
    expect(useCalpinageStore.getState().metersPerPixel).toBeCloseTo(0.5, 10);

    useCalpinageStore.getState().setMetersPerPixel(-1);
    expect(useCalpinageStore.getState().metersPerPixel).toBeCloseTo(0.5, 10);
  });

  it("ignore NaN", () => {
    useCalpinageStore.setState({ metersPerPixel: 0.5 });
    useCalpinageStore.getState().setMetersPerPixel(NaN);
    expect(useCalpinageStore.getState().metersPerPixel).toBeCloseTo(0.5, 10);
  });

  it("ignore Infinity", () => {
    useCalpinageStore.setState({ metersPerPixel: 0.5 });
    useCalpinageStore.getState().setMetersPerPixel(Infinity);
    expect(useCalpinageStore.getState().metersPerPixel).toBeCloseTo(0.5, 10);
  });
});

// ─── 2. invalidateMppDependentCache ─────────────────────────────────────────

describe("invalidateMppDependentCache", () => {
  it("appelle les listeners enregistrés via onMppInvalidate", () => {
    const listener = vi.fn();
    const unsub = onMppInvalidate(listener);
    invalidateMppDependentCache();
    expect(listener).toHaveBeenCalledOnce();
    unsub();
  });

  it("setMetersPerPixel déclenche invalidateMppDependentCache", () => {
    const listener = vi.fn();
    const unsub = onMppInvalidate(listener);
    useCalpinageStore.getState().setMetersPerPixel(0.1);
    expect(listener).toHaveBeenCalledOnce();
    unsub();
  });

  it("setMetersPerPixel invalide avec valeur valide seulement", () => {
    const listener = vi.fn();
    const unsub = onMppInvalidate(listener);
    useCalpinageStore.getState().setMetersPerPixel(0); // ignoré → pas d'invalidation
    expect(listener).not.toHaveBeenCalled();
    useCalpinageStore.getState().setMetersPerPixel(0.3); // valide → invalidation
    expect(listener).toHaveBeenCalledOnce();
    unsub();
  });

  it("unsub supprime le listener", () => {
    const listener = vi.fn();
    const unsub = onMppInvalidate(listener);
    unsub();
    invalidateMppDependentCache();
    expect(listener).not.toHaveBeenCalled();
  });
});

// ─── 3. Simulation resize avec debounce 300ms ────────────────────────────────
//
// On simule un ResizeObserver qui appelle debouncedUpdateMpp à chaque tick.
// Le store ne doit recevoir la nouvelle valeur qu'après 300ms de silence.

describe("simulation resize debounce 300ms", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("le store reçoit la nouvelle valeur mpp après le délai de debounce", () => {
    // Simule la logique debounce telle qu'implémentée dans KonvaOverlay
    let timer: ReturnType<typeof setTimeout> | null = null;
    const MPP_RESIZE = 0.08;

    const debouncedUpdateMpp = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        useCalpinageStore.getState().setMetersPerPixel(MPP_RESIZE);
      }, 300);
    };

    // Plusieurs appels consécutifs (simulate burst resize events)
    debouncedUpdateMpp();
    debouncedUpdateMpp();
    debouncedUpdateMpp();

    // Avant la fin du debounce : store pas encore mis à jour
    vi.advanceTimersByTime(299);
    expect(useCalpinageStore.getState().metersPerPixel).toBeNull();

    // Après 300ms : store mis à jour
    vi.advanceTimersByTime(1);
    expect(useCalpinageStore.getState().metersPerPixel).toBeCloseTo(MPP_RESIZE, 10);
  });

  it("resize rapide puis silence : une seule mise à jour store (pas N)", () => {
    let updateCount = 0;
    const unsub = useCalpinageStore.subscribe(
      (s) => s.metersPerPixel,
      () => { updateCount++; },
    );

    let timer: ReturnType<typeof setTimeout> | null = null;
    const debouncedUpdateMpp = () => {
      if (timer !== null) clearTimeout(timer);
      timer = setTimeout(() => {
        timer = null;
        useCalpinageStore.getState().setMetersPerPixel(0.15);
      }, 300);
    };

    // 10 resize events en rafale
    for (let i = 0; i < 10; i++) debouncedUpdateMpp();

    vi.advanceTimersByTime(300);

    // Store mis à jour exactement 1 fois
    expect(updateCount).toBe(1);
    expect(useCalpinageStore.getState().metersPerPixel).toBeCloseTo(0.15, 10);

    unsub();
  });
});
