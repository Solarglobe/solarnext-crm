/**
 * buildCellLinesGeometry — géométrie consolidée des lignes de cellules PV.
 *
 * Problème résolu : N panneaux × M segments = N draw calls (LineSegments individuels).
 * Solution : un seul BufferGeometry qui concatène toutes les positions de tous les panneaux.
 * Résultat : 1 draw call pour l'ensemble de la grille PV, quelle que soit la taille de l'installation.
 *
 * Algorithme (identique à premiumPvCellLineGeometryFromWorldPoints dans SolarScene3DViewer) :
 *   - Pour chaque panneau, interpolation bilinéaire sur les corners3D pour générer
 *     les segments de colonnes (verticaux dans le repère panneau) et de lignes (horizontaux).
 *   - Offset le long de outwardNormal pour éviter le z-fighting avec la surface du panneau.
 *   - Tous les segments concaténés dans un seul Float32Array → un seul setAttribute("position").
 *
 * Garanties anti-régression :
 *   1. Ne modifie pas PvPanelInstanced ni la logique de placement.
 *   2. Résultat géométriquement identique aux BufferGeometry individuels (même algorithme).
 *   3. Retourne null si aucun panneau valide (pas de <lineSegments> rendu inutilement).
 */

import * as THREE from "three";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";

/** Offset normal (m) pour éviter le z-fighting panneau/cell lines (identique à l'implémentation individuelle). */
const CELL_LINE_NORMAL_OFFSET_M = 0.018;

/**
 * Construit un seul BufferGeometry contenant les segments de grille de toutes les cellules PV
 * pour N panneaux. Le résultat peut être passé directement à un <lineSegments> R3F unique.
 *
 * @param panels - Surfaces PV 3D issues de buildPvPanels3D (non modifié).
 * @returns BufferGeometry consolidé (1 draw call) ou null si tous les panneaux sont invalides.
 */
export function buildConsolidatedCellLinesGeometry(
  panels: readonly PvPanelSurface3D[],
): THREE.BufferGeometry | null {
  if (panels.length === 0) return null;

  const allPositions: number[] = [];

  // Vecteurs temporaires réutilisés pour minimiser les allocations en boucle
  const _vA = new THREE.Vector3();
  const _vB = new THREE.Vector3();
  const _normal = new THREE.Vector3();
  for (const panel of panels) {
    const c = panel.corners3D;
    // Extraction des coins en THREE.Vector3 (corners3D est readonly WorldPosition3D[])
    const p0x = c[0]!.x, p0y = c[0]!.y, p0z = c[0]!.z;
    const p1x = c[1]!.x, p1y = c[1]!.y, p1z = c[1]!.z;
    const p2x = c[2]!.x, p2y = c[2]!.y, p2z = c[2]!.z;
    const p3x = c[3]!.x, p3y = c[3]!.y, p3z = c[3]!.z;

    // Normale sortante du panneau (identique à la logique du viewer)
    _vA.set(p1x - p0x, p1y - p0y, p1z - p0z);
    _vB.set(p3x - p0x, p3y - p0y, p3z - p0z);
    _normal.crossVectors(_vA, _vB).normalize();

    if (!Number.isFinite(_normal.x) || _normal.lengthSq() < 1e-8) continue;

    const nx = _normal.x, ny = _normal.y, nz = _normal.z;
    const off = CELL_LINE_NORMAL_OFFSET_M;

    // Dimensions pour le calcul de la densité de grille
    const wM = Math.sqrt((p1x-p0x)**2 + (p1y-p0y)**2 + (p1z-p0z)**2);
    const hM = Math.sqrt((p3x-p0x)**2 + (p3y-p0y)**2 + (p3z-p0z)**2);
    const cols = Math.max(4, Math.min(12, Math.round(wM / 0.18)));
    const rows = Math.max(4, Math.min(10, Math.round(hM / 0.18)));

    /**
     * Pousse un segment (a → b) dans allPositions avec offset normal appliqué.
     * Inline pour éviter toute allocation d'objet en boucle critique.
     */
    const push = (ax: number, ay: number, az: number, bx: number, by: number, bz: number) => {
      allPositions.push(
        ax + nx * off, ay + ny * off, az + nz * off,
        bx + nx * off, by + ny * off, bz + nz * off,
      );
    };

    /**
     * Interpolation bilinéaire entre deux coins : lerp(a, b, t) — inline.
     * Retourne [x, y, z].
     */
    const lx = (ax: number, bx: number, t: number) => ax + (bx - ax) * t;

    // Lignes de colonnes : segments p0→p3 interpolés le long de la largeur (p0→p1)
    for (let i = 1; i < cols; i++) {
      const t = i / cols;
      // a = lerp(p0, p3, t)   b = lerp(p1, p2, t)
      push(
        lx(p0x, p3x, t), lx(p0y, p3y, t), lx(p0z, p3z, t),
        lx(p1x, p2x, t), lx(p1y, p2y, t), lx(p1z, p2z, t),
      );
    }

    // Lignes de rangées : segments p0→p1 interpolés le long de la hauteur (p0→p3)
    for (let i = 1; i < rows; i++) {
      const t = i / rows;
      // a = lerp(p0, p1, t)   b = lerp(p3, p2, t)
      push(
        lx(p0x, p1x, t), lx(p0y, p1y, t), lx(p0z, p1z, t),
        lx(p3x, p2x, t), lx(p3y, p2y, t), lx(p3z, p2z, t),
      );
    }

    // Lignes de jonction inter-cellules (2 lignes selon l'axe dominant)
    for (let i = 1; i <= 2; i++) {
      const t = i / 3;
      if (wM >= hM) {
        // Panneau en paysage : jonctions horizontales supplémentaires
        push(
          lx(p0x, p1x, t), lx(p0y, p1y, t), lx(p0z, p1z, t),
          lx(p3x, p2x, t), lx(p3y, p2y, t), lx(p3z, p2z, t),
        );
      } else {
        // Panneau en portrait : jonctions verticales supplémentaires
        push(
          lx(p0x, p3x, t), lx(p0y, p3y, t), lx(p0z, p3z, t),
          lx(p1x, p2x, t), lx(p1y, p2y, t), lx(p1z, p2z, t),
        );
      }
    }
  }

  if (allPositions.length === 0) return null;

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(allPositions, 3));
  return geo;
}
