/**
 * Prompt 6 — empreinte déterministe du runtime **structurel** (2D/3D même vérité).
 *
 * ## Règle produit — scène unifiée
 *
 * La 2D et la 3D lisent la **même** source : `CALPINAGE_STATE` (ou équivalent) dans le même repère
 * (`canonical3DWorldContract` / `roof.scale` / nord). Seules changent projection, caméra et couches
 * d’overlay — **pas** une seconde vérité géométrique parallèle.
 *
 * ## Rebuild obligatoire (signature change)
 *
 * - `state.pans` et, en leur absence, `roof.roofPans` (miroir de compatibilité)
 * - `state.contours` (emprise / fallback)
 * - `state.ridges` et `state.traits` validés par le même résolveur que le builder ;
 *   `state.structural` uniquement comme fallback de hauteurs si les tableaux racine sont absents
 * - `state.obstacles`, `shadowVolumes`, `roofExtensions`, `parametricDormers`
 * - Monde : échelle et nord sources ; le contrat 3D dérivé est resynchronisé avant build
 * - Panneaux : données retournées par `getAllPanels` (ou `pvPlacementEngine`) quand elles influencent le placement
 *
 * ## Rebuild à éviter
 *
 * - Sélection UI, hover, outil actif, scroll, flags purement visuels **non** présents dans l’extrait ci-dessous.
 *
 * @see officialSolarScene3DGateway.ts — cache scène 3D indexé par `sceneRuntimeSignature`
 * @see integration/officialRoofModelNearShadingCache.ts — même clé pour le RoofTruth partagé (ombrage, etc.)
 */

import { resolveCalpinageStructuralRoofForCanonicalChain } from "../../integration/calpinageStructuralRoofFromRuntime";
import { resolvePanPolygonFor3D } from "../../integration/resolvePanPolygonFor3D";

const FNV_OFFSET = 2166136261;
const FNV_PRIME = 16777619;

function fnv1a32Hex(input: string): string {
  let h = FNV_OFFSET >>> 0;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, FNV_PRIME) >>> 0;
  }
  return h.toString(16).padStart(8, "0");
}

/** Sérialisation stable JSON (clés d’objets triées) pour hachage. */
export function stableStringifyForSignature(value: unknown): string {
  if (value === undefined) return "undefined";
  if (value === null) return "null";
  const t = typeof value;
  if (t === "number" || t === "boolean") return JSON.stringify(value);
  if (t === "string") return JSON.stringify(value);
  if (t === "bigint") return JSON.stringify(String(value));
  if (t === "function") {
    const fn = value as { name?: string };
    return `"fn:${fn.name || "anonymous"}"`;
  }
  if (Array.isArray(value)) {
    return `[${value.map((x) => stableStringifyForSignature(x)).join(",")}]`;
  }
  if (value && typeof value === "object") {
    const o = value as Record<string, unknown>;
    const keys = Object.keys(o).sort();
    return `{${keys.map((k) => `${JSON.stringify(k)}:${stableStringifyForSignature(o[k])}`).join(",")}}`;
  }
  return JSON.stringify(String(value));
}

/** Validated lines consumed by the official roof builder. Selection labels and
 * order of distinctly identified lines cannot change a geometric cache key. */
function structuralLinesForSignature(runtime: unknown): unknown {
  const { payload } = resolveCalpinageStructuralRoofForCanonicalChain(runtime, undefined);
  const point = (raw: unknown) => {
    const p = raw && typeof raw === "object" ? raw as Record<string, unknown> : {};
    return { x: p.x, y: p.y, height: p.h ?? p.heightM ?? null };
  };
  const lines = (items: readonly unknown[], kind: "ridge" | "trait") => items.map((raw, index) => {
    const line = raw as Record<string, unknown>;
    // The builder derives IDs from the filtered array index when none is
    // supplied. Reordering anonymous lines changes those observable IDs.
    return { kind, id: line.id == null ? `${kind}-${index}` : String(line.id), a: point(line.a), b: point(line.b) };
  }).sort((a, b) => {
    const topology = (line: typeof a) => stableStringifyForSignature({ kind: line.kind,
      a: { x: line.a.x, y: line.a.y }, b: { x: line.b.x, y: line.b.y } });
    // Distinct lines form an unordered set. Coincident lines can compete for
    // the same edge/height, so their original precedence must remain signed.
    return topology(a).localeCompare(topology(b));
  });
  return { ridges: lines(payload.ridges, "ridge"), traits: lines(payload.traits, "trait") };
}

function panGeometryForSignature(raw: unknown, index: number): unknown {
  if (!raw || typeof raw !== "object") return raw;
  const pan = raw as Record<string, unknown>;
  const polygon = resolvePanPolygonFor3D(pan).raw;
  const physical = pan.physical && typeof pan.physical === "object"
    ? pan.physical as Record<string, unknown> : {};
  const slope = physical.slope && typeof physical.slope === "object"
    ? physical.slope as Record<string, unknown> : {};
  const orientation = physical.orientation && typeof physical.orientation === "object"
    ? physical.orientation as Record<string, unknown> : {};
  return {
    id: pan.id == null ? `pan-${index}` : String(pan.id),
    polygon: polygon?.map(rawPoint => {
      const p = rawPoint && typeof rawPoint === "object" ? rawPoint as Record<string, unknown> : {};
      return { x: p.x, y: p.y, height: p.h ?? p.heightM ?? null };
    }) ?? null,
    roofType: pan.roofType ?? null,
    tiltDegHint: slope.valueDeg ?? pan.tiltDeg ?? null,
    azimuthDegHint: orientation.azimuthDeg ?? pan.azimuthDeg ?? null,
  };
}

function pickRoofStructural(roof: unknown, hasRuntimePans: boolean): unknown {
  if (!roof || typeof roof !== "object") return null;
  const r = roof as Record<string, unknown>;
  const scale = r.scale && typeof r.scale === "object" ? r.scale as Record<string, unknown> : {};
  const roofBlock = r.roof && typeof r.roof === "object" ? r.roof as Record<string, unknown> : {};
  const north = roofBlock.north && typeof roofBlock.north === "object"
    ? roofBlock.north as Record<string, unknown> : {};
  const roofPans = !hasRuntimePans && Array.isArray(r.roofPans)
    ? r.roofPans.map(panGeometryForSignature) : null;
  const imageMeta =
    r.image && typeof r.image === "object"
      ? {
          width: (r.image as { width?: unknown }).width,
          height: (r.image as { height?: unknown }).height,
        }
      : null;
  return { metersPerPixel: scale.metersPerPixel, northAngleDeg: north.angleDeg, roofPans, imageMeta };
}

/**
 * Extrait uniquement les champs qui **doivent** invalider la scène 3D structurelle.
 * Ignore toute clé non listée (ex. état UI éphémère sur le même objet).
 */
export function extractStructuralRuntimeSnapshot(runtime: unknown): Record<string, unknown> {
  if (!runtime || typeof runtime !== "object") {
    return { _empty: true };
  }
  const r = runtime as Record<string, unknown>;
  const roof = r.roof;
  const structuralFallback = r.structural && typeof r.structural === "object"
    ? r.structural as Record<string, unknown> : {};
  return {
    pans: Array.isArray(r.pans) ? r.pans.map(panGeometryForSignature) : null,
    contours: Array.isArray(r.contours) ? r.contours : structuralFallback.contours ?? null,
    structural: structuralLinesForSignature(runtime),
    heightFallback: {
      ridges: Array.isArray(r.ridges) ? null : structuralFallback.ridges ?? null,
      traits: Array.isArray(r.traits) ? null : structuralFallback.traits ?? null,
    },
    obstacles: r.obstacles ?? null,
    shadowVolumes: r.shadowVolumes ?? null,
    roofExtensions: r.roofExtensions ?? null,
    parametricDormers: r.parametricDormers ?? null,
    roof: pickRoofStructural(roof, Array.isArray(r.pans) && r.pans.length > 0),
  };
}

export type RuntimeSceneStructuralSignatures = {
  readonly sceneRuntimeSignature: string;
  readonly geometrySignature: string;
  readonly roofSignature: string;
  readonly pvSignature: string;
  readonly worldSignature: string;
};

/**
 * Empreinte PV : uniquement via `getAllPanels` explicite (même source que le build runtime).
 * Pas de lecture implicite de `globalThis.pvPlacementEngine` ici — sinon signatures instables
 * (ordre d’exécution / montage du moteur) et faux cache miss.
 */
function resolvePanelsRaw(options?: {
  readonly getAllPanels?: () => unknown[] | null | undefined;
}): unknown {
  try {
    if (typeof options?.getAllPanels === "function") {
      const v = options.getAllPanels();
      const arr = Array.isArray(v) ? v : [];
      const objects = arr.filter((x) => x && typeof x === "object") as Record<string, unknown>[];
      objects.sort((a, b) => String(a.id ?? "").localeCompare(String(b.id ?? "")));
      return objects;
    }
  } catch {
    return [];
  }
  return [];
}

/**
 * Empreintes déterministes — comparables entre elles pour savoir si le runtime **structurel** a changé.
 */
export function computeRuntimeSceneStructuralSignatures(
  runtime: unknown,
  options?: {
    readonly getAllPanels?: () => unknown[] | null | undefined;
  },
): RuntimeSceneStructuralSignatures {
  const snap = extractStructuralRuntimeSnapshot(runtime);
  const roofPayload = stableStringifyForSignature({ pans: snap.pans, roof: snap.roof, structural: snap.structural, heightFallback: snap.heightFallback });
  const roofSignature = fnv1a32Hex(`roof:${roofPayload}`);

  const geometryPayload = stableStringifyForSignature({
    contours: snap.contours,
    obstacles: snap.obstacles,
    shadowVolumes: snap.shadowVolumes,
    roofExtensions: snap.roofExtensions,
    parametricDormers: snap.parametricDormers,
  });
  const geometrySignature = fnv1a32Hex(`geom:${geometryPayload}`);

  const roofRec = snap.roof as Record<string, unknown> | null;
  const worldPayload = stableStringifyForSignature({
    metersPerPixel: roofRec?.metersPerPixel,
    northAngleDeg: roofRec?.northAngleDeg,
  });
  const worldSignature = fnv1a32Hex(`world:${worldPayload}`);

  const pvRaw = resolvePanelsRaw(options);
  const pvSignature = fnv1a32Hex(`pv:${stableStringifyForSignature(pvRaw)}`);

  const sceneRuntimeSignature = fnv1a32Hex(
    `scene:${worldSignature}|${roofSignature}|${geometrySignature}|${pvSignature}`,
  );

  return {
    sceneRuntimeSignature,
    geometrySignature,
    roofSignature,
    pvSignature,
    worldSignature,
  };
}

/** Nom d’événement DOM officiel (Prompt 7) — unique source d’invalidation structurelle côté legacy. */
export const CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE = "CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE" as const;
