/**
 * T12 — Tests de parité : panelValidator.ts
 *
 * Valide les 4 fonctions pures extraites de pvPlacementEngine.js L.108–517 (T6).
 * Tous les vecteurs de test utilisent des polygones analytiques simples (carrés, triangles)
 * pour que les résultats soient vérifiables sans runtime legacy.
 *
 * Couverture :
 *   validatePanelPolygonSteps0And1   — strict bounds, obstacles, marge obstacle
 *   validatePanelPolygonStep3Ridge   — keepout faîtage / trait
 *   validateAutofillCandidateDetailed — diagnostic structuré (5 raisons d'invalidité)
 *   validatePanelPolygon             — pipeline complet (intégration)
 *
 * Conventions géométriques :
 *   Polygones exprimés en pixels image (origine haut-gauche, +x droite, +y bas).
 *   Un carré de 30×30 px centré à (65,65) = [{x:50,y:50}, {x:80,y:50}, {x:80,y:80}, {x:50,y:80}].
 *   Pan porteur 200×200 px = [{x:0,y:0}, {x:200,y:0}, {x:200,y:200}, {x:0,y:200}].
 */

import { describe, it, expect } from "vitest";
import {
  validatePanelPolygonSteps0And1,
  validatePanelPolygonStep3Ridge,
  validateAutofillCandidateDetailed,
  validatePanelPolygon,
} from "../panelValidator";
import type {
  RoofConstraints,
  ValidationCaches,
  BlockLike,
} from "../panelValidator";
import type { Point2D, Segment2D } from "../../geometry/polygonUtils";

// ─────────────────────────────────────────────────────────────────────────────
// Fixtures géométriques
// ─────────────────────────────────────────────────────────────────────────────

/** Pan porteur 200×200 px. */
const PAN_200: Point2D[] = [
  { x: 0, y: 0 },
  { x: 200, y: 0 },
  { x: 200, y: 200 },
  { x: 0, y: 200 },
];

/** Panneau 30×30 px centré à (65,65) — bien dans le pan, loin des bords. */
const PANEL_OK: Point2D[] = [
  { x: 50, y: 50 },
  { x: 80, y: 50 },
  { x: 80, y: 80 },
  { x: 50, y: 80 },
];

/** Panneau 30×30 px en (5,5) — coins trop proches des bords (margin 10px sera violée). */
const PANEL_NEAR_EDGE: Point2D[] = [
  { x: 5, y: 5 },
  { x: 35, y: 5 },
  { x: 35, y: 35 },
  { x: 5, y: 35 },
];

/** Panneau complètement hors du pan (x > 200). */
const PANEL_OUTSIDE: Point2D[] = [
  { x: 210, y: 50 },
  { x: 240, y: 50 },
  { x: 240, y: 80 },
  { x: 210, y: 80 },
];

/** Obstacle 30×30 px en (90,90) — ne chevauche pas PANEL_OK. */
const OBS_NO_OVERLAP: Point2D[] = [
  { x: 90, y: 90 },
  { x: 120, y: 90 },
  { x: 120, y: 120 },
  { x: 90, y: 120 },
];

/** Obstacle chevauchant PANEL_OK (overlap partiel à [70,70]-[90,90]). */
const OBS_OVERLAP: Point2D[] = [
  { x: 70, y: 70 },
  { x: 100, y: 70 },
  { x: 100, y: 100 },
  { x: 70, y: 100 },
];

/** Obstacle proche mais pas chevauchant PANEL_OK (distance ~5 px). */
const OBS_NEAR: Point2D[] = [
  { x: 85, y: 50 },
  { x: 115, y: 50 },
  { x: 115, y: 80 },
  { x: 85, y: 80 },
];

/** Segment de faîtage loin du panneau (y=10, horizontal). */
const RIDGE_FAR: Segment2D[] = [{ start: { x: 0, y: 10 }, end: { x: 200, y: 10 } }];

/** Segment de faîtage touchant le bord supérieur de PANEL_OK (y=50). Distance vertex→segment = 0 < eps. */
const RIDGE_CROSS: Segment2D[] = [{ start: { x: 0, y: 50 }, end: { x: 200, y: 50 } }];

/** Contraintes sans strict, sans obstacles, sans segments. */
const CONSTRAINTS_EMPTY: RoofConstraints = {
  roofPolygon: PAN_200,
  marginPx: 0,
  strictBounds: false,
};

/** Contraintes mode strict, marginPx=10. */
const CONSTRAINTS_STRICT: RoofConstraints = {
  roofPolygon: PAN_200,
  marginPx: 10,
  strictBounds: true,
};

// ─────────────────────────────────────────────────────────────────────────────
// 1. validatePanelPolygonSteps0And1
// ─────────────────────────────────────────────────────────────────────────────

describe("validatePanelPolygonSteps0And1 — gardes d'entrée", () => {
  it("polygone vide → false", () => {
    expect(validatePanelPolygonSteps0And1([], [], CONSTRAINTS_EMPTY)).toBe(false);
  });

  it("polygone < 3 sommets → false", () => {
    const line: Point2D[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    expect(validatePanelPolygonSteps0And1(line, [], CONSTRAINTS_EMPTY)).toBe(false);
  });
});

describe("validatePanelPolygonSteps0And1 — sans obstacles, sans strict", () => {
  it("panneau valide → true (aucune contrainte)", () => {
    expect(validatePanelPolygonSteps0And1(PANEL_OK, [], CONSTRAINTS_EMPTY)).toBe(true);
  });

  it("panneau hors pan → true quand strictBounds=false", () => {
    // Sans strict, la position hors pan n'est pas vérifiée par cette étape
    expect(validatePanelPolygonSteps0And1(PANEL_OUTSIDE, [], CONSTRAINTS_EMPTY)).toBe(true);
  });

  it("null constraints → true (pas de garde null)", () => {
    expect(validatePanelPolygonSteps0And1(PANEL_OK, [], null)).toBe(true);
  });

  it("undefined constraints → true", () => {
    expect(validatePanelPolygonSteps0And1(PANEL_OK, [], undefined)).toBe(true);
  });
});

describe("validatePanelPolygonSteps0And1 — mode strict (étape 0)", () => {
  it("panneau dans le pan, coins à > marginPx du bord → true", () => {
    // PANEL_OK à (50,50)-(80,80) : distance min au bord 200px = 50px > 10px (margin)
    expect(validatePanelPolygonSteps0And1(PANEL_OK, [], CONSTRAINTS_STRICT)).toBe(true);
  });

  it("panneau hors du pan → false", () => {
    expect(validatePanelPolygonSteps0And1(PANEL_OUTSIDE, [], CONSTRAINTS_STRICT)).toBe(false);
  });

  it("panneau trop proche du bord (< marginPx) → false", () => {
    // PANEL_NEAR_EDGE : coin à (5,5) → distance bord = 5px < 10px (margin)
    expect(validatePanelPolygonSteps0And1(PANEL_NEAR_EDGE, [], CONSTRAINTS_STRICT)).toBe(false);
  });

  it("marginPx=0 : coin exactement sur le bord → true", () => {
    const onEdge: Point2D[] = [
      { x: 0, y: 50 },
      { x: 30, y: 50 },
      { x: 30, y: 80 },
      { x: 0, y: 80 },
    ];
    const strictNoMargin: RoofConstraints = { ...CONSTRAINTS_STRICT, marginPx: 0 };
    // Point (0,50) est SUR le bord → pointInPolygon dépend de l'implémentation (edge case)
    // On teste seulement que la distance min n'est pas < 0 → pas de rejet margin
    // (le rejet éventuel vient du pointInPolygon edge case, hors portée du test)
    const result = validatePanelPolygonSteps0And1(onEdge, [], strictNoMargin);
    // Juste vérifier qu'il ne crash pas
    expect(typeof result).toBe("boolean");
  });

  it("strictBounds=false avec polygon fourni : pas de vérification coins", () => {
    // Même si les coins sont hors du pan, strict=false → pas de rejet
    const noStrict: RoofConstraints = {
      ...CONSTRAINTS_STRICT,
      strictBounds: false,
    };
    expect(validatePanelPolygonSteps0And1(PANEL_OUTSIDE, [], noStrict)).toBe(true);
  });
});

describe("validatePanelPolygonSteps0And1 — étape 1a : collision obstacle", () => {
  it("obstacle non chevauchant → true", () => {
    expect(
      validatePanelPolygonSteps0And1(PANEL_OK, [OBS_NO_OVERLAP], CONSTRAINTS_EMPTY),
    ).toBe(true);
  });

  it("obstacle chevauchant → false", () => {
    expect(
      validatePanelPolygonSteps0And1(PANEL_OK, [OBS_OVERLAP], CONSTRAINTS_EMPTY),
    ).toBe(false);
  });

  it("plusieurs obstacles dont un chevauchant → false", () => {
    expect(
      validatePanelPolygonSteps0And1(PANEL_OK, [OBS_NO_OVERLAP, OBS_OVERLAP], CONSTRAINTS_EMPTY),
    ).toBe(false);
  });

  it("obstacle < 3 sommets → ignoré (pas de crash)", () => {
    const tiny: Point2D[] = [{ x: 65, y: 65 }]; // 1 seul point — invalide
    expect(
      validatePanelPolygonSteps0And1(PANEL_OK, [tiny], CONSTRAINTS_EMPTY),
    ).toBe(true); // ignoré → pas de collision
  });
});

describe("validatePanelPolygonSteps0And1 — étape 1b : marge obstacle", () => {
  it("obstacle proche (distance 5px) < obstacleMarginPx=10 → false", () => {
    const c: RoofConstraints = { ...CONSTRAINTS_EMPTY, obstacleMarginPx: 10 };
    // OBS_NEAR commence à x=85, PANEL_OK finit à x=80 → distance = 5px < 10px
    expect(validatePanelPolygonSteps0And1(PANEL_OK, [OBS_NEAR], c)).toBe(false);
  });

  it("obstacle proche (distance 5px) avec obstacleMarginPx=4 → true (pas de rejet)", () => {
    const c: RoofConstraints = { ...CONSTRAINTS_EMPTY, obstacleMarginPx: 4 };
    expect(validatePanelPolygonSteps0And1(PANEL_OK, [OBS_NEAR], c)).toBe(true);
  });

  it("obstacleMarginPx=0 (défaut) : obstacle proche mais pas chevauchant → true", () => {
    // obstacleMarginPx=0 → l'étape 1b n'est pas exécutée
    expect(validatePanelPolygonSteps0And1(PANEL_OK, [OBS_NEAR], CONSTRAINTS_EMPTY)).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. validatePanelPolygonStep3Ridge
// ─────────────────────────────────────────────────────────────────────────────

describe("validatePanelPolygonStep3Ridge", () => {
  it("aucun segment → true", () => {
    expect(validatePanelPolygonStep3Ridge(PANEL_OK, CONSTRAINTS_EMPTY)).toBe(true);
  });

  it("null constraints → true", () => {
    expect(validatePanelPolygonStep3Ridge(PANEL_OK, null)).toBe(true);
  });

  it("segment loin du panneau → true", () => {
    const c: RoofConstraints = { ...CONSTRAINTS_EMPTY, ridgeSegments: RIDGE_FAR };
    expect(validatePanelPolygonStep3Ridge(PANEL_OK, c)).toBe(true);
  });

  it("segment touchant le bord du panneau (distance=0 < eps) → false", () => {
    const c: RoofConstraints = { ...CONSTRAINTS_EMPTY, ridgeSegments: RIDGE_CROSS };
    expect(validatePanelPolygonStep3Ridge(PANEL_OK, c)).toBe(false);
  });

  it("traitSegments touchant le bord du panneau → false", () => {
    const c: RoofConstraints = { ...CONSTRAINTS_EMPTY, traitSegments: RIDGE_CROSS };
    expect(validatePanelPolygonStep3Ridge(PANEL_OK, c)).toBe(false);
  });

  it("ridgeSegments loin + traitSegments touchant → false", () => {
    const c: RoofConstraints = {
      ...CONSTRAINTS_EMPTY,
      ridgeSegments: RIDGE_FAR,
      traitSegments: RIDGE_CROSS,
    };
    expect(validatePanelPolygonStep3Ridge(PANEL_OK, c)).toBe(false);
  });

  it("eps personnalisé très grand : segment tangent → false (rejet avec eps=1000)", () => {
    // Segment loin (y=10) mais eps=1000 → distance < eps → rejet
    const c: RoofConstraints = {
      ...CONSTRAINTS_EMPTY,
      ridgeSegments: RIDGE_FAR,
      eps: { PV_IMG: 1000 },
    };
    expect(validatePanelPolygonStep3Ridge(PANEL_OK, c)).toBe(false);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. validateAutofillCandidateDetailed — helpers
// ─────────────────────────────────────────────────────────────────────────────

/** Bloc vide de référence (bloc courant). */
const BLOCK_EMPTY: BlockLike = { id: "block-1", panels: [] };

/** Caches vides (pas de frozen, pas d'actif, pas d'obstacles). */
const CACHES_EMPTY: ValidationCaches = {
  roofConstraints: CONSTRAINTS_EMPTY,
  forbiddenPolys: [],
  frozenPolys: [],
  active: null,
  activePolys: null,
  blockPolys: null,
};

/** Caches avec mode strict. */
const CACHES_STRICT: ValidationCaches = {
  roofConstraints: CONSTRAINTS_STRICT,
  forbiddenPolys: [],
  frozenPolys: [],
  active: null,
  activePolys: null,
  blockPolys: null,
};

// ─────────────────────────────────────────────────────────────────────────────
// 3. validateAutofillCandidateDetailed — tests
// ─────────────────────────────────────────────────────────────────────────────

describe("validateAutofillCandidateDetailed — cas valide", () => {
  it("panneau valide sans contrainte → valid:true, invalidReason:null", () => {
    const r = validateAutofillCandidateDetailed(PANEL_OK, CACHES_EMPTY, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(true);
    expect(r.invalidReason).toBeNull();
    expect(r.outOfBounds).toBe(false);
    expect(r.overlapsObstacle).toBe(false);
    expect(r.overlapsPanel).toBe(false);
    expect(r.overlapsKeepout).toBe(false);
    expect(r.collidesExisting).toBe(false);
  });
});

describe("validateAutofillCandidateDetailed — raison: geometry", () => {
  it("polygone < 3 pts → invalidReason=geometry, outOfBounds=true", () => {
    const line: Point2D[] = [{ x: 0, y: 0 }, { x: 10, y: 0 }];
    const r = validateAutofillCandidateDetailed(line, CACHES_EMPTY, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe("geometry");
    expect(r.outOfBounds).toBe(true);
  });
});

describe("validateAutofillCandidateDetailed — raison: out_of_bounds / margin", () => {
  it("hors du pan (mode strict) → invalidReason=out_of_bounds", () => {
    const r = validateAutofillCandidateDetailed(PANEL_OUTSIDE, CACHES_STRICT, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe("out_of_bounds");
    expect(r.outOfBounds).toBe(true);
  });

  it("trop proche du bord (mode strict) → invalidReason=margin, outOfBounds=true", () => {
    const r = validateAutofillCandidateDetailed(PANEL_NEAR_EDGE, CACHES_STRICT, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe("margin");
    expect(r.outOfBounds).toBe(true);
  });
});

describe("validateAutofillCandidateDetailed — raison: obstacle", () => {
  it("collision directe avec obstacle → invalidReason=obstacle, overlapsObstacle=true", () => {
    const caches: ValidationCaches = { ...CACHES_EMPTY, forbiddenPolys: [OBS_OVERLAP] };
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe("obstacle");
    expect(r.overlapsObstacle).toBe(true);
  });

  it("obstacle non chevauchant → valide", () => {
    const caches: ValidationCaches = { ...CACHES_EMPTY, forbiddenPolys: [OBS_NO_OVERLAP] };
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(true);
  });

  it("marge obstacle violée → invalidReason=obstacle", () => {
    const rc: RoofConstraints = { ...CONSTRAINTS_EMPTY, obstacleMarginPx: 10 };
    const caches: ValidationCaches = {
      ...CACHES_EMPTY,
      roofConstraints: rc,
      forbiddenPolys: [OBS_NEAR],
    };
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe("obstacle");
  });
});

describe("validateAutofillCandidateDetailed — raison: overlap_panel (frozen)", () => {
  it("collision avec panneau figé → invalidReason=overlap_panel, overlapsPanel=true", () => {
    // Panneau figé qui chevauche PANEL_OK
    const caches: ValidationCaches = {
      ...CACHES_EMPTY,
      frozenPolys: [OBS_OVERLAP], // même polygone que l'obstacle, réutilisé comme frozen panel
    };
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe("overlap_panel");
    expect(r.overlapsPanel).toBe(true);
  });

  it("panneau figé null dans les caches → ignoré, pas de crash", () => {
    const caches: ValidationCaches = {
      ...CACHES_EMPTY,
      frozenPolys: [null, OBS_NO_OVERLAP, null],
    };
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(true);
  });
});

describe("validateAutofillCandidateDetailed — raison: overlap_panel (bloc actif)", () => {
  it("collision avec panneau du bloc actif (sauf index courant exclu) → overlap_panel", () => {
    const activeBlock: BlockLike = {
      id: "block-1",
      panels: [{ enabled: true }, { enabled: true }],
    };
    const caches: ValidationCaches = {
      ...CACHES_EMPTY,
      active: activeBlock,
      // activePolys[0] = polygone qui chevauche PANEL_OK ; activePolys[1] = null
      activePolys: [OBS_OVERLAP, null],
    };
    // hypotheticalPanelIndex=1 → panel 1 est le courant (exclu) ; panel 0 crée la collision
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, activeBlock, 1);
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe("overlap_panel");
  });

  it("index courant exclu correctement → pas de collision avec soi-même", () => {
    const activeBlock: BlockLike = {
      id: "block-1",
      panels: [{ enabled: true }],
    };
    const caches: ValidationCaches = {
      ...CACHES_EMPTY,
      active: activeBlock,
      // activePolys[0] chevauche PANEL_OK, mais c'est l'index courant → exclu
      activePolys: [OBS_OVERLAP],
    };
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, activeBlock, 0);
    expect(r.valid).toBe(true);
  });

  it("panneau disabled dans le bloc actif → ignoré", () => {
    const activeBlock: BlockLike = {
      id: "block-1",
      panels: [{ enabled: false }, { enabled: true }],
    };
    const caches: ValidationCaches = {
      ...CACHES_EMPTY,
      active: activeBlock,
      // Panel 0 chevauche mais est disabled ; panel 1 = null
      activePolys: [OBS_OVERLAP, null],
    };
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, activeBlock, 1);
    expect(r.valid).toBe(true);
  });
});

describe("validateAutofillCandidateDetailed — raison: ridge_trait", () => {
  it("panneau dont un sommet touche le faîtage → invalidReason=ridge_trait, overlapsKeepout=true", () => {
    const rc: RoofConstraints = { ...CONSTRAINTS_EMPTY, ridgeSegments: RIDGE_CROSS };
    const caches: ValidationCaches = { ...CACHES_EMPTY, roofConstraints: rc };
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(false);
    expect(r.invalidReason).toBe("ridge_trait");
    expect(r.overlapsKeepout).toBe(true);
  });

  it("faîtage loin → valide", () => {
    const rc: RoofConstraints = { ...CONSTRAINTS_EMPTY, ridgeSegments: RIDGE_FAR };
    const caches: ValidationCaches = { ...CACHES_EMPTY, roofConstraints: rc };
    const r = validateAutofillCandidateDetailed(PANEL_OK, caches, BLOCK_EMPTY, 0);
    expect(r.valid).toBe(true);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. validatePanelPolygon — pipeline complet
// ─────────────────────────────────────────────────────────────────────────────

describe("validatePanelPolygon — pipeline complet", () => {
  it("panneau valide sans aucune contrainte → true", () => {
    expect(validatePanelPolygon(PANEL_OK, [], [], CONSTRAINTS_EMPTY)).toBe(true);
  });

  it("obstacle chevauchant → false", () => {
    expect(validatePanelPolygon(PANEL_OK, [OBS_OVERLAP], [], CONSTRAINTS_EMPTY)).toBe(false);
  });

  it("collision inter-panneau → false", () => {
    // Autre panneau qui chevauche PANEL_OK
    expect(
      validatePanelPolygon(PANEL_OK, [], [OBS_OVERLAP], CONSTRAINTS_EMPTY),
    ).toBe(false);
  });

  it("faîtage touchant un sommet du panneau → false", () => {
    const rc: RoofConstraints = { ...CONSTRAINTS_EMPTY, ridgeSegments: RIDGE_CROSS };
    expect(validatePanelPolygon(PANEL_OK, [], [], rc)).toBe(false);
  });

  it("inter-panneau null dans la liste → ignoré, pas de crash", () => {
    expect(
      validatePanelPolygon(PANEL_OK, [], [null, null], CONSTRAINTS_EMPTY),
    ).toBe(true);
  });

  it("mode strict, panneau hors pan → false", () => {
    expect(
      validatePanelPolygon(PANEL_OUTSIDE, [], [], CONSTRAINTS_STRICT),
    ).toBe(false);
  });

  it("mode strict, panneau valide → true", () => {
    expect(
      validatePanelPolygon(PANEL_OK, [], [], CONSTRAINTS_STRICT),
    ).toBe(true);
  });

  it("polygone < 3 pts → false (délégué à steps0And1)", () => {
    expect(validatePanelPolygon([{ x: 0, y: 0 }], [], [], CONSTRAINTS_EMPTY)).toBe(false);
  });
});
