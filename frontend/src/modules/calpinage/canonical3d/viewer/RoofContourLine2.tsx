/**
 * RoofContourLine2 — lignes de contour toit avec LineMaterial (épaisseur réelle retina).
 *
 * Remplace `<lineSegments> + <lineBasicMaterial>` pour les arêtes (roofEdgesLineGeometry)
 * et les faîtières (roofRidgesLineGeometry) du toit.
 *
 * Pourquoi Line2 ?
 *   THREE.LineSegments + LineBasicMaterial = 1 px WebGL fixe, invisible sur écrans retina.
 *   LineSegments2 + LineMaterial = largeur en pixels écran (worldUnits: false), visible à 2 px.
 *
 * Contraintes :
 *   - Ne modifie pas les fonctions de géométrie sources (solarSceneThreeGeometry.ts).
 *   - dispose() GPU appelé à l'unmount (LineSegmentsGeometry + LineMaterial).
 *   - resolution LineMaterial synchronisée sur resize via useThree().
 *   - onPointerDown optionnel pass-through pour l'édition de faîtière (ridge height edit).
 *
 * Format d'entrée : BufferGeometry produite par roofEdgesLineGeometry / roofRidgesLineGeometry.
 * Ces fonctions stockent les positions comme des paires de sommets (format LineSegments) :
 *   [x0,y0,z0, x1,y1,z1, x2,y2,z2, x3,y3,z3, …]  → segments (v0-v1), (v2-v3), …
 * C'est exactement le format attendu par LineSegmentsGeometry.setPositions().
 */

import { type ThreeEvent, useThree } from "@react-three/fiber";
import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

// ── types ─────────────────────────────────────────────────────────────────────

interface RoofContourLine2Props {
  /**
   * BufferGeometry source produite par roofEdgesLineGeometry / roofRidgesLineGeometry.
   * Doit avoir un attribut `position` (Float32Array, format paires de sommets).
   */
  readonly sourceGeo: THREE.BufferGeometry;
  /** Couleur CSS / hex string. */
  readonly color: string;
  /** Opacité [0,1]. Default: 1. */
  readonly opacity?: number;
  /**
   * Épaisseur en pixels écran (worldUnits: false).
   * Default: 2 — visible sur retina sans trop dominer le mesh toit.
   */
  readonly linewidth?: number;
  /**
   * Handler pointerdown optionnel — pass-through pour le ridge height editor.
   * R3F rattache le handler au LineSegments2 via son système de raycasting.
   */
  readonly onPointerDown?: (e: ThreeEvent<PointerEvent>) => void;
}

// ── composant ─────────────────────────────────────────────────────────────────

/**
 * Rendu d'une ligne de contour toit avec LineMaterial (largeur écran réelle).
 * Doit être rendu à l'intérieur d'une scène R3F (Canvas).
 */
export function RoofContourLine2({
  sourceGeo,
  color,
  opacity = 1,
  linewidth = 2,
  onPointerDown,
}: RoofContourLine2Props): React.ReactElement | null {
  const { size } = useThree();

  // ── Géométrie LineSegments2 ──────────────────────────────────────────────

  const lsg = useMemo(() => {
    const attr = sourceGeo.attributes.position as THREE.BufferAttribute | undefined;
    if (!attr) return null;
    const g = new LineSegmentsGeometry();
    // setPositions attend un tableau plat [x0,y0,z0, x1,y1,z1, …] — même format que notre BufferAttribute.
    g.setPositions(attr.array as Float32Array);
    return g;
  }, [sourceGeo]);

  // ── Matériau LineMaterial ────────────────────────────────────────────────

  const mat = useMemo(
    () =>
      new LineMaterial({
        color,
        linewidth,
        worldUnits: false,     // largeur en pixels écran (pas en unités monde)
        transparent: opacity < 1,
        opacity,
        toneMapped: false,
        resolution: new THREE.Vector2(1, 1), // résolution définie via effet ci-dessous
      }),
    // size intentionnellement exclu : géré par l'effet de resize (évite de recréer le mat à chaque resize)
    [color, linewidth, opacity], // eslint-disable-line react-hooks/exhaustive-deps
  );

  // Met à jour la résolution après le montage et après chaque resize
  useEffect(() => {
    mat.resolution.set(size.width, size.height);
    mat.needsUpdate = true;
  }, [mat, size.width, size.height]);

  // ── Object3D LineSegments2 ───────────────────────────────────────────────

  const ls2 = useMemo(
    () => (lsg ? new LineSegments2(lsg, mat) : null),
    [lsg, mat],
  );

  // ── Dispose GPU à l'unmount ou au changement de dépendances ─────────────

  useEffect(() => {
    return () => {
      lsg?.dispose();
      mat.dispose();
      // ls2 lui-même est un Object3D sans ressource GPU propre (géo + mat déjà disposés ci-dessus)
    };
  }, [lsg, mat]);

  if (!ls2) return null;

  return <primitive object={ls2} onPointerDown={onPointerDown} />;
}
