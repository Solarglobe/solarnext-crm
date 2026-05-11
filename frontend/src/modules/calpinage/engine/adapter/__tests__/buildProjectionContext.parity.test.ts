/**
 * T11 — Tests de parité : buildProjectionContext vs comportement attendu.
 *
 * Valide la portage TypeScript strict de pvPlacementEngine.buildProjectionContext
 * (T7 — buildProjectionContext.ts) contre des vecteurs de test analytiques.
 *
 * Couverture :
 *   - retours null (paramètres manquants, polygone < 3 pts)
 *   - calcul marginPx = (marginOuterCm / 100) / metersPerPixel
 *   - priorité marginPx explicite (roofConstraints) > calculé
 *   - normalisation orientation ("portrait" / "landscape" / aliases FR)
 *   - priorité pvRules.orientation > panelParams.panelOrientation
 *   - defaulting des arrays roofConstraints (ridgeSegments, traitSegments, obstaclePolygons)
 *   - fallback pan.polygon si roofPolygon absent
 *   - priorité roofPolygon > pan.polygon
 *   - pass-through existingProjections
 *   - normalizePanelOrientation export direct
 *
 * Ces tests ne dépendent d'aucun global window — fonction pure uniquement.
 */

import { describe, it, expect } from "vitest";
import {
  buildProjectionContext,
  normalizePanelOrientation,
} from "../buildProjectionContext";
import type {
  BuildProjectionContextOpts,
  RoofParams,
  PanelParams,
} from "../buildProjectionContext";
import type { Point2D } from "../../geometry/polygonUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures de base
// ─────────────────────────────────────────────────────────────────────────────

/** Polygone carré 100×100 px — cas de base. */
const SQUARE_100: Point2D[] = [
  { x: 0, y: 0 },
  { x: 100, y: 0 },
  { x: 100, y: 100 },
  { x: 0, y: 100 },
];

/** RoofParams standard : 30° face Sud, 10cm/px. */
const ROOF_PITCHED: RoofParams = {
  roofSlopeDeg: 30,
  roofOrientationDeg: 180,
  metersPerPixel: 0.1,
  roofType: "PITCHED",
};

/** RoofParams toiture plate. */
const ROOF_FLAT: RoofParams = {
  roofSlopeDeg: 0,
  metersPerPixel: 0.05,
  roofType: "FLAT",
  supportTiltDeg: 10,
};

/** PanelParams standard : 1000×1700 mm. */
const PANEL_STD: PanelParams = {
  panelWidthMm: 1000,
  panelHeightMm: 1700,
};

/** Options minimales valides. */
function baseOpts(overrides: Partial<BuildProjectionContextOpts> = {}): BuildProjectionContextOpts {
  return {
    roofPolygon: SQUARE_100,
    roofParams: ROOF_PITCHED,
    panelParams: PANEL_STD,
    ...overrides,
  };
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. Retours null — gardes d'entrée
// ─────────────────────────────────────────────────────────────────────────────

describe("buildProjectionContext — gardes null", () => {
  it("retourne null si opts est null", () => {
    // @ts-expect-error test intentionnel
    expect(buildProjectionContext(null)).toBeNull();
  });

  it("retourne null si roofParams absent", () => {
    // @ts-expect-error test intentionnel
    expect(buildProjectionContext({ roofPolygon: SQUARE_100, panelParams: PANEL_STD })).toBeNull();
  });

  it("retourne null si panelParams absent", () => {
    // @ts-expect-error test intentionnel
    expect(buildProjectionContext({ roofPolygon: SQUARE_100, roofParams: ROOF_PITCHED })).toBeNull();
  });

  it("retourne null si roofPolygon vide", () => {
    expect(buildProjectionContext(baseOpts({ roofPolygon: [] }))).toBeNull();
  });

  it("retourne null si roofPolygon a moins de 3 points (2 pts)", () => {
    expect(
      buildProjectionContext(baseOpts({ roofPolygon: [{ x: 0, y: 0 }, { x: 10, y: 0 }] })),
    ).toBeNull();
  });

  it("retourne null si roofPolygon absent ET pan.polygon absent", () => {
    expect(
      buildProjectionContext({
        roofParams: ROOF_PITCHED,
        panelParams: PANEL_STD,
      }),
    ).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. Cas valide de base — structure du résultat
// ─────────────────────────────────────────────────────────────────────────────

describe("buildProjectionContext — structure de base", () => {
  it("retourne un ProjectionContext non-null pour des opts valides", () => {
    const ctx = buildProjectionContext(baseOpts());
    expect(ctx).not.toBeNull();
  });

  it("roofPolygon est identique à l'entrée", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(ctx.roofPolygon).toBe(SQUARE_100); // référence directe (pas de copie profonde)
  });

  it("roofParams est pass-through (même référence)", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(ctx.roofParams).toBe(ROOF_PITCHED);
  });

  it("pvRules est un objet vide si non fourni", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(ctx.pvRules).toBeDefined();
    expect(typeof ctx.pvRules).toBe("object");
  });

  it("existingPanelsProjections est un tableau vide si non fourni", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(Array.isArray(ctx.existingPanelsProjections)).toBe(true);
    expect(ctx.existingPanelsProjections).toHaveLength(0);
  });

  it("existingPanelsProjections pass-through si fourni", () => {
    const proj = [{ points: [{ x: 1, y: 2 }] }];
    const ctx = buildProjectionContext(baseOpts({ existingProjections: proj }))!;
    expect(ctx.existingPanelsProjections).toBe(proj);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. marginPx — calcul et priorités
// ─────────────────────────────────────────────────────────────────────────────

describe("buildProjectionContext — marginPx", () => {
  it("marginPx calculé depuis marginOuterCm + mpp (20cm, 0.1m/px → 2.0 px)", () => {
    // (20 / 100) / 0.1 = 2.0
    const ctx = buildProjectionContext(
      baseOpts({ pvRules: { marginOuterCm: 20 } }),
    )!;
    expect(ctx.roofConstraints.marginPx).toBeCloseTo(2.0, 8);
  });

  it("marginPx calculé : 30cm, mpp=0.05 → 6.0 px", () => {
    // (30 / 100) / 0.05 = 6.0
    const ctx = buildProjectionContext(
      baseOpts({
        roofParams: ROOF_FLAT,
        pvRules: { marginOuterCm: 30 },
      }),
    )!;
    expect(ctx.roofConstraints.marginPx).toBeCloseTo(6.0, 8);
  });

  it("marginPx = 0 si marginOuterCm absent (pvRules vide)", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(ctx.roofConstraints.marginPx).toBe(0);
  });

  it("marginPx explicite (roofConstraints.marginPx) prime sur le calcul", () => {
    // marginPx=99 doit prendre la priorité sur (20cm/0.1) = 2
    const ctx = buildProjectionContext(
      baseOpts({
        pvRules: { marginOuterCm: 20 },
        roofConstraints: { marginPx: 99 },
      }),
    )!;
    expect(ctx.roofConstraints.marginPx).toBe(99);
  });

  it("marginPx = 0 si mpp = 0 (protection division par zéro)", () => {
    const ctx = buildProjectionContext(
      baseOpts({
        roofParams: { ...ROOF_PITCHED, metersPerPixel: 0 },
        pvRules: { marginOuterCm: 20 },
      }),
    )!;
    expect(ctx.roofConstraints.marginPx).toBe(0);
  });

  it("roofConstraints.roofPolygon === roofPolygon (injecté par buildProjectionContext)", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(ctx.roofConstraints.roofPolygon).toBe(SQUARE_100);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Normalisation orientation panneau
// ─────────────────────────────────────────────────────────────────────────────

describe("buildProjectionContext — normalisation orientation", () => {
  const cases: Array<[string | undefined, "PORTRAIT" | "PAYSAGE"]> = [
    [undefined, "PORTRAIT"],
    ["portrait",  "PORTRAIT"],
    ["PORTRAIT",  "PORTRAIT"],
    ["Portrait",  "PORTRAIT"],
    ["landscape", "PAYSAGE"],
    ["LANDSCAPE", "PAYSAGE"],
    ["Landscape", "PAYSAGE"],
    ["paysage",   "PAYSAGE"],
    ["PAYSAGE",   "PAYSAGE"],
    ["Paysage",   "PAYSAGE"],
    ["unknown",   "PORTRAIT"], // valeur inconnue → fallback PORTRAIT
  ];

  for (const [input, expected] of cases) {
    it(`pvRules.orientation="${input}" → panelOrientation="${expected}"`, () => {
      const ctx = buildProjectionContext(
        baseOpts({ pvRules: { orientation: input } }),
      )!;
      expect(ctx.panelParams.panelOrientation).toBe(expected);
    });
  }
});

describe("buildProjectionContext — priorité orientation pvRules > panelParams", () => {
  it("pvRules.orientation prime sur panelParams.panelOrientation", () => {
    const ctx = buildProjectionContext(
      baseOpts({
        panelParams: { ...PANEL_STD, panelOrientation: "portrait" },
        pvRules: { orientation: "landscape" },
      }),
    )!;
    // pvRules gagne → PAYSAGE
    expect(ctx.panelParams.panelOrientation).toBe("PAYSAGE");
  });

  it("panelParams.panelOrientation utilisé si pvRules.orientation absent", () => {
    const ctx = buildProjectionContext(
      baseOpts({
        panelParams: { ...PANEL_STD, panelOrientation: "landscape" },
        pvRules: {},
      }),
    )!;
    expect(ctx.panelParams.panelOrientation).toBe("PAYSAGE");
  });

  it("défaut PORTRAIT si aucune orientation fournie nulle part", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(ctx.panelParams.panelOrientation).toBe("PORTRAIT");
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. Defaulting des arrays roofConstraints
// ─────────────────────────────────────────────────────────────────────────────

describe("buildProjectionContext — defaulting arrays roofConstraints", () => {
  it("ridgeSegments = [] si absent", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(ctx.roofConstraints.ridgeSegments).toEqual([]);
  });

  it("traitSegments = [] si absent", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(ctx.roofConstraints.traitSegments).toEqual([]);
  });

  it("obstaclePolygons = [] si absent", () => {
    const ctx = buildProjectionContext(baseOpts())!;
    expect(ctx.roofConstraints.obstaclePolygons).toEqual([]);
  });

  it("ridgeSegments pass-through si fourni", () => {
    const segs = [{ x1: 0, y1: 0, x2: 10, y2: 0 }];
    const ctx = buildProjectionContext(
      baseOpts({ roofConstraints: { ridgeSegments: segs as any } }),
    )!;
    expect(ctx.roofConstraints.ridgeSegments).toBe(segs);
  });

  it("obstaclePolygons pass-through si fourni", () => {
    const obs = [[{ x: 0, y: 0 }, { x: 5, y: 0 }, { x: 5, y: 5 }]] as Point2D[][];
    const ctx = buildProjectionContext(
      baseOpts({ roofConstraints: { obstaclePolygons: obs as any } }),
    )!;
    expect(ctx.roofConstraints.obstaclePolygons).toBe(obs);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 6. Fallback pan.polygon / priorité roofPolygon
// ─────────────────────────────────────────────────────────────────────────────

describe("buildProjectionContext — polygon source", () => {
  it("utilise pan.polygon si roofPolygon absent", () => {
    const panPoly: Point2D[] = [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
    ];
    const ctx = buildProjectionContext({
      pan: { polygon: panPoly },
      roofParams: ROOF_PITCHED,
      panelParams: PANEL_STD,
    })!;
    expect(ctx.roofPolygon).toBe(panPoly);
  });

  it("roofPolygon explicite prime sur pan.polygon", () => {
    const panPoly: Point2D[] = [
      { x: 10, y: 10 },
      { x: 50, y: 10 },
      { x: 50, y: 50 },
    ];
    const ctx = buildProjectionContext(
      baseOpts({ pan: { polygon: panPoly } }),
    )!;
    // SQUARE_100 (roofPolygon) doit gagner
    expect(ctx.roofPolygon).toBe(SQUARE_100);
    expect(ctx.roofPolygon).not.toBe(panPoly);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 7. Intégration — toiture plate avec supportTiltDeg
// ─────────────────────────────────────────────────────────────────────────────

describe("buildProjectionContext — toiture plate", () => {
  it("retourne un contexte valide pour roofType FLAT", () => {
    const ctx = buildProjectionContext(
      baseOpts({
        roofParams: ROOF_FLAT,
        pvRules: { marginOuterCm: 15, spacingXcm: 2, spacingYcm: 4 },
      }),
    )!;
    expect(ctx).not.toBeNull();
    expect(ctx.roofParams.roofType).toBe("FLAT");
    expect(ctx.roofParams.supportTiltDeg).toBe(10);
    // marginPx pour FLAT : (15/100)/0.05 = 3.0
    expect(ctx.roofConstraints.marginPx).toBeCloseTo(3.0, 8);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 8. normalizePanelOrientation — export direct
// ─────────────────────────────────────────────────────────────────────────────

describe("normalizePanelOrientation", () => {
  it("undefined → PORTRAIT", () => expect(normalizePanelOrientation(undefined)).toBe("PORTRAIT"));
  it("null → PORTRAIT",      () => expect(normalizePanelOrientation(null as any)).toBe("PORTRAIT"));
  it("'' → PORTRAIT",        () => expect(normalizePanelOrientation("")).toBe("PORTRAIT"));
  it("portrait → PORTRAIT",  () => expect(normalizePanelOrientation("portrait")).toBe("PORTRAIT"));
  it("PORTRAIT → PORTRAIT",  () => expect(normalizePanelOrientation("PORTRAIT")).toBe("PORTRAIT"));
  it("Portrait → PORTRAIT",  () => expect(normalizePanelOrientation("Portrait")).toBe("PORTRAIT"));
  it("landscape → PAYSAGE",  () => expect(normalizePanelOrientation("landscape")).toBe("PAYSAGE"));
  it("LANDSCAPE → PAYSAGE",  () => expect(normalizePanelOrientation("LANDSCAPE")).toBe("PAYSAGE"));
  it("Landscape → PAYSAGE",  () => expect(normalizePanelOrientation("Landscape")).toBe("PAYSAGE"));
  it("paysage → PAYSAGE",    () => expect(normalizePanelOrientation("paysage")).toBe("PAYSAGE"));
  it("PAYSAGE → PAYSAGE",    () => expect(normalizePanelOrientation("PAYSAGE")).toBe("PAYSAGE"));
  it("Paysage → PAYSAGE",    () => expect(normalizePanelOrientation("Paysage")).toBe("PAYSAGE"));
  it("valeur inconnue → PORTRAIT", () => expect(normalizePanelOrientation("diagonal")).toBe("PORTRAIT"));
});
