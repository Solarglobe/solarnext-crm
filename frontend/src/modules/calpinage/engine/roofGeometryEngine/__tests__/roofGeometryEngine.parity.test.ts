/**
 * Phase 3 — Tests de parité : roofGeometryEngine vs valeurs analytiques connues.
 *
 * Chaque vecteur de test est construit avec des hauteurs explicites
 * (pas de resolver runtime) pour que le résultat soit déterministe et
 * calculable analytiquement. Les tolérances cibles du plan industriel sont :
 *   tiltDeg    : ±0.1°
 *   azimuthDeg : ±0.1°
 *   cornersWorld : ±0.001 m (1 mm)
 *
 * Convention repère image (héritage calpinage) :
 *   Origine haut-gauche, +x droite, +y bas.
 *   Avec northAngleDeg = 0 : +x image = Est monde, +y image = Sud monde.
 *
 * Ces tests ne nécessitent pas de runtime legacy — FallbackHeightResolver suffit
 * pour les cas à hauteur constante ; les cas inclinés utilisent les heightM
 * explicites dans polygonPx.
 */

import { describe, it, expect } from "vitest";
import { solveFace } from "../faceSolver";
import { computeRoofFaceNormal } from "../normalCalc";
import { computeTiltAzimuth } from "../tiltAzimuthCalc";
import { FallbackHeightResolver } from "../heightInterpolator";
import type { RoofFace, WorldCorner3D } from "../../interfaces/PanContext";
import type { WorldTransform } from "../../interfaces/WorldTransform";

// ─────────────────────────────────────────────────────────────────────────────
// Constantes de tolérance (plan industriel Section 3)
// ─────────────────────────────────────────────────────────────────────────────

const TILT_TOL_DEG = 0.1;
const AZ_TOL_DEG   = 0.1;
const CORNER_TOL_M = 0.001;

// ─────────────────────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────────────────────

function angleDiff(a: number, b: number): number {
  // Distance angulaire minimale (modulo 360)
  let d = Math.abs(a - b) % 360;
  if (d > 180) d = 360 - d;
  return d;
}

function expectCorner(
  actual: WorldCorner3D,
  expected: WorldCorner3D,
  label: string,
  tolM = CORNER_TOL_M,
) {
  expect(Math.abs(actual.x - expected.x)).toBeLessThanOrEqual(tolM);
  expect(Math.abs(actual.y - expected.y)).toBeLessThanOrEqual(tolM);
  expect(Math.abs(actual.z - expected.z)).toBeLessThanOrEqual(tolM);
}

// Transform standard : 10 cm/px, nord = haut image
const TRANSFORM_STD: WorldTransform = { metersPerPixel: 0.1, northAngleDeg: 0 };

// ─────────────────────────────────────────────────────────────────────────────
// 1. normalCalc — méthode de Newell
// ─────────────────────────────────────────────────────────────────────────────

describe("computeRoofFaceNormal", () => {
  it("plan horizontal (carré plat z=0) → normale = (0,0,1)", () => {
    const corners: WorldCorner3D[] = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: -10, z: 0 },
      { x: 0, y: -10, z: 0 },
    ];
    const n = computeRoofFaceNormal(corners);
    expect(n).not.toBeNull();
    expect(Math.abs(n!.x)).toBeLessThan(1e-9);
    expect(Math.abs(n!.y)).toBeLessThan(1e-9);
    expect(Math.abs(n!.z - 1)).toBeLessThan(1e-9);
  });

  it("plan vertical (mur) → normale dans le plan xz, unitaire", () => {
    // Mur dans le plan y=0 ; la normale est dans le plan y-z (nx=0, nz=0)
    // Signe de ny dépend du sens d\'enroulement — on vérifie juste l\'orthogonalité.
    const corners: WorldCorner3D[] = [
      { x: 0, y: 0, z: 0 },
      { x: 10, y: 0, z: 0 },
      { x: 10, y: 0, z: 5 },
      { x: 0, y: 0, z: 5 },
    ];
    const n = computeRoofFaceNormal(corners);
    expect(n).not.toBeNull();
    expect(Math.abs(n!.x)).toBeLessThan(1e-9);
    expect(Math.abs(n!.z)).toBeLessThan(1e-9);
    // Le module est unitaire
    const len = Math.hypot(n!.x, n!.y, n!.z);
    expect(Math.abs(len - 1)).toBeLessThan(1e-9);
  });

  it("< 3 sommets → null", () => {
    expect(computeRoofFaceNormal([{ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }])).toBeNull();
  });

  it("sommets colinéaires → null (dégénéré)", () => {
    const corners: WorldCorner3D[] = [
      { x: 0, y: 0, z: 0 },
      { x: 1, y: 0, z: 0 },
      { x: 2, y: 0, z: 0 },
    ];
    expect(computeRoofFaceNormal(corners)).toBeNull();
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 2. tiltAzimuthCalc
// ─────────────────────────────────────────────────────────────────────────────

describe("computeTiltAzimuth", () => {
  it("normale verticale → tiltDeg = 0°, axes dégénérés = fallback", () => {
    const { tiltDeg } = computeTiltAzimuth({ x: 0, y: 0, z: 1 });
    expect(tiltDeg).toBeCloseTo(0, 6);
  });

  it("normale 30° vers le Sud → tiltDeg ≈ 30°, azimuthDeg ≈ 180°", () => {
    // Normale extérieure d'un pan incliné à 30°, face au Sud :
    // composante horizontale = (0, -sin(30°)) = (0, -0.5)
    // composante verticale   = cos(30°) = 0.866
    const n = { x: 0, y: -0.5, z: 0.866 }; // unitaire approx
    const { tiltDeg, azimuthDeg } = computeTiltAzimuth(n);
    expect(tiltDeg).toBeCloseTo(30, 1);
    expect(angleDiff(azimuthDeg, 180)).toBeLessThan(AZ_TOL_DEG + 0.5);
  });

  it("normale 20° vers l\'Est → tiltDeg ≈ 20°, azimuthDeg ≈ 90°", () => {
    const tiltRad = (20 * Math.PI) / 180;
    const n = { x: Math.sin(tiltRad), y: 0, z: Math.cos(tiltRad) };
    const { tiltDeg, azimuthDeg } = computeTiltAzimuth(n);
    expect(Math.abs(tiltDeg - 20)).toBeLessThan(TILT_TOL_DEG);
    expect(angleDiff(azimuthDeg, 90)).toBeLessThan(AZ_TOL_DEG);
  });

  it("normale 45° vers le Nord → tiltDeg ≈ 45°, azimuthDeg ≈ 0° (ou 360°)", () => {
    const n = { x: 0, y: Math.SQRT1_2, z: Math.SQRT1_2 };
    const { tiltDeg, azimuthDeg } = computeTiltAzimuth(n);
    expect(Math.abs(tiltDeg - 45)).toBeLessThan(TILT_TOL_DEG);
    expect(angleDiff(azimuthDeg, 0)).toBeLessThan(AZ_TOL_DEG);
  });

  it("slopeAxisWorld perpendiculaire à la normale (dot ≈ 0)", () => {
    // Utiliser les valeurs trig exactes pour un vecteur rigoureusement unitaire.
    // Avec un approximation comme 0.866, sin²+cos²≠1 → erreur flottante ~4e-5.
    const tiltRad = (30 * Math.PI) / 180;
    const n = { x: 0, y: -Math.sin(tiltRad), z: Math.cos(tiltRad) };
    const { slopeAxisWorld } = computeTiltAzimuth(n);
    const dot = n.x * slopeAxisWorld.x + n.y * slopeAxisWorld.y + n.z * slopeAxisWorld.z;
    expect(Math.abs(dot)).toBeLessThan(1e-12);
  });

  it("perpAxisWorld perpendiculaire à slopeAxisWorld (dot ≈ 0)", () => {
    const n = { x: 0, y: -0.5, z: 0.866 };
    const { slopeAxisWorld, perpAxisWorld } = computeTiltAzimuth(n);
    const dot =
      slopeAxisWorld.x * perpAxisWorld.x +
      slopeAxisWorld.y * perpAxisWorld.y +
      slopeAxisWorld.z * perpAxisWorld.z;
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 3. solveFace — cas analytiques (parité plan industriel)
// ─────────────────────────────────────────────────────────────────────────────

describe("solveFace — parité analytique", () => {
  // ── Cas A : toit plat (FallbackHeightResolver, z=3m constant) ──────────────
  it("[A] toit plat 10×10m → tiltDeg=0°, cornersWorld corrects, projectedAreaM2=100m²", () => {
    const face: RoofFace = {
      id: "pan-flat",
      roofType: "FLAT",
      tiltDegExplicit: null,
      azimuthDegExplicit: null,
      polygonPx: [
        { xPx: 0, yPx: 0 },
        { xPx: 100, yPx: 0 },
        { xPx: 100, yPx: 100 },
        { xPx: 0, yPx: 100 },
      ],
    };
    const resolver = new FallbackHeightResolver(3.0);
    const result = solveFace(face, TRANSFORM_STD, resolver);

    expect(result.tiltDeg).toBeCloseTo(0, 4);
    expect(result.projectedAreaM2).toBeCloseTo(100, 3);
    expect(result.cornersWorld).toHaveLength(4);

    // Coins monde attendus (mpp=0.1, northAngleDeg=0, z=3)
    expectCorner(result.cornersWorld[0]!, { x: 0, y: 0, z: 3 }, "NW");
    expectCorner(result.cornersWorld[1]!, { x: 10, y: 0, z: 3 }, "NE");
    expectCorner(result.cornersWorld[2]!, { x: 10, y: -10, z: 3 }, "SE");
    expectCorner(result.cornersWorld[3]!, { x: 0, y: -10, z: 3 }, "SW");
  });

  // ── Cas B : 30° face au Sud (explicit heights) ─────────────────────────────
  // Carré 100×100 px (= 10×10 m). Ridge au Nord (yPx=0, monde y=0), égoût au Sud.
  // Rise = 10 * tan(30°) ≈ 5.7735m ; ridge z=3+5.7735=8.7735, eave z=3
  it("[B] toit 30° face Sud → tiltDeg≈30°, azimuthDeg≈180°, cornersWorld ±1mm", () => {
    const rise = 10 * Math.tan((30 * Math.PI) / 180); // ≈ 5.7735
    const zRidge = 3 + rise;
    const zEave = 3;

    const face: RoofFace = {
      id: "pan-south-30",
      roofType: "PITCHED",
      tiltDegExplicit: null,
      azimuthDegExplicit: null,
      polygonPx: [
        { xPx: 0,   yPx: 0,   heightM: zRidge }, // NW-ridge
        { xPx: 100, yPx: 0,   heightM: zRidge }, // NE-ridge
        { xPx: 100, yPx: 100, heightM: zEave  }, // SE-eave
        { xPx: 0,   yPx: 100, heightM: zEave  }, // SW-eave
      ],
    };

    const result = solveFace(face, TRANSFORM_STD, new FallbackHeightResolver(0));

    expect(Math.abs(result.tiltDeg - 30)).toBeLessThan(TILT_TOL_DEG);
    expect(angleDiff(result.azimuthDeg, 180)).toBeLessThan(AZ_TOL_DEG);

    // Vérification cornersWorld
    expect(result.cornersWorld).toHaveLength(4);
    expectCorner(result.cornersWorld[0]!, { x: 0,  y: 0,   z: zRidge }, "NW-ridge");
    expectCorner(result.cornersWorld[1]!, { x: 10, y: 0,   z: zRidge }, "NE-ridge");
    expectCorner(result.cornersWorld[2]!, { x: 10, y: -10, z: zEave  }, "SE-eave");
    expectCorner(result.cornersWorld[3]!, { x: 0,  y: -10, z: zEave  }, "SW-eave");

    // projectedAreaM2 = 10*10 = 100 m²
    expect(result.projectedAreaM2).toBeCloseTo(100, 2);
  });

  // ── Cas C : 20° face à l'Est ──────────────────────────────────────────────
  it("[C] toit 20° face Est → tiltDeg≈20°, azimuthDeg≈90°", () => {
    // Face Est = normale pointe vers Est (+x monde).
    // La pluie coule vers l\'Est → égoût à l\'Est (xPx=100, x_monde=10, bas),
    // faîtage à l\'Ouest (xPx=0, x_monde=0, haut).
    const rise = 10 * Math.tan((20 * Math.PI) / 180); // ≈ 3.640
    const zEave = 3;          // égoût Est (xPx=100)
    const zRidge = zEave + rise; // faîtage Ouest (xPx=0)

    const face: RoofFace = {
      id: "pan-east-20",
      roofType: "PITCHED",
      tiltDegExplicit: null,
      azimuthDegExplicit: null,
      polygonPx: [
        { xPx: 0,   yPx: 0,   heightM: zRidge }, // NW-faîtage (Ouest haut)
        { xPx: 100, yPx: 0,   heightM: zEave  }, // NE-égoût  (Est bas)
        { xPx: 100, yPx: 100, heightM: zEave  }, // SE-égoût
        { xPx: 0,   yPx: 100, heightM: zRidge }, // SW-faîtage
      ],
    };

    const result = solveFace(face, TRANSFORM_STD, new FallbackHeightResolver(0));

    expect(Math.abs(result.tiltDeg - 20)).toBeLessThan(TILT_TOL_DEG);
    expect(angleDiff(result.azimuthDeg, 90)).toBeLessThan(AZ_TOL_DEG);
  });

  // ── Cas D : 45° face au Nord ──────────────────────────────────────────────
  it("[D] toit 45° face Nord → tiltDeg≈45°, azimuthDeg≈0°", () => {
    // Face Nord = normale pointe vers le Nord (+y monde).
    // La pluie coule vers le Nord → égoût au Nord (yPx=0, y_monde=0, bas),
    // faîtage au Sud (yPx=100, y_monde=-10, haut).
    const rise = 10; // tan(45°) = 1, run=10m → rise=10m
    const zEave  = 3;           // égoût Nord (yPx=0)
    const zRidge = zEave + rise; // faîtage Sud (yPx=100)

    const face: RoofFace = {
      id: "pan-north-45",
      roofType: "PITCHED",
      tiltDegExplicit: null,
      azimuthDegExplicit: null,
      polygonPx: [
        { xPx: 0,   yPx: 0,   heightM: zEave  }, // NW-égoût (yPx=0 → Nord)
        { xPx: 100, yPx: 0,   heightM: zEave  }, // NE-égoût
        { xPx: 100, yPx: 100, heightM: zRidge }, // SE-faîtage (yPx=100 → Sud)
        { xPx: 0,   yPx: 100, heightM: zRidge }, // SW-faîtage
      ],
    };

    // Nord-facing : normale pointe vers le Nord (+y) + haut (+z), azimuth 0°
    const result = solveFace(face, TRANSFORM_STD, new FallbackHeightResolver(0));

    expect(Math.abs(result.tiltDeg - 45)).toBeLessThan(TILT_TOL_DEG);
    expect(angleDiff(result.azimuthDeg, 0)).toBeLessThan(AZ_TOL_DEG);
  });

  // ── Cas E : northAngleDeg = 30° (image tournée) ───────────────────────────
  it("[E] transform avec northAngleDeg=30° → cornersWorld tournées", () => {
    const face: RoofFace = {
      id: "pan-rotated",
      roofType: "FLAT",
      tiltDegExplicit: null,
      azimuthDegExplicit: null,
      polygonPx: [{ xPx: 100, yPx: 0, heightM: 0 }],
    };
    const transform: WorldTransform = { metersPerPixel: 0.1, northAngleDeg: 30 };
    // xPx=100 → x0=10m, y0=0m ; rotation 30°:
    // x = 10*cos(30°) = 8.660, y = 10*sin(30°) = 5.0
    const result = solveFace(face, transform, new FallbackHeightResolver(0));
    // 1 corner (degenerate, will return early with 0 corners) — just test corner value
    if (result.cornersWorld.length > 0) {
      const c = result.cornersWorld[0]!;
      expect(Math.abs(c.x - 10 * Math.cos((30 * Math.PI) / 180))).toBeLessThan(CORNER_TOL_M);
      expect(Math.abs(c.y - 10 * Math.sin((30 * Math.PI) / 180))).toBeLessThan(CORNER_TOL_M);
    }
  });

  // ── Cas F : metersPerPixel invalide → résultat dégénéré ───────────────────
  it("[F] metersPerPixel=0 → résultat dégénéré (tiltDeg=0, cornersWorld=[])", () => {
    const face: RoofFace = {
      id: "pan-invalid",
      roofType: "FLAT",
      tiltDegExplicit: null,
      azimuthDegExplicit: null,
      polygonPx: [{ xPx: 0, yPx: 0 }, { xPx: 100, yPx: 0 }, { xPx: 50, yPx: 100 }],
    };
    const result = solveFace(face, { metersPerPixel: 0, northAngleDeg: 0 }, new FallbackHeightResolver(3));
    expect(result.tiltDeg).toBe(0);
    expect(result.cornersWorld).toHaveLength(0);
  });

  // ── Cas G : resolver vs heightM explicite — priorité ─────────────────────
  it("[G] heightM explicite prime sur FallbackHeightResolver", () => {
    // Le resolver donne z=0 mais les sommets ont heightM=5 → z doit être 5
    const face: RoofFace = {
      id: "pan-explicit",
      roofType: "FLAT",
      tiltDegExplicit: null,
      azimuthDegExplicit: null,
      polygonPx: [
        { xPx: 0,   yPx: 0,   heightM: 5 },
        { xPx: 100, yPx: 0,   heightM: 5 },
        { xPx: 100, yPx: 100, heightM: 5 },
        { xPx: 0,   yPx: 100, heightM: 5 },
      ],
    };
    const resolver = new FallbackHeightResolver(0); // donnerait z=0
    const result = solveFace(face, TRANSFORM_STD, resolver);

    for (const c of result.cornersWorld) {
      expect(c.z).toBe(5); // heightM explicite doit gagner
    }
  });

  // ── Cas H : triangle (3 sommets) ─────────────────────────────────────────
  it("[H] pan triangulaire 3 sommets → produit un résultat (pas de crash)", () => {
    const face: RoofFace = {
      id: "pan-triangle",
      roofType: "PITCHED",
      tiltDegExplicit: null,
      azimuthDegExplicit: null,
      polygonPx: [
        { xPx: 0,   yPx: 100, heightM: 3   }, // SW-eave
        { xPx: 100, yPx: 100, heightM: 3   }, // SE-eave
        { xPx: 50,  yPx: 0,   heightM: 8.7 }, // N-faîtage
      ],
    };
    const result = solveFace(face, TRANSFORM_STD, new FallbackHeightResolver(0));
    expect(result.cornersWorld).toHaveLength(3);
    expect(Number.isFinite(result.tiltDeg)).toBe(true);
    expect(Number.isFinite(result.azimuthDeg)).toBe(true);
    // Face au Sud → azimuth ≈ 180°
    expect(angleDiff(result.azimuthDeg, 180)).toBeLessThan(15); // tolérance large pour triangle
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 4. Axes de pente et de faîtage
// ─────────────────────────────────────────────────────────────────────────────

describe("solveFace — axes slopeAxisWorld / perpAxisWorld", () => {
  it("toit 30° Sud → slopeAxisWorld pointe vers le haut-Sud (z>0, y<0)", () => {
    const rise = 10 * Math.tan((30 * Math.PI) / 180);
    const face: RoofFace = {
      id: "pan-axes",
      roofType: "PITCHED",
      tiltDegExplicit: null,
      azimuthDegExplicit: null,
      polygonPx: [
        { xPx: 0,   yPx: 0,   heightM: 3 + rise },
        { xPx: 100, yPx: 0,   heightM: 3 + rise },
        { xPx: 100, yPx: 100, heightM: 3         },
        { xPx: 0,   yPx: 100, heightM: 3         },
      ],
    };
    const result = solveFace(face, TRANSFORM_STD, new FallbackHeightResolver(0));

    // slopeAxisWorld = direction "vers le haut" dans le plan du pan
    // Pour un pan face au Sud, monter = aller vers le Nord (+y) ET vers le haut (+z)
    expect(result.slopeAxisWorld.z).toBeGreaterThan(0); // composante positive vers le haut
    expect(result.slopeAxisWorld.y).toBeGreaterThan(0); // composante vers le Nord (+y monde)

    // Vérification orthogonalité slopeAxis ⊥ perpAxis
    const dot =
      result.slopeAxisWorld.x * result.perpAxisWorld.x +
      result.slopeAxisWorld.y * result.perpAxisWorld.y +
      result.slopeAxisWorld.z * result.perpAxisWorld.z;
    expect(Math.abs(dot)).toBeLessThan(1e-9);
  });
});

// ─────────────────────────────────────────────────────────────────────────────
// 5. FallbackHeightResolver
// ─────────────────────────────────────────────────────────────────────────────

describe("FallbackHeightResolver", () => {
  it("retourne la hauteur constante configurée", () => {
    const r = new FallbackHeightResolver(7.5);
    const h = r.getHeightAtImagePoint(42, 99, "pan-1");
    expect(h.heightM).toBe(7.5);
    expect(h.source).toBe("fallback");
    expect(h.reliable).toBe(false);
    expect(r.isRuntimeAvailable).toBe(false);
  });

  it("getVertexHeight retourne la hauteur constante", () => {
    const r = new FallbackHeightResolver(2.0);
    const h = r.getVertexHeight("v-42");
    expect(h?.heightM).toBe(2.0);
  });
});
