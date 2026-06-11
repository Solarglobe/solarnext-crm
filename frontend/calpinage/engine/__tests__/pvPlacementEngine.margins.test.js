import { beforeAll, describe, expect, it } from "vitest";

/**
 * SAFE-ZONE-V2 — validation moteur : marges cm reelles autour des faitages/traits
 * (remplace l'eps de contact historique ~0) + retrocompat sans marges.
 */

let ENG;

beforeAll(async () => {
  const mod = await import("../pvPlacementEngine.js");
  ENG = (mod && (mod.default || mod.pvPlacementEngine))
    || (typeof window !== "undefined" && window.pvPlacementEngine)
    || (typeof globalThis !== "undefined" && globalThis.pvPlacementEngine);
  expect(ENG).toBeTruthy();
});

function panelAt(cx, cy, half = 5) {
  return [
    { x: cx - half, y: cy - half },
    { x: cx + half, y: cy - half },
    { x: cx + half, y: cy + half },
    { x: cx - half, y: cy + half },
  ];
}

// faitage vertical x=50 ; panneau 10x10 centre (62,50) -> bord gauche a 7 px du faitage
const RIDGE = [{ x: 50, y: 0 }, { x: 50, y: 100 }];

describe("pvPlacementEngine — marges faitage/trait (SAFE-ZONE-V2)", () => {
  it("retrocompat : sans ridgeMarginPx, seul le contact/croisement est interdit", () => {
    const ok = ENG.validatePanelPolygon(panelAt(62, 50), [], [], {
      ridgeSegments: [RIDGE],
      traitSegments: [],
    });
    expect(ok).toBe(true);
  });

  it("ridgeMarginPx 10 : panneau a 7 px du faitage -> invalide", () => {
    const ok = ENG.validatePanelPolygon(panelAt(62, 50), [], [], {
      ridgeSegments: [RIDGE],
      traitSegments: [],
      ridgeMarginPx: 10,
    });
    expect(ok).toBe(false);
  });

  it("ridgeMarginPx 10 : panneau a 15 px du faitage -> valide", () => {
    const ok = ENG.validatePanelPolygon(panelAt(70, 50), [], [], {
      ridgeSegments: [RIDGE],
      traitSegments: [],
      ridgeMarginPx: 10,
    });
    expect(ok).toBe(true);
  });

  it("traitMarginPx independant de ridgeMarginPx", () => {
    const okTraitStrict = ENG.validatePanelPolygon(panelAt(62, 50), [], [], {
      ridgeSegments: [],
      traitSegments: [RIDGE],
      ridgeMarginPx: 50,
      traitMarginPx: 5,
    });
    expect(okTraitStrict).toBe(true); // 7 px > 5 px de marge trait
    const koTrait = ENG.validatePanelPolygon(panelAt(62, 50), [], [], {
      ridgeSegments: [],
      traitSegments: [RIDGE],
      traitMarginPx: 10,
    });
    expect(koTrait).toBe(false);
  });

  it("obstacleMarginPx : deja supporte par steps 0-1 (PITCHED le recoit desormais)", () => {
    const obstacle = [
      { x: 80, y: 40 },
      { x: 90, y: 40 },
      { x: 90, y: 60 },
      { x: 80, y: 60 },
    ];
    // panneau centre (62,50) -> bord droit x=67 ; obstacle a x=80 -> distance 13
    const okSans = ENG.validatePanelPolygon(panelAt(62, 50), [obstacle], [], {
      ridgeSegments: [],
      traitSegments: [],
    });
    expect(okSans).toBe(true);
    const koAvec = ENG.validatePanelPolygon(panelAt(62, 50), [obstacle], [], {
      ridgeSegments: [],
      traitSegments: [],
      obstacleMarginPx: 20,
    });
    expect(koAvec).toBe(false);
  });
});
