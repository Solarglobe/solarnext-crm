/**
 * Phase 3 — Résolveur de hauteurs par contraintes structurelles (ridges, traits).
 *
 * Construit un HeightResolver depuis un ensemble de lignes structurantes (faîtages,
 * ruptures de pentes) et de pans, en mode "hors runtime" — utilisé pour les calculs
 * depuis validatedRoofData persisté, sans accès à window.*.
 *
 * Délègue à canonical3d/builder/heightConstraints.ts (implémentation authoritative).
 * Aucune référence à window.* ni à calpinageRuntime.
 *
 * Hiérarchie de résolution Z (documentée dans heightConstraints.ts) :
 *   1. Sommet explicite (vertex.heightM dans face.polygonPx)     ← géré par faceSolver
 *   2. Endpoint ridge (snap px)
 *   3. Endpoint trait (snap px)
 *   4. Interpolé le long d'un ridge
 *   5. Interpolé le long d'un trait
 *   6. Moyenne explicite du pan courant
 *   7. Moyenne globale / defaultHeightM
 */

import type { HeightResolution, HeightResolver } from "../interfaces/HeightResolver";
import type { RoofFace } from "../interfaces/PanContext";
import {
  buildHeightConstraintBundle,
  computePanExplicitMeanM,
  resolveZForPanCorner,
  type HeightConstraintBundle,
} from "../../canonical3d/builder/heightConstraints";
import type { LegacyRoofGeometryInput, LegacyStructuralLine2D } from "../../canonical3d/builder/legacyInput";

// ─────────────────────────────────────────────────────────────────────────────
// Type neutre Phase 3
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Ligne structurante (faîtage ou rupture de pente) pour le résolveur de contraintes.
 * Structuralement compatible avec LegacyStructuralLine2D.
 */
export interface StructuralConstraintLine {
  readonly id: string;
  readonly kind: "ridge" | "trait";
  readonly a: { readonly xPx: number; readonly yPx: number; readonly heightM?: number };
  readonly b: { readonly xPx: number; readonly yPx: number; readonly heightM?: number };
}

// ─────────────────────────────────────────────────────────────────────────────
// ConstraintHeightResolver
// ─────────────────────────────────────────────────────────────────────────────

function toStructuralLine2D(l: StructuralConstraintLine): LegacyStructuralLine2D {
  return { id: l.id, kind: l.kind, a: l.a, b: l.b };
}

/**
 * HeightResolver branché sur les contraintes de lignes structurantes.
 * Utilisé pour les calculs depuis validatedRoofData sans accès au runtime legacy.
 */
export class ConstraintHeightResolver implements HeightResolver {
  readonly isRuntimeAvailable = false;

  private readonly _bundle: HeightConstraintBundle;
  private readonly _panExplicitMeans: Map<string, number | null>;
  private readonly _defaultHeightM: number;

  constructor(
    faces: readonly RoofFace[],
    lines: readonly StructuralConstraintLine[],
    defaultHeightM = 3.0,
  ) {
    this._defaultHeightM = defaultHeightM;

    // Construire l\'entrée legacy minimale (mpp et northAngle non utilisés par heightConstraints)
    const legacyInput: LegacyRoofGeometryInput = {
      metersPerPixel: 1,
      northAngleDeg: 0,
      defaultHeightM,
      pans: faces.map((f) => ({
        id: f.id,
        polygonPx: f.polygonPx.map((v) => ({ xPx: v.xPx, yPx: v.yPx, heightM: v.heightM })),
      })),
    };

    const allLines = lines.map(toStructuralLine2D);
    const ridges = allLines.filter((l) => l.kind === "ridge");
    const traits = allLines.filter((l) => l.kind === "trait");

    this._bundle = buildHeightConstraintBundle(legacyInput, ridges, traits);

    // Pré-calculer les moyennes explicites par pan (pour le tier "pan_local_mean")
    this._panExplicitMeans = new Map(
      faces.map((f) => [
        f.id,
        computePanExplicitMeanM(
          f.polygonPx.map((v) => ({ xPx: v.xPx, yPx: v.yPx, heightM: v.heightM })),
        ),
      ]),
    );
  }

  getHeightAtImagePoint(xPx: number, yPx: number, panId?: string): HeightResolution {
    // Les hauteurs explicites des sommets sont gérées par faceSolver (avant appel resolver).
    // Ici on résout les cas 2-7 de la hiérarchie (ridges, traits, moyennes).
    const panMean = panId != null ? (this._panExplicitMeans.get(panId) ?? null) : null;
    const { z, trace } = resolveZForPanCorner(
      xPx,
      yPx,
      undefined, // explicitHeightM : géré par faceSolver, pas ici
      this._bundle,
      panMean,
      this._defaultHeightM,
    );
    const reliable = trace.tier !== "low";
    return { heightM: z, source: reliable ? "runtime" : "fallback", reliable };
  }

  getVertexHeight(_vertexId: string): HeightResolution | null {
    return null;
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Factory publique
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Construit un HeightResolver depuis les lignes structurantes de la toiture.
 *
 * @param faces         — tous les pans de la toiture (pour les moyennes Z explicites)
 * @param lines         — lignes structurantes (faîtages "ridge" + traits "trait")
 * @param defaultHeightM — hauteur de fallback global (m) si aucune contrainte disponible
 */
export function buildConstraintHeightResolver(
  faces: readonly RoofFace[],
  lines: readonly StructuralConstraintLine[],
  defaultHeightM = 3.0,
): HeightResolver {
  return new ConstraintHeightResolver(faces, lines, defaultHeightM);
}
