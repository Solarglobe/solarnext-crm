/**
 * Index spatial 2D à grille uniforme pour l'interpolation hauteurs IGN.
 *
 * PROBLÈME RÉSOLU : getHeightAtXY() itérait en O(n) sur tous les points IGN.
 * Sur 5 000+ points, cela causait des reconstructions > 3s.
 *
 * SOLUTION : grille uniforme de CELL_SIZE = 2m.
 *   - buildIndex() : O(n) une seule fois.
 *   - query()      : O(k) où k = points dans les cellules visitées (≈ quelques dizaines).
 *
 * Convention coordonnées : plan horizontal monde ENU (x = Est m, y = Nord m).
 * Les coordonnées Z sont portées par Point3D mais ignorées lors de l'indexation.
 *
 * Mémoire : SpatialIndex ne garde qu'une Map<string, Point3D[]>.
 * Libération : affecter `null` à la référence ou appeler setPointCloud() pour reconstruire.
 */

// ─── Types publics ────────────────────────────────────────────────────────────

export type Point3D = Readonly<{ x: number; y: number; z: number }>;

export type SpatialIndex = {
  /** Map clé "cx:cy" → liste de points dans la cellule. */
  readonly cells: ReadonlyMap<string, readonly Point3D[]>;
  /** Taille d'une cellule (m) — identique à CELL_SIZE au moment de la construction. */
  readonly cellSize: number;
  /** Nombre total de points indexés. */
  readonly pointCount: number;
};

// ─── Constante paramétrables ──────────────────────────────────────────────────

/**
 * Taille d'une cellule de grille (m).
 * 2m : bon compromis entre granularité et surcoût mémoire pour des nuages IGN typiques.
 */
export const CELL_SIZE = 2;

// ─── Fonctions internes ───────────────────────────────────────────────────────

function cellKey(cx: number, cy: number): string {
  return `${cx}:${cy}`;
}

// ─── API publique ─────────────────────────────────────────────────────────────

/**
 * Construit l'index spatial depuis un nuage de points 3D.
 * Complexité : O(n).
 * Les points avec coordonnées non-finies sont silencieusement ignorés.
 */
export function buildIndex(points: readonly Point3D[]): SpatialIndex {
  const cells = new Map<string, Point3D[]>();
  let count = 0;

  for (const p of points) {
    if (!Number.isFinite(p.x) || !Number.isFinite(p.y) || !Number.isFinite(p.z)) continue;
    const cx = Math.floor(p.x / CELL_SIZE);
    const cy = Math.floor(p.y / CELL_SIZE);
    const key = cellKey(cx, cy);
    let cell = cells.get(key);
    if (!cell) {
      cell = [];
      cells.set(key, cell);
    }
    cell.push(p);
    count++;
  }

  return { cells, cellSize: CELL_SIZE, pointCount: count };
}

/**
 * Retourne tous les points de l'index situés à distance ≤ `radius` de `xy`.
 *
 * Complexité : O(k) où k est le nombre de points dans les cellules candidates.
 * Pour CELL_SIZE=2m et radius=10m, cela représente au plus ~(10/2 * 2 + 1)² = 121 cellules.
 *
 * @param index  — Index construit par buildIndex().
 * @param xy     — Point de requête (coordonnées monde ENU, m).
 * @param radius — Rayon de recherche (m). Doit être > 0.
 * @returns      Tableau (éventuellement vide) des points dans le rayon.
 */
export function query(
  index: SpatialIndex,
  xy: { readonly x: number; readonly y: number },
  radius: number,
): Point3D[] {
  const { cells, cellSize } = index;
  const r2 = radius * radius;

  const cxMin = Math.floor((xy.x - radius) / cellSize);
  const cxMax = Math.floor((xy.x + radius) / cellSize);
  const cyMin = Math.floor((xy.y - radius) / cellSize);
  const cyMax = Math.floor((xy.y + radius) / cellSize);

  const results: Point3D[] = [];

  for (let cx = cxMin; cx <= cxMax; cx++) {
    for (let cy = cyMin; cy <= cyMax; cy++) {
      const cell = cells.get(cellKey(cx, cy));
      if (!cell) continue;
      for (const p of cell) {
        const dx = p.x - xy.x;
        const dy = p.y - xy.y;
        if (dx * dx + dy * dy <= r2) results.push(p);
      }
    }
  }

  return results;
}

/**
 * Retourne le point le plus proche de `xy` dans l'index, ou `null` si l'index est vide.
 * Utilisé comme fallback quand `query()` retourne zéro résultats (point hors nuage).
 *
 * Complexité : O(n) dans le pire cas — ne pas appeler sur le chemin chaud.
 */
export function nearestPoint(
  index: SpatialIndex,
  xy: { readonly x: number; readonly y: number },
): Point3D | null {
  let best: Point3D | null = null;
  let bestD2 = Infinity;

  for (const cell of index.cells.values()) {
    for (const p of cell) {
      const dx = p.x - xy.x;
      const dy = p.y - xy.y;
      const d2 = dx * dx + dy * dy;
      if (d2 < bestD2) {
        bestD2 = d2;
        best = p;
      }
    }
  }

  return best;
}
