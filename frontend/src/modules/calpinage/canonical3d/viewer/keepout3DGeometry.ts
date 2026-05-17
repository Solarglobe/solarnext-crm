/**
 * Géométries 3D pour les zones keepout (visualRole === "keepout_surface").
 *
 * Deux fonctions exportées, câblées dans roofObstacleDetailGeometries() de SolarScene3DViewer.tsx :
 *   - keepoutHatchGeometry      : hachures diagonales 45° clipées au contour du volume.
 *   - keepoutCornerMarksGeometry: marqueurs en L aux coins du contour supérieur.
 *
 * Séparé de SolarScene3DViewer pour limiter la taille du viewer monolithique.
 */

import * as THREE from "three";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";

type Vol = RoofObstacleVolume3D;

// ── helpers locaux ────────────────────────────────────────────────────────────

/** Anneau supérieur du volume (t=1) avec un léger lift Z en mètres. */
function topRing(vol: Vol, lift: number): THREE.Vector3[] {
  const n = vol.footprintWorld.length;
  if (n < 3 || vol.vertices.length < n * 2) return [];
  return Array.from({ length: n }, (_, i) => {
    const top = vol.vertices[i + n]!.position;
    return new THREE.Vector3(top.x, top.y, top.z + lift);
  });
}

/** Aire signée 2D (positive = CCW dans le plan XY). */
function signedArea2D(pts: readonly THREE.Vector3[]): number {
  let area = 0;
  const n = pts.length;
  for (let i = 0; i < n; i++) {
    const a = pts[i]!;
    const b = pts[(i + 1) % n]!;
    area += a.x * b.y - b.x * a.y;
  }
  return area / 2;
}

/**
 * Algorithme de Cyrus-Beck : clip d'un segment 2D sur un polygone convexe CCW.
 * Retourne [t_enter, t_exit] ∈ [0,1] ou null si entièrement en dehors.
 */
function clipSegToCCWPoly(
  ax: number, ay: number,
  bx: number, by: number,
  poly: readonly THREE.Vector3[],
): [number, number] | null {
  let t0 = 0;
  let t1 = 1;
  const dx = bx - ax;
  const dy = by - ay;
  const n = poly.length;
  for (let i = 0; i < n; i++) {
    const px = poly[i]!.x;
    const py = poly[i]!.y;
    const qx = poly[(i + 1) % n]!.x;
    const qy = poly[(i + 1) % n]!.y;
    // Normale intérieure (CCW) : (-(qy-py), qx-px)
    const nx = -(qy - py);
    const ny = qx - px;
    const num = nx * (ax - px) + ny * (ay - py);
    const den = nx * dx + ny * dy;
    if (Math.abs(den) < 1e-9) {
      if (num < 0) return null; // parallèle et à l'extérieur
    } else {
      const t = -num / den;
      if (den > 0) t0 = Math.max(t0, t); // entrée
      else t1 = Math.min(t1, t);          // sortie
    }
    if (t0 > t1 + 1e-9) return null;
  }
  return t0 <= t1 + 1e-9 ? [t0, t1] : null;
}

// ── exports publics ───────────────────────────────────────────────────────────

/**
 * Hachures diagonales 45° sur la face supérieure du keepout.
 * Renderisées avec lineBasicMaterial amber (renderOrder 12) dans SolarScene3DViewer.
 */
export function keepoutHatchGeometry(vol: Vol): THREE.BufferGeometry | null {
  if (vol.visualRole !== "keepout_surface") return null;
  const ring = topRing(vol, 0.024);
  if (ring.length < 3) return null;

  // Normalise le sens de rotation en CCW pour le clipping
  const area = signedArea2D(ring);
  const poly: readonly THREE.Vector3[] = area >= 0 ? ring : [...ring].reverse();

  const avgZ = ring.reduce((s, p) => s + p.z, 0) / ring.length;

  // Balayage diagonal : lignes x - y = c à intervalles réguliers
  const cVals = poly.map((p) => p.x - p.y);
  const cMin = Math.min(...cVals);
  const cMax = Math.max(...cVals);
  const span = Math.max(cMax - cMin, 0.5);
  const spacing = Math.max(0.35, span / 7);

  const xVals = poly.map((p) => p.x);
  const xMin = Math.min(...xVals) - 0.5;
  const xMax = Math.max(...xVals) + 0.5;

  const positions: number[] = [];
  for (let c = cMin - spacing * 0.5; c <= cMax + spacing * 0.5; c += spacing) {
    // Ligne : y = x - c  (direction NE, pente +1)
    const ax = xMin, ay = xMin - c;
    const bx = xMax, by = xMax - c;
    const clip = clipSegToCCWPoly(ax, ay, bx, by, poly);
    if (!clip) continue;
    const [t0, t1] = clip;
    const x0 = ax + t0 * (bx - ax);
    const y0 = ay + t0 * (by - ay);
    const x1 = ax + t1 * (bx - ax);
    const y1 = ay + t1 * (by - ay);
    positions.push(x0, y0, avgZ, x1, y1, avgZ);
  }

  if (positions.length === 0) return null;
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}

/**
 * Marqueurs en L aux coins de l'anneau supérieur du keepout.
 * Deux segments courts par coin, orientés vers l'intérieur le long des arêtes adjacentes.
 * Renderisés avec lineBasicMaterial jaune clair (renderOrder 13) dans SolarScene3DViewer.
 */
export function keepoutCornerMarksGeometry(vol: Vol): THREE.BufferGeometry | null {
  if (vol.visualRole !== "keepout_surface") return null;
  const ring = topRing(vol, 0.028); // légèrement au-dessus des hachures
  const n = ring.length;
  if (n < 3) return null;

  const positions: number[] = [];

  for (let i = 0; i < n; i++) {
    const prev = ring[(i - 1 + n) % n]!;
    const curr = ring[i]!;
    const next = ring[(i + 1) % n]!;

    const lenPrev = curr.distanceTo(prev);
    const lenNext = curr.distanceTo(next);

    // Longueur du marqueur : 18 % de l'arête la plus courte, borne [0.08, 0.28]
    const markLen = Math.max(0.08, Math.min(0.28, Math.min(lenPrev, lenNext) * 0.18));

    const z = curr.z;
    const dpx = ((prev.x - curr.x) / (lenPrev || 1)) * markLen;
    const dpy = ((prev.y - curr.y) / (lenPrev || 1)) * markLen;
    const dnx = ((next.x - curr.x) / (lenNext || 1)) * markLen;
    const dny = ((next.y - curr.y) / (lenNext || 1)) * markLen;

    // Segment vers le sommet précédent
    positions.push(curr.x, curr.y, z, curr.x + dpx, curr.y + dpy, z);
    // Segment vers le sommet suivant
    positions.push(curr.x, curr.y, z, curr.x + dnx, curr.y + dny, z);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  return geo;
}
