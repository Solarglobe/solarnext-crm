import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  assertSlopeNotQuasiVertical,
  onQuasiVerticalError,
  parseQuasiVerticalError,
  isQuasiVertical,
} from "../placementSlopeGuard";
import { CALPINAGE_CONFIG } from "../../../config/calpinageConfig";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de référence
// ─────────────────────────────────────────────────────────────────────────────

const MAX_DEG = CALPINAGE_CONFIG.maxSlopeDeg; // 75°
const MAX_RAD = (MAX_DEG * Math.PI) / 180;

// slopeRad = 90° × 0.9 = 81° > 75° → doit throw (cas de test explicite du brief)
const SLOPE_81_RAD = (Math.PI / 2) * 0.9;
const SLOPE_81_DEG = (SLOPE_81_RAD * 180) / Math.PI; // ~81.00°

// ─────────────────────────────────────────────────────────────────────────────
// assertSlopeNotQuasiVertical
// ─────────────────────────────────────────────────────────────────────────────

describe("assertSlopeNotQuasiVertical", () => {
  it("ne lève pas pour une pente nulle", () => {
    expect(() => assertSlopeNotQuasiVertical(0)).not.toThrow();
  });

  it("ne lève pas pour 30° (pan courant)", () => {
    expect(() => assertSlopeNotQuasiVertical((30 * Math.PI) / 180)).not.toThrow();
  });

  it("ne lève pas pour exactement 75° (seuil non inclus, strict >)", () => {
    expect(() => assertSlopeNotQuasiVertical(MAX_RAD)).not.toThrow();
  });

  it("ne lève pas pour 74.99° (juste en dessous du seuil)", () => {
    const rad = (74.99 * Math.PI) / 180;
    expect(() => assertSlopeNotQuasiVertical(rad)).not.toThrow();
  });

  // ── Cas du brief : slopeRad = Math.PI/2 * 0.9 → expect(fn).toThrow("QUASI_VERTICAL_FACE") ──

  it("lève QUASI_VERTICAL_FACE pour slopeRad = Math.PI/2 * 0.9 (~81°)", () => {
    expect(() => assertSlopeNotQuasiVertical(SLOPE_81_RAD)).toThrow("QUASI_VERTICAL_FACE");
  });

  it("message contient la pente en degrés (format X.X)", () => {
    expect(() => assertSlopeNotQuasiVertical(SLOPE_81_RAD)).toThrow(
      `QUASI_VERTICAL_FACE:${SLOPE_81_DEG.toFixed(1)}`,
    );
  });

  it("lève pour 76° (1° au-dessus du seuil)", () => {
    expect(() => assertSlopeNotQuasiVertical((76 * Math.PI) / 180)).toThrow("QUASI_VERTICAL_FACE");
  });

  it("lève pour slopeRad = π/2 (face verticale parfaite)", () => {
    expect(() => assertSlopeNotQuasiVertical(Math.PI / 2)).toThrow("QUASI_VERTICAL_FACE");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// onQuasiVerticalError — pub/sub
// ─────────────────────────────────────────────────────────────────────────────

describe("onQuasiVerticalError", () => {
  it("appelle le listener avant de lancer l'exception", () => {
    const cb = vi.fn();
    const unsub = onQuasiVerticalError(cb);
    try {
      assertSlopeNotQuasiVertical(SLOPE_81_RAD);
    } catch {
      // attendu
    }
    expect(cb).toHaveBeenCalledOnce();
    expect(cb).toHaveBeenCalledWith(expect.closeTo(SLOPE_81_DEG, 3));
    unsub();
  });

  it("n'appelle pas le listener pour une pente valide", () => {
    const cb = vi.fn();
    const unsub = onQuasiVerticalError(cb);
    assertSlopeNotQuasiVertical((30 * Math.PI) / 180);
    expect(cb).not.toHaveBeenCalled();
    unsub();
  });

  it("unsub supprime le listener", () => {
    const cb = vi.fn();
    const unsub = onQuasiVerticalError(cb);
    unsub();
    try {
      assertSlopeNotQuasiVertical(SLOPE_81_RAD);
    } catch {
      // attendu
    }
    expect(cb).not.toHaveBeenCalled();
  });

  it("plusieurs listeners appelés dans l'ordre d'inscription", () => {
    const order: number[] = [];
    const unsub1 = onQuasiVerticalError(() => order.push(1));
    const unsub2 = onQuasiVerticalError(() => order.push(2));
    try {
      assertSlopeNotQuasiVertical(SLOPE_81_RAD);
    } catch {
      // attendu
    }
    expect(order).toEqual([1, 2]);
    unsub1();
    unsub2();
  });

  it("une erreur dans un listener n'empêche pas les suivants ni le throw moteur", () => {
    const cb2 = vi.fn();
    const unsub1 = onQuasiVerticalError(() => { throw new Error("listener boom"); });
    const unsub2 = onQuasiVerticalError(cb2);
    expect(() => assertSlopeNotQuasiVertical(SLOPE_81_RAD)).toThrow("QUASI_VERTICAL_FACE");
    expect(cb2).toHaveBeenCalledOnce();
    unsub1();
    unsub2();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// parseQuasiVerticalError
// ─────────────────────────────────────────────────────────────────────────────

describe("parseQuasiVerticalError", () => {
  it("retourne slopeDeg depuis un message QUASI_VERTICAL_FACE valide", () => {
    let captured: unknown = null;
    try {
      assertSlopeNotQuasiVertical(SLOPE_81_RAD);
    } catch (e) {
      captured = e;
    }
    const deg = parseQuasiVerticalError(captured);
    expect(deg).not.toBeNull();
    expect(deg!).toBeCloseTo(SLOPE_81_DEG, 1);
  });

  it("retourne null pour une Error sans préfixe QUASI_VERTICAL_FACE", () => {
    expect(parseQuasiVerticalError(new Error("autre erreur"))).toBeNull();
  });

  it("retourne null pour une valeur non-Error", () => {
    expect(parseQuasiVerticalError("string")).toBeNull();
    expect(parseQuasiVerticalError(null)).toBeNull();
    expect(parseQuasiVerticalError(42)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// isQuasiVertical
// ─────────────────────────────────────────────────────────────────────────────

describe("isQuasiVertical", () => {
  it("retourne false pour 30°", () => {
    expect(isQuasiVertical((30 * Math.PI) / 180)).toBe(false);
  });

  it("retourne false pour exactement 75°", () => {
    expect(isQuasiVertical(MAX_RAD)).toBe(false);
  });

  it("retourne true pour slopeRad = Math.PI/2 * 0.9 (~81°)", () => {
    expect(isQuasiVertical(SLOPE_81_RAD)).toBe(true);
  });

  it("retourne true pour π/2 (vertical)", () => {
    expect(isQuasiVertical(Math.PI / 2)).toBe(true);
  });
});
