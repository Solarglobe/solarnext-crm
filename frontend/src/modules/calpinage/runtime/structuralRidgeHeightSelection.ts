/**
 * Résolution d’un point structurel (contour / faîtage / trait) au plus proche en px image.
 * Aligné sur `resolveStructuralHeightSelectionNearImagePoint` dans calpinage.module.js.
 * En navigateur avec legacy chargé, délègue à `window.__calpinageResolveStructuralHeightSelectionNearImagePoint`
 * (résolution complète incl. `resolveRidgePoint` pour attaches).
 */

export type LegacyStructuralContourSelection = {
  readonly type: "contour";
  /** Index dans `contours.filter(c => c.roofRole !== "chienAssis")` */
  readonly index: number;
  readonly pointIndex: number;
};

export type LegacyStructuralRidgeSelection = {
  readonly type: "ridge";
  /** Index dans `ridges.filter(r => r.roofRole !== "chienAssis")` */
  readonly index: number;
  /** 0 = extrémité `a`, 1 = extrémité `b` */
  readonly pointIndex: 0 | 1;
};

export type LegacyStructuralTraitSelection = {
  readonly type: "trait";
  /** Index dans `traits.filter(t => t.roofRole !== "chienAssis")` */
  readonly index: number;
  readonly pointIndex: 0 | 1;
};

export type LegacyStructuralHeightSelection =
  | LegacyStructuralContourSelection
  | LegacyStructuralRidgeSelection
  | LegacyStructuralTraitSelection;

const DEFAULT_HEIGHT_GUTTER = 4;
const DEFAULT_HEIGHT_RIDGE = 7;

function distImgPt(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function filterNonChienAssis<T extends { roofRole?: string }>(arr: readonly T[] | undefined): T[] {
  if (!Array.isArray(arr)) return [];
  return arr.filter((x) => x && typeof x === "object" && (x as { roofRole?: string }).roofRole !== "chienAssis");
}

type ImgPt = { readonly x: number; readonly y: number };

type LegacyResolveWindowFn = (imgPt: ImgPt, maxDistImg: number) => LegacyStructuralHeightSelection | null;

/**
 * Implémentation TS (tests / fallback) : mêmes boucles et critère `d < bestD` que le legacy.
 * Les faîtages utilisent les coordonnées brutes `a` / `b` (sans résolution d’attaches).
 */
export function resolveNearestStructuralHeightSelectionFromImagePxTsFallback(
  runtime: unknown,
  imgPt: ImgPt,
  maxDistPx: number,
): LegacyStructuralHeightSelection | null {
  if (!runtime || typeof runtime !== "object") return null;
  const st = runtime as {
    contours?: Array<{ roofRole?: string; points?: Array<{ x?: number; y?: number } | null> }>;
    ridges?: Array<{ roofRole?: string; a?: { x?: number; y?: number }; b?: { x?: number; y?: number } }>;
    traits?: Array<{ roofRole?: string; a?: { x?: number; y?: number }; b?: { x?: number; y?: number } }>;
  };
  const contours = filterNonChienAssis(st.contours ?? []);
  const ridges = filterNonChienAssis(st.ridges ?? []);
  const traits = filterNonChienAssis(st.traits ?? []);

  let best: LegacyStructuralHeightSelection | null = null;
  let bestD = maxDistPx + 1;

  for (let i = 0; i < contours.length; i++) {
    const pts = contours[i]?.points;
    if (!Array.isArray(pts)) continue;
    for (let j = 0; j < pts.length; j++) {
      const pt = pts[j];
      if (!pt || typeof pt.x !== "number" || typeof pt.y !== "number") continue;
      const d = distImgPt(imgPt, { x: pt.x, y: pt.y });
      if (d < bestD && d <= maxDistPx) {
        bestD = d;
        best = { type: "contour", index: i, pointIndex: j };
      }
    }
  }

  for (let i = 0; i < ridges.length; i++) {
    const r = ridges[i];
    if (!r) continue;
    const ra = r.a;
    const rb = r.b;
    if (ra && typeof ra.x === "number" && typeof ra.y === "number") {
      const d = distImgPt(imgPt, { x: ra.x, y: ra.y });
      if (d < bestD && d <= maxDistPx) {
        bestD = d;
        best = { type: "ridge", index: i, pointIndex: 0 };
      }
    }
    if (rb && typeof rb.x === "number" && typeof rb.y === "number") {
      const d = distImgPt(imgPt, { x: rb.x, y: rb.y });
      if (d < bestD && d <= maxDistPx) {
        bestD = d;
        best = { type: "ridge", index: i, pointIndex: 1 };
      }
    }
  }

  for (let i = 0; i < traits.length; i++) {
    const t = traits[i];
    if (!t) continue;
    if (t.a && typeof t.a.x === "number" && typeof t.a.y === "number") {
      const d = distImgPt(imgPt, { x: t.a.x, y: t.a.y });
      if (d < bestD && d <= maxDistPx) {
        bestD = d;
        best = { type: "trait", index: i, pointIndex: 0 };
      }
    }
    if (t.b && typeof t.b.x === "number" && typeof t.b.y === "number") {
      const d = distImgPt(imgPt, { x: t.b.x, y: t.b.y });
      if (d < bestD && d <= maxDistPx) {
        bestD = d;
        best = { type: "trait", index: i, pointIndex: 1 };
      }
    }
  }

  return best;
}

/**
 * @param maxDistPx — tolérance px image (voir `HEIGHT_EDIT_EPS_IMG` / appelant 3D).
 */
export function resolveNearestStructuralHeightSelectionFromImagePx(
  runtime: unknown,
  imgPt: ImgPt,
  maxDistPx: number,
): LegacyStructuralHeightSelection | null {
  if (typeof window !== "undefined") {
    const w = window as unknown as {
      __calpinageResolveStructuralHeightSelectionNearImagePoint?: LegacyResolveWindowFn;
    };
    const fn = w.__calpinageResolveStructuralHeightSelectionNearImagePoint;
    if (typeof fn === "function") {
      try {
        const s = fn({ x: imgPt.x, y: imgPt.y }, maxDistPx);
        if (s && typeof s === "object" && (s as { type?: string }).type) {
          return s as LegacyStructuralHeightSelection;
        }
      } catch {
        /* fallback */
      }
    }
  }
  return resolveNearestStructuralHeightSelectionFromImagePxTsFallback(runtime, imgPt, maxDistPx);
}

/**
 * Variante historique : faîtages seulement (tests existants).
 * @deprecated Préférer `resolveNearestStructuralHeightSelectionFromImagePx` puis filtrer par `type === "ridge"`.
 */
export function resolveNearestStructuralRidgeSelectionFromImagePx(
  runtime: unknown,
  imgPt: ImgPt,
  maxDistPx: number,
): LegacyStructuralRidgeSelection | null {
  const s = resolveNearestStructuralHeightSelectionFromImagePx(runtime, imgPt, maxDistPx);
  if (s?.type === "ridge") return s;
  return null;
}

/** Lecture `h` alignée sur `getHeightForSelection` legacy (défauts gouttière / faîtage). */
export function readCalpinageStructuralHeightM(
  runtime: unknown,
  sel: LegacyStructuralHeightSelection,
): number | null {
  if (!runtime || typeof runtime !== "object") return null;
  const st = runtime as {
    contours?: Array<{ roofRole?: string; points?: Array<{ h?: number } | null> }>;
    ridges?: Array<{ roofRole?: string; a?: { h?: number }; b?: { h?: number } }>;
    traits?: Array<{ roofRole?: string; a?: { h?: number }; b?: { h?: number } }>;
  };
  if (sel.type === "contour") {
    const contours = filterNonChienAssis(st.contours ?? []);
    const c = contours[sel.index];
    if (!c?.points || c.points[sel.pointIndex] == null) return null;
    const p = c.points[sel.pointIndex]!;
    return typeof p.h === "number" && Number.isFinite(p.h) ? p.h : DEFAULT_HEIGHT_GUTTER;
  }
  if (sel.type === "ridge") {
    const ridges = filterNonChienAssis(st.ridges ?? []);
    const r = ridges[sel.index];
    if (!r) return null;
    const end = sel.pointIndex === 0 ? r.a : r.b;
    if (!end) return null;
    return typeof end.h === "number" && Number.isFinite(end.h) ? end.h : DEFAULT_HEIGHT_RIDGE;
  }
  const traits = filterNonChienAssis(st.traits ?? []);
  const t = traits[sel.index];
  if (!t) return null;
  const end = sel.pointIndex === 0 ? t.a : t.b;
  if (!end) return null;
  return typeof end.h === "number" && Number.isFinite(end.h) ? end.h : DEFAULT_HEIGHT_GUTTER;
}

/** Lecture de la cote `h` sur une extrémité de faîtage (m), ou défaut faîtage legacy si absente. */
export function readCalpinageRidgeEndpointHeightM(
  runtime: unknown,
  sel: LegacyStructuralRidgeSelection,
  defaultRidgeHeightM = DEFAULT_HEIGHT_RIDGE,
): number | null {
  if (!runtime || typeof runtime !== "object") return null;
  const ridges = filterNonChienAssis(
    (runtime as { ridges?: Array<{ roofRole?: string; a?: { h?: number }; b?: { h?: number } }> }).ridges ?? [],
  );
  const r = ridges[sel.index];
  if (!r) return null;
  const end = sel.pointIndex === 0 ? r.a : r.b;
  if (!end) return null;
  if (typeof end.h === "number" && Number.isFinite(end.h)) return end.h;
  return defaultRidgeHeightM;
}
