/**
 * Centroïde géométrique d'un polygone simple par la formule de Shoelace pondérée par les aires.
 *
 * Formule (ordre CCW ou CW — invariant) :
 *   A  = Σᵢ (xᵢ·y_{i+1} − x_{i+1}·yᵢ) / 2
 *   Cₓ = Σᵢ (xᵢ + x_{i+1}) · (xᵢ·y_{i+1} − x_{i+1}·yᵢ) / (6·A)
 *   Cᵧ = Σᵢ (yᵢ + y_{i+1}) · (xᵢ·y_{i+1} − x_{i+1}·yᵢ) / (6·A)
 *
 * Correct pour les polygones non convexes (L, U, C, etc.) contrairement à la
 * moyenne arithmétique des sommets qui peut tomber hors du polygone.
 *
 * Dégénérescence : si |A| < 1e-14 (polygone dégénéré, segment ou point) on
 * retombe sur la moyenne arithmétique des sommets pour éviter la division par 0.
 */

const EPS_AREA = 1e-14;

export type XY2 = Readonly<{ x: number; y: number }>;

/**
 * Calcule le centroïde géométrique d'un polygone simple (auto-fermé).
 *
 * @param vertices  Sommets dans l'ordre (pas besoin de répéter le premier).
 * @returns Centroïde {x, y}, ou {0, 0} si le tableau est vide.
 */
export function getCentroid(vertices: ReadonlyArray<XY2>): { x: number; y: number } {
  const n = vertices.length;
  if (n === 0) return { x: 0, y: 0 };
  if (n === 1) return { x: vertices[0]!.x, y: vertices[0]!.y };
  if (n === 2) {
    return {
      x: (vertices[0]!.x + vertices[1]!.x) / 2,
      y: (vertices[0]!.y + vertices[1]!.y) / 2,
    };
  }

  // Shoelace : aire signée et moments du premier ordre
  let signedArea = 0;
  let cx = 0;
  let cy = 0;

  for (let i = 0; i < n; i++) {
    const cur = vertices[i]!;
    const nxt = vertices[(i + 1) % n]!;
    const cross = cur.x * nxt.y - nxt.x * cur.y;
    signedArea += cross;
    cx += (cur.x + nxt.x) * cross;
    cy += (cur.y + nxt.y) * cross;
  }

  signedArea /= 2;

  if (Math.abs(signedArea) < EPS_AREA) {
    // Polygone dégénéré → moyenne arithmétique (fallback)
    let sx = 0;
    let sy = 0;
    for (const v of vertices) {
      sx += v.x;
      sy += v.y;
    }
    return { x: sx / n, y: sy / n };
  }

  const factor = 1 / (6 * signedArea);
  return { x: cx * factor, y: cy * factor };
}
