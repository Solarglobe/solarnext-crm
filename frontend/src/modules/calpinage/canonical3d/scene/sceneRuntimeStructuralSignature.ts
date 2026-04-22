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
 * - `state.pans`, `roof.roofPans` (miroir — la chaîne officielle resynchronise avant build)
 * - `state.contours` (emprise / fallback)
 * - `state.structural` (ridges / traits)
 * - `state.obstacles`, `shadowVolumes`, `roofExtensions`
 * - Monde : `metersPerPixel`, `northAngleDeg`, `canonical3DWorldContract`
 * - Panneaux : données retournées par `getAllPanels` (ou `pvPlacementEngine`) quand elles influencent le placement
 *
 * ## Rebuild à éviter
 *
 * - Sélection UI, hover, outil actif, scroll, flags purement visuels **non** présents dans l’extrait ci-dessous.
 *
 * @see officialSolarScene3DGateway.ts — cache scène 3D indexé par `sceneRuntimeSignature`
 * @see integration/officialRoofModelNearShadingCache.ts — même clé pour le RoofTruth partagé (ombrage, etc.)
 */

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

function pickRoofStructural(roof: unknown): unknown {
  if (!roof || typeof roof !== "object") return null;
  const r = roof as Record<string, unknown>;
  const scale = r.scale;
  const roofBlock = r.roof;
  const contract = r.canonical3DWorldContract;
  const roofPans = r.roofPans;
  const imageMeta =
    r.image && typeof r.image === "object"
      ? {
          width: (r.image as { width?: unknown }).width,
          height: (r.image as { height?: unknown }).height,
        }
      : null;
  return { scale, roofBlock, canonical3DWorldContract: contract, roofPans, imageMeta };
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
  return {
    pans: r.pans ?? null,
    contours: r.contours ?? null,
    structural: r.structural ?? null,
    obstacles: r.obstacles ?? null,
    shadowVolumes: r.shadowVolumes ?? null,
    roofExtensions: r.roofExtensions ?? null,
    roof: pickRoofStructural(roof),
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
  const roofPayload = stableStringifyForSignature({ pans: snap.pans, roof: snap.roof, structural: snap.structural });
  const roofSignature = fnv1a32Hex(`roof:${roofPayload}`);

  const geometryPayload = stableStringifyForSignature({
    contours: snap.contours,
    obstacles: snap.obstacles,
    shadowVolumes: snap.shadowVolumes,
    roofExtensions: snap.roofExtensions,
  });
  const geometrySignature = fnv1a32Hex(`geom:${geometryPayload}`);

  const roofRec = snap.roof as Record<string, unknown> | null;
  const scale = roofRec?.scale as Record<string, unknown> | undefined;
  const rb = roofRec?.roofBlock as Record<string, unknown> | undefined;
  const north = rb?.north as Record<string, unknown> | undefined;
  const worldPayload = stableStringifyForSignature({
    metersPerPixel: scale?.metersPerPixel,
    northAngleDeg: north?.angleDeg ?? (north as { angleDeg?: unknown } | undefined)?.angleDeg,
    canonical3DWorldContract: roofRec?.canonical3DWorldContract,
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
