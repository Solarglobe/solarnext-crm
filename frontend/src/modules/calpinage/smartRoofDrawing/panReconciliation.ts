import { canonicalPolygonKey } from "./geometry";
import type { SmartRoofDiagnostic } from "./types";

export interface SmartRoofPanLike {
  readonly id?: string;
  readonly polygon?: readonly { readonly x: number; readonly y: number }[];
  readonly polygonPx?: readonly { readonly x: number; readonly y: number }[];
  readonly smartSourceSegmentIds?: readonly string[];
  readonly [key: string]: unknown;
}

export interface SmartRoofPanReconciliationResult<TPan extends SmartRoofPanLike = SmartRoofPanLike> {
  readonly pans: readonly TPan[];
  readonly panIdMapping: Readonly<Record<string, string>>;
  readonly diagnostics: readonly SmartRoofDiagnostic[];
}

function diagnostic(
  code: string,
  message: string,
  entityIds?: readonly string[],
): SmartRoofDiagnostic {
  return { severity: "warning", code, message, ...(entityIds ? { entityIds } : {}) };
}

function panPoints(pan: SmartRoofPanLike): readonly { readonly x: number; readonly y: number }[] {
  if (Array.isArray(pan.polygon) && pan.polygon.length >= 3) return pan.polygon;
  if (Array.isArray(pan.polygonPx) && pan.polygonPx.length >= 3) return pan.polygonPx;
  return [];
}

function sourceKey(pan: SmartRoofPanLike): string {
  const ids = [...new Set(pan.smartSourceSegmentIds ?? [])].sort();
  return ids.length ? ids.join("|") : "";
}

function exactGeometryKey(pan: SmartRoofPanLike): string {
  const points = panPoints(pan);
  return points.length >= 3 ? canonicalPolygonKey(points, 4) : "";
}

function indexedByUniqueKey<TPan extends SmartRoofPanLike>(
  pans: readonly TPan[],
  keyFn: (pan: TPan) => string,
): Map<string, TPan> {
  const buckets = new Map<string, TPan[]>();
  for (const pan of pans) {
    const key = keyFn(pan);
    if (!key) continue;
    buckets.set(key, [...(buckets.get(key) ?? []), pan]);
  }
  const unique = new Map<string, TPan>();
  for (const [key, list] of buckets.entries()) {
    if (list.length === 1) unique.set(key, list[0]!);
  }
  return unique;
}

function setOverlapScore(a: readonly string[], b: readonly string[]): number {
  if (a.length === 0 || b.length === 0) return 0;
  const as = new Set(a);
  const bs = new Set(b);
  let intersection = 0;
  for (const id of as) if (bs.has(id)) intersection += 1;
  const union = new Set([...as, ...bs]).size;
  return union > 0 ? intersection / union : 0;
}

export function reconcileSmartRoofPanIdentities<TPan extends SmartRoofPanLike>(
  previousPans: readonly SmartRoofPanLike[],
  nextPans: readonly TPan[],
): SmartRoofPanReconciliationResult<TPan> {
  const diagnostics: SmartRoofDiagnostic[] = [];
  const previousBySource = indexedByUniqueKey(previousPans, sourceKey);
  const previousByGeometry = indexedByUniqueKey(previousPans, exactGeometryKey);
  const usedPreviousIds = new Set<string>();
  const panIdMapping: Record<string, string> = {};

  const reconciled = nextPans.map((pan, index) => {
    const oldId = pan.id != null ? String(pan.id) : `pan-${index + 1}`;
    let matched: SmartRoofPanLike | null = null;
    const bySource = previousBySource.get(sourceKey(pan));
    if (bySource) {
      matched = bySource;
    } else {
      const byGeometry = previousByGeometry.get(exactGeometryKey(pan));
      if (byGeometry) matched = byGeometry;
    }

    if (!matched) {
      const nextSources = pan.smartSourceSegmentIds ?? [];
      const ranked = previousPans
        .map((prev) => ({
          pan: prev,
          score: setOverlapScore(prev.smartSourceSegmentIds ?? [], nextSources),
        }))
        .filter((item) => item.score > 0)
        .sort((a, b) => b.score - a.score);
      if (ranked.length >= 1) {
        diagnostics.push(diagnostic(
          "PAN_SPLIT_OR_MERGE_REVIEW_REQUIRED",
          "A pan shares only partial structural provenance with a previous pan; settings and panels must be reviewed.",
          [String(ranked[0]!.pan.id ?? ""), oldId].filter(Boolean),
        ));
      }
      return pan;
    }

    const previousId = matched.id != null ? String(matched.id) : "";
    if (!previousId || usedPreviousIds.has(previousId)) {
      diagnostics.push(diagnostic(
        "PAN_ID_MATCH_AMBIGUOUS",
        "A pan matched a previous id that was already used; id was not transferred.",
        [oldId, previousId].filter(Boolean),
      ));
      return pan;
    }
    usedPreviousIds.add(previousId);
    panIdMapping[oldId] = previousId;
    return { ...pan, id: previousId };
  });

  for (const prev of previousPans) {
    const prevId = prev.id != null ? String(prev.id) : "";
    if (prevId && !usedPreviousIds.has(prevId)) {
      diagnostics.push(diagnostic(
        "PREVIOUS_PAN_UNMATCHED_REVIEW_REQUIRED",
        "A previous pan was not matched by the new topology; attached settings or panels need review.",
        [prevId],
      ));
    }
  }

  return { pans: reconciled, panIdMapping, diagnostics };
}
