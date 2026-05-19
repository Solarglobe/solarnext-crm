/**
 * Tests unitaires — CalpinageFeatureContext.
 *
 * Vérifie :
 * 1. Les valeurs par défaut retournées sans Provider
 * 2. Les valeurs calculées par le Provider (via prop `flags`)
 * 3. L'isolation du prop `flags` pour chaque test
 */

import { renderHook } from "@testing-library/react";
import { type ReactNode } from "react";
import { describe, it, expect } from "vitest";
import {
  CalpinageFeatureProvider,
  useCalpinageFeatures,
  type CalpinageFeatureFlags,
} from "../CalpinageFeatureContext";

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function makeWrapper(flags: Partial<CalpinageFeatureFlags>) {
  return function Wrapper({ children }: { children: ReactNode }) {
    return (
      <CalpinageFeatureProvider flags={flags}>{children}</CalpinageFeatureProvider>
    );
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// Tests
// ─────────────────────────────────────────────────────────────────────────────

describe("useCalpinageFeatures", () => {
  it("retourne vertexZEdit=true par défaut (produit activé)", () => {
    const { result } = renderHook(() => useCalpinageFeatures(), {
      wrapper: makeWrapper({}),
    });
    expect(result.current.vertexZEdit).toBe(true);
  });

  it("retourne vertexXYEdit=false par défaut", () => {
    const { result } = renderHook(() => useCalpinageFeatures(), {
      wrapper: makeWrapper({}),
    });
    expect(result.current.vertexXYEdit).toBe(false);
  });

  it("retourne ridgeHeightEdit=false par défaut", () => {
    const { result } = renderHook(() => useCalpinageFeatures(), {
      wrapper: makeWrapper({}),
    });
    expect(result.current.ridgeHeightEdit).toBe(false);
  });

  it("retourne pvPlaceProbe=false par défaut", () => {
    const { result } = renderHook(() => useCalpinageFeatures(), {
      wrapper: makeWrapper({}),
    });
    expect(result.current.pvPlaceProbe).toBe(false);
  });

  it("retourne pvLayoutMode=true par défaut (produit activé)", () => {
    const { result } = renderHook(() => useCalpinageFeatures(), {
      wrapper: makeWrapper({}),
    });
    expect(result.current.pvLayoutMode).toBe(true);
  });

  it("applique le prop flags partiel — vertexXYEdit override", () => {
    const { result } = renderHook(() => useCalpinageFeatures(), {
      wrapper: makeWrapper({ vertexXYEdit: true }),
    });
    expect(result.current.vertexXYEdit).toBe(true);
    // Les autres flags ne sont pas affectés
    expect(result.current.vertexZEdit).toBe(true);
  });

  it("applique le prop flags partiel — pvPlaceProbe override", () => {
    const { result } = renderHook(() => useCalpinageFeatures(), {
      wrapper: makeWrapper({ pvPlaceProbe: true }),
    });
    expect(result.current.pvPlaceProbe).toBe(true);
  });

  it("applique le prop flags complet", () => {
    const overrides: CalpinageFeatureFlags = {
      vertexZEdit: false,
      vertexXYEdit: true,
      ridgeHeightEdit: true,
      pvPlaceProbe: true,
      pvLayoutMode: false,
    };
    const { result } = renderHook(() => useCalpinageFeatures(), {
      wrapper: makeWrapper(overrides),
    });
    expect(result.current).toMatchObject(overrides);
  });

  it("retourne les DEFAULT_FLAGS sans Provider", () => {
    // Sans wrapper, le hook lit le context avec sa valeur par défaut (DEFAULT_FLAGS).
    const { result } = renderHook(() => useCalpinageFeatures());
    expect(result.current.vertexZEdit).toBe(true);
    expect(result.current.vertexXYEdit).toBe(false);
    expect(result.current.ridgeHeightEdit).toBe(false);
    expect(result.current.pvPlaceProbe).toBe(false);
    expect(result.current.pvLayoutMode).toBe(true);
  });
});
