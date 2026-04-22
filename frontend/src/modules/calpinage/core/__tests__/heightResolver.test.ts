/**
 * Tests unitaires — moteur de résolution des hauteurs (heightResolver.ts)
 *
 * 6 cas obligatoires + cas additionnels de robustesse.
 * Aucune dépendance à window ni à CALPINAGE_STATE global.
 * Tous les contextes sont injectés via HeightResolverContext.
 */

import { describe, it, expect } from "vitest";
import {
  resolveHeightAtXY,
  resolveHeightAtXYDetailed,
  getExplicitHeightAtPoint,
  resolveHeightFromPanPlane,
  resolveHeightFallback,
  HEIGHT_SOURCE_CONFIDENCE,
  type HeightResolverContext,
  type HeightStateContext,
  type ResolveHeightOptions,
} from "../heightResolver";

// ─────────────────────────────────────────────────────────────────────────────
// FIXTURES
// ─────────────────────────────────────────────────────────────────────────────

/** State avec contours, ridges, traits portant des hauteurs explicites. */
const stateWithExplicitHeights: HeightStateContext = {
  contours: [
    {
      roofRole: "contour",
      points: [
        { x: 100, y: 100, h: 4.0 },
        { x: 200, y: 100, h: 4.0 },
        { x: 200, y: 200, h: 4.0 },
        { x: 100, y: 200, h: 4.0 },
      ],
    },
  ],
  ridges: [
    {
      roofRole: "ridge",
      a: { x: 150, y: 110, h: 7.0 },
      b: { x: 150, y: 190, h: 7.0 },
    },
  ],
  traits: [
    {
      roofRole: "trait",
      a: { x: 130, y: 150, h: 5.5 },
      b: { x: 170, y: 150, h: 5.5 },
    },
  ],
};

/** State sans aucune hauteur explicite. */
const stateWithoutHeights: HeightStateContext = {
  contours: [
    {
      points: [
        { x: 100, y: 100 },
        { x: 200, y: 100 },
      ],
    },
  ],
  ridges: [],
  traits: [],
};

/** State vide. */
const emptyState: HeightStateContext = {};

/** Context avec getHeightAtXY fonctionnel (simule fitPlane). */
function makeContextWithFitPlane(
  planeFn: (panId: string, x: number, y: number) => number | null,
  hitTestFn?: (pt: { x: number; y: number }) => { id: string } | null,
  state?: HeightStateContext | null,
): HeightResolverContext {
  return {
    getHeightAtXY: planeFn,
    hitTestPan: hitTestFn,
    state: state ?? null,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// CAS 1 — Point avec hauteur explicite
// ─────────────────────────────────────────────────────────────────────────────

describe("CAS 1 — Point avec hauteur explicite", () => {
  it("retourne la hauteur d'un ridge si le point est dans le rayon epsilon", () => {
    const ctx: HeightResolverContext = { state: stateWithExplicitHeights };
    const result = resolveHeightAtXY(150, 110, ctx, { epsilonPx: 15 });
    expect(result.ok).toBe(true);
    expect(result.heightM).toBe(7.0);
    expect(result.source).toBe("explicit_vertex_ridge");
    expect(result.confidence).toBeGreaterThan(0.90);
  });

  it("retourne la hauteur d'un contour si le point est dans le rayon epsilon", () => {
    const ctx: HeightResolverContext = { state: stateWithExplicitHeights };
    const result = resolveHeightAtXY(100, 100, ctx, { epsilonPx: 15 });
    expect(result.ok).toBe(true);
    expect(result.heightM).toBe(4.0);
    expect(result.source).toBe("explicit_vertex_contour");
  });

  it("retourne la hauteur d'un trait si le point est dans le rayon epsilon", () => {
    const ctx: HeightResolverContext = { state: stateWithExplicitHeights };
    // Ridge-first : si le point est exactement sur un contour mais pas un ridge,
    // on vérifie que le trait est retourné si le contour ne matche pas.
    const result = resolveHeightAtXY(130, 150, ctx, { epsilonPx: 15 });
    // La position 130,150 est sur le trait et aussi proche du trait.
    // Le ridge 150,110 est loin → pas de match ridge.
    // Les contours n'ont pas de point à 130,150 → pas de match.
    // Le trait a un point à 130,150 → match.
    expect(result.ok).toBe(true);
    expect(result.source).toBe("explicit_vertex_trait");
    expect(result.heightM).toBe(5.5);
  });

  it("la confidence d'une hauteur explicite est la plus haute possible (>= 0.90)", () => {
    const ctx: HeightResolverContext = { state: stateWithExplicitHeights };
    const result = resolveHeightAtXY(150, 110, ctx);
    expect(result.confidence).toBeGreaterThanOrEqual(0.90);
  });

  it("ne retourne pas un vertex hors epsilon", () => {
    const ctx: HeightResolverContext = { state: stateWithExplicitHeights };
    // Point 150,110 est un ridge, mais on est à 500,500 — loin de tout.
    const result = resolveHeightAtXY(500, 500, ctx, { epsilonPx: 15 });
    expect(result.ok).toBe(false); // doit passer en fallback
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 2 — Point sur un pan simple (fitPlane avec panId connu)
// ─────────────────────────────────────────────────────────────────────────────

describe("CAS 2 — Point sur un pan simple (fitPlane panId connu)", () => {
  it("retourne la hauteur via fitPlane quand panId est fourni", () => {
    const fitPlane = (_panId: string, _x: number, _y: number) => 4.27;
    const ctx = makeContextWithFitPlane(fitPlane);
    const result = resolveHeightAtXY(120, 150, ctx, { panId: "pan-abc" });

    expect(result.ok).toBe(true);
    expect(result.heightM).toBeCloseTo(4.27);
    expect(result.source).toBe("pan_plane_fit");
    expect(result.panId).toBe("pan-abc");
    expect(result.confidence).toBe(HEIGHT_SOURCE_CONFIDENCE["pan_plane_fit"]);
  });

  it("la confidence de fitPlane avec panId connu est 0.85", () => {
    const ctx = makeContextWithFitPlane(() => 3.5);
    const result = resolveHeightAtXY(100, 100, ctx, { panId: "p1" });
    expect(result.confidence).toBe(0.85);
  });

  it("retourne ok=false si fitPlane retourne null", () => {
    const ctx = makeContextWithFitPlane(() => null);
    const result = resolveHeightAtXY(100, 100, ctx, { panId: "p-bad" });
    expect(result.ok).toBe(false);
  });

  it("retourne ok=false si fitPlane retourne NaN", () => {
    const ctx = makeContextWithFitPlane(() => NaN);
    const result = resolveHeightAtXY(100, 100, ctx, { panId: "p-nan" });
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 3 — Point sur ridge/trait (hit-test automatique)
// ─────────────────────────────────────────────────────────────────────────────

describe("CAS 3 — Résolution via hit-test pan automatique", () => {
  it("retourne la hauteur via hit-test + fitPlane quand panId non connu en avance", () => {
    const fitPlane = (_panId: string, _x: number, _y: number) => 6.1;
    const hitTest = (_pt: { x: number; y: number }) => ({ id: "pan-hittested" });
    const ctx = makeContextWithFitPlane(fitPlane, hitTest);
    const result = resolveHeightAtXY(155, 130, ctx);

    expect(result.ok).toBe(true);
    expect(result.heightM).toBeCloseTo(6.1);
    expect(result.source).toBe("pan_plane_fit_hittest");
    expect(result.panId).toBe("pan-hittested");
    expect(result.confidence).toBe(HEIGHT_SOURCE_CONFIDENCE["pan_plane_fit_hittest"]);
  });

  it("la confidence via hit-test (0.78) est inférieure à via panId connu (0.85)", () => {
    expect(HEIGHT_SOURCE_CONFIDENCE["pan_plane_fit_hittest"])
      .toBeLessThan(HEIGHT_SOURCE_CONFIDENCE["pan_plane_fit"]);
  });

  it("retourne ok=false si hitTest retourne null (hors pan)", () => {
    const fitPlane = () => 4.0;
    const hitTest = () => null;
    const ctx = makeContextWithFitPlane(fitPlane, hitTest);
    const result = resolveHeightAtXY(999, 999, ctx);
    expect(result.ok).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 4 — Point hors zone fiable (fallback)
// ─────────────────────────────────────────────────────────────────────────────

describe("CAS 4 — Fallback propre quand aucune source disponible", () => {
  it("retourne insufficient_height_signal si aucun contexte ni defaultHeightM", () => {
    const result = resolveHeightAtXY(100, 100, {});
    expect(result.ok).toBe(false);
    expect(result.heightM).toBeUndefined();
    expect(result.source).toBe("insufficient_height_signal");
    expect(result.confidence).toBeLessThan(0.30);
    expect(result.warning).toBeTruthy();
  });

  it("retourne fallback_default si defaultHeightM est configuré", () => {
    const result = resolveHeightAtXY(100, 100, {}, { defaultHeightM: 5.5 });
    expect(result.ok).toBe(false);
    expect(result.heightM).toBe(5.5);
    expect(result.source).toBe("fallback_default");
    expect(result.warning).toBeTruthy();
  });

  it("ne lève jamais d'exception en fallback", () => {
    expect(() => resolveHeightAtXY(NaN, NaN, {})).not.toThrow();
    expect(() => resolveHeightAtXY(100, 100, {}, { epsilonPx: -1 })).not.toThrow();
  });

  it("confidence du fallback est < 0.30", () => {
    const r = resolveHeightAtXY(100, 100, {});
    expect(r.confidence).toBeLessThan(0.30);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 5 — Données legacy incomplètes
// ─────────────────────────────────────────────────────────────────────────────

describe("CAS 5 — Données legacy incomplètes et robustesse", () => {
  it("ne plante pas si contours.points est undefined", () => {
    const brokenState: HeightStateContext = {
      contours: [{ roofRole: "contour" }],
      ridges: [],
    };
    const ctx: HeightResolverContext = { state: brokenState };
    expect(() => resolveHeightAtXY(100, 100, ctx)).not.toThrow();
  });

  it("ne plante pas si ridges[i].a est undefined", () => {
    const brokenState: HeightStateContext = {
      ridges: [{ roofRole: "ridge" }],
    };
    const ctx: HeightResolverContext = { state: brokenState };
    expect(() => resolveHeightAtXY(150, 110, ctx)).not.toThrow();
  });

  it("ignore les entités chienAssis", () => {
    const stateWithChienAssis: HeightStateContext = {
      ridges: [
        {
          roofRole: "chienAssis",
          a: { x: 150, y: 110, h: 9999 },
          b: { x: 150, y: 190, h: 9999 },
        },
      ],
      contours: [],
      traits: [],
    };
    const ctx: HeightResolverContext = { state: stateWithChienAssis };
    const result = resolveHeightAtXY(150, 110, ctx, { epsilonPx: 15 });
    // Doit ignorer le chienAssis et tomber en fallback
    expect(result.ok).toBe(false);
    expect(result.heightM).not.toBe(9999);
  });

  it("ne plante pas si getHeightAtXY lève une exception", () => {
    const ctx = makeContextWithFitPlane(() => {
      throw new Error("runtime not ready");
    });
    expect(() => resolveHeightAtXY(100, 100, ctx, { panId: "p1" })).not.toThrow();
    const result = resolveHeightAtXY(100, 100, ctx, { panId: "p1" });
    expect(result.ok).toBe(false);
  });

  it("ne plante pas si hitTestPan lève une exception", () => {
    const ctx: HeightResolverContext = {
      getHeightAtXY: () => 4.0,
      hitTestPan: () => {
        throw new Error("hit-test crash");
      },
    };
    expect(() => resolveHeightAtXY(100, 100, ctx)).not.toThrow();
  });

  it("traite un state vide comme absence de données explicites", () => {
    const ctx: HeightResolverContext = { state: emptyState };
    const result = resolveHeightAtXY(100, 100, ctx);
    expect(result.ok).toBe(false);
    expect(result.source === "insufficient_height_signal" || result.source === "fallback_default").toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// CAS 6 — Non-régression (priorité correcte, pas de cassure de sémantique)
// ─────────────────────────────────────────────────────────────────────────────

describe("CAS 6 — Non-régression et ordre de priorité", () => {
  it("P1 (explicite) prime sur P2 (fitPlane) quand les deux sont disponibles", () => {
    // Ridge à 150,110 h=7.0, fitPlane retournerait 4.0
    const ctx: HeightResolverContext = {
      state: stateWithExplicitHeights,
      getHeightAtXY: () => 4.0,
    };
    const result = resolveHeightAtXY(150, 110, ctx, { panId: "pan-abc", epsilonPx: 15 });
    expect(result.source).toBe("explicit_vertex_ridge");
    expect(result.heightM).toBe(7.0); // pas 4.0
  });

  it("P2 (panId connu) prime sur P3 (hit-test) quand les deux sont disponibles", () => {
    const fitPlane = (panId: string) => panId === "known-pan" ? 5.5 : 99.0;
    const hitTest = () => ({ id: "hittested-pan" });
    const ctx = makeContextWithFitPlane(fitPlane, hitTest);
    const result = resolveHeightAtXY(100, 100, ctx, { panId: "known-pan" });
    expect(result.source).toBe("pan_plane_fit");
    expect(result.panId).toBe("known-pan");
    expect(result.heightM).toBe(5.5);
  });

  it("l'ordre de confiance est cohérent : ridge > contour > trait > fitPlane > hittest > fallback", () => {
    const sources = [
      "explicit_vertex_ridge",
      "explicit_vertex_contour",
      "explicit_vertex_trait",
      "pan_plane_fit",
      "pan_plane_fit_hittest",
      "fallback_default",
      "insufficient_height_signal",
    ] as const;
    for (let i = 0; i < sources.length - 1; i++) {
      expect(HEIGHT_SOURCE_CONFIDENCE[sources[i]])
        .toBeGreaterThan(HEIGHT_SOURCE_CONFIDENCE[sources[i + 1]]);
    }
  });

  it("resolveHeightAtXYDetailed retourne toujours le champ debug", () => {
    const result = resolveHeightAtXYDetailed(100, 100, {});
    expect(result.debug).toBeDefined();
    expect(result.debug!.method).toBeTruthy();
  });

  it("heightM est fini sauf insufficient_height_signal (pas de 0 silencieux)", () => {
    const contexts: Array<[HeightResolverContext, ResolveHeightOptions]> = [
      [{}, {}],
      [{ state: emptyState }, {}],
      [{ state: stateWithExplicitHeights }, { epsilonPx: 0 }],
      [makeContextWithFitPlane(() => null), { panId: "p1" }],
      [makeContextWithFitPlane(() => Infinity), { panId: "p2" }],
    ];
    for (const [ctx, opts] of contexts) {
      const r = resolveHeightAtXY(100, 100, ctx, opts);
      if (r.source === "insufficient_height_signal") {
        expect(r.heightM).toBeUndefined();
      } else {
        expect(r.heightM).toBeDefined();
        expect(Number.isFinite(r.heightM!)).toBe(true);
      }
    }
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// TESTS HELPERS PURS
// ─────────────────────────────────────────────────────────────────────────────

describe("helpers purs", () => {
  it("getExplicitHeightAtPoint retourne null si état vide", () => {
    expect(getExplicitHeightAtPoint(100, 100, {})).toBeNull();
  });

  it("getExplicitHeightAtPoint interpole h sur l’arête du contour (pas seulement les sommets)", () => {
    const state = {
      contours: [
        {
          roofRole: "main",
          points: [
            { x: 0, y: 0, h: 4 },
            { x: 100, y: 0, h: 8 },
            { x: 100, y: 100, h: 4 },
            { x: 0, y: 100, h: 4 },
          ],
        },
      ],
    };
    const r = getExplicitHeightAtPoint(50, 3, state, 15);
    expect(r).not.toBeNull();
    expect(r!.source).toBe("explicit_vertex_contour");
    expect(r!.heightM).toBeCloseTo(6, 5);
  });

  it("resolveHeightFromPanPlane retourne null si getHeightAtXY retourne undefined", () => {
    const result = resolveHeightFromPanPlane("p1", 10, 10, () => undefined, false);
    expect(result).toBeNull();
  });

  it("resolveHeightFallback retourne insufficient_height_signal si defaultHeightM absent", () => {
    const r = resolveHeightFallback(undefined);
    expect(r.source).toBe("insufficient_height_signal");
    expect(r.heightM).toBeUndefined();
  });

  it("resolveHeightFallback retourne fallback_default avec la valeur fournie", () => {
    const r = resolveHeightFallback(5.5);
    expect(r.source).toBe("fallback_default");
    expect(r.heightM).toBe(5.5);
  });
});
