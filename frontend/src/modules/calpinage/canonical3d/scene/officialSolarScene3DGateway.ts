/**
 * Prompt 6 — une seule scène 3D officielle par signature structurelle (cache transparent).
 *
 * Le **RoofTruth** (`BuildRoofModel3DResult`) est stocké dans le même module de signature que
 * `integration/officialRoofModelNearShadingCache` : une entrée par `sceneRuntimeSignature`, vidée
 * ici via `clearOfficialSolarScene3DCache` ou `forceStructuralRebuild` (éviction alignée).
 *
 * ## Audit intégration (synthèse)
 *
 * | Fichier | Fonction | Déclencheur | Rebuild utile ? | Risque | Action |
 * |---------|----------|-------------|-----------------|--------|--------|
 * | `Inline3DViewerBridge.tsx` | `buildScene` | `calpinage:viewmode` 3D, `__CALPINAGE_VIEW_MODE__` | Oui si pas de cache hit | 3D figée si runtime change en 3D | Passerelle + event structurel |
 * | `useDev3DScene.ts` | `useMemo` | `mode`, `fixture` URL | Non si session change | Session JSON ignoré | Hors scope produit CRM |
 * | `buildSolarScene3DFromCalpinageRuntime.ts` | build | appel direct | Toujours full pipeline | Doublons si toggles répétés | Envelopper via cette passerelle |
 * | `tryBuildSolarScene3DForProduct.ts` | product | flag + runtime | Build explicite | — | **Ne passe pas** par le cache (build frais intentionnel) |
 */

import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntimeCore";
import { getCalpinageRuntime } from "../../runtime/calpinageRuntime";
import type { BuildSolarScene3DFromCalpinageRuntimeOptions } from "../buildSolarScene3DFromCalpinageRuntimeCore";
import {
  buildPanelVisualShadingMapFromRuntime,
  extractRuntimeShadingSummary,
} from "../viewer/visualShading/resolvePanelVisualShading";
import { syncRoofPansMirrorFromPans } from "../../legacy/phase2RoofDerivedModel";
import {
  computeRuntimeSceneStructuralSignatures,
  type RuntimeSceneStructuralSignatures,
} from "./sceneRuntimeStructuralSignature";
import type { OfficialRuntimeStructuralChangePayload } from "../../runtime/emitOfficialRuntimeStructuralChange";
import { dump3DRuntimePreViewer } from "../dev/runtime3DAutopsy";
import {
  clearOfficialRoofModelNearShadingCache,
  evictOfficialRoofTruthForSceneRuntimeSignature,
} from "../../integration/officialRoofModelNearShadingCache";

export type SceneSyncStatus = "IN_SYNC" | "STALE" | "REBUILDING" | "INVALID";

export type SceneSyncDiagnostics = {
  readonly sceneSyncStatus: SceneSyncStatus;
  readonly sceneRuntimeSignature: string;
  readonly displayedSceneSignature: string | null;
  readonly lastBuildReason: string | null;
  readonly rebuildCountForCurrentSignature: number;
  readonly usedSceneCache: boolean;
  readonly sceneSyncWarnings: readonly string[];
  /** Prompt 7 — dernier event structurel legacy ayant déclenché (ou non) un passage par la passerelle. */
  readonly lastStructuralChangeReason: string | null;
  readonly lastStructuralChangeDomains: readonly string[];
  readonly lastEventTimestamp: number;
  /** true si un event legacy était présent et que le cache n’a pas été utilisé (pipeline complet). */
  readonly rebuildTriggeredByEvent: boolean;
};

export type OfficialSolarSceneGatewayOptions = BuildSolarScene3DFromCalpinageRuntimeOptions & {
  /** Ignore le cache et relance le pipeline complet pour cette signature. */
  readonly forceStructuralRebuild?: boolean;
  /**
   * Signature affichée **avant** cet appel (si connue). Si différente de la signature courante,
   * `sceneSyncStatus` peut être `STALE` : le rendu précédent était en retard sur le runtime.
   */
  readonly previouslyDisplayedSceneRuntimeSignature?: string | null;
  /** Détail du dernier `CALPINAGE_OFFICIAL_RUNTIME_STRUCTURAL_CHANGE` (bridge 3D uniquement). */
  readonly structuralChangeEventDetail?: OfficialRuntimeStructuralChangePayload | null;
};

export type BuildSolarScene3DFromCalpinageRuntimeWithSyncResult = ReturnType<
  typeof buildSolarScene3DFromCalpinageRuntime
> & {
  readonly sceneStructuralSignatures: RuntimeSceneStructuralSignatures;
  readonly sceneSyncDiagnostics: SceneSyncDiagnostics;
};

const structuralCache = new Map<string, ReturnType<typeof buildSolarScene3DFromCalpinageRuntime>>();
const pipelineInvocationCountBySignature = new Map<string, number>();

function refreshSceneVisualShadingFromRuntime(
  cached: ReturnType<typeof buildSolarScene3DFromCalpinageRuntime>,
  runtime: unknown,
): ReturnType<typeof buildSolarScene3DFromCalpinageRuntime> {
  const scene = cached.scene;
  if (!cached.ok || scene == null) return cached;
  const panelIds = scene.pvPanels.map((p) => String(p.id));
  const panelVisualShadingByPanelId = buildPanelVisualShadingMapFromRuntime(panelIds, runtime);
  const panelVisualShadingSummary = extractRuntimeShadingSummary(runtime);
  return {
    ...cached,
    scene: {
      ...scene,
      panelVisualShadingByPanelId,
      ...(panelVisualShadingSummary != null
        ? { panelVisualShadingSummary }
        : { panelVisualShadingSummary: undefined }),
    },
  };
}

/** Tests / reset session : vide le cache officiel. */
export function clearOfficialSolarScene3DCache(): void {
  structuralCache.clear();
  pipelineInvocationCountBySignature.clear();
  clearOfficialRoofModelNearShadingCache();
}

function finalizeDiagnostics(args: {
  readonly key: string;
  readonly sigs: RuntimeSceneStructuralSignatures;
  readonly ok: boolean;
  readonly hasScene: boolean;
  readonly usedSceneCache: boolean;
  readonly lastBuildReason: string;
  readonly prevDisplayed: string | null | undefined;
  readonly structuralEventDetail: OfficialRuntimeStructuralChangePayload | null | undefined;
}): SceneSyncDiagnostics {
  const warnings: string[] = [];
  const prev = args.prevDisplayed;
  if (prev != null && prev !== args.key) {
    warnings.push("PREVIOUS_DISPLAY_SIGNATURE_DIVERGED_FROM_RUNTIME");
  }
  let sceneSyncStatus: SceneSyncStatus;
  if (!args.ok) {
    sceneSyncStatus = "INVALID";
  } else if (prev != null && prev !== args.key) {
    sceneSyncStatus = "STALE";
  } else {
    sceneSyncStatus = "IN_SYNC";
  }
  const ev = args.structuralEventDetail;
  const hasEvent = ev != null && typeof ev.reason === "string" && Array.isArray(ev.changedDomains);
  return {
    sceneSyncStatus,
    sceneRuntimeSignature: args.key,
    displayedSceneSignature: args.ok && args.hasScene ? args.key : null,
    lastBuildReason: args.lastBuildReason,
    rebuildCountForCurrentSignature: pipelineInvocationCountBySignature.get(args.key) ?? 0,
    usedSceneCache: args.usedSceneCache,
    sceneSyncWarnings: warnings,
    lastStructuralChangeReason: hasEvent ? ev.reason : null,
    lastStructuralChangeDomains: hasEvent ? [...ev.changedDomains] : [],
    lastEventTimestamp: hasEvent && typeof ev.timestamp === "number" ? ev.timestamp : 0,
    rebuildTriggeredByEvent: hasEvent && !args.usedSceneCache,
  };
}

/**
 * Retourne la scène 3D pour le runtime courant, en réutilisant le cache si la signature structurelle est identique.
 * Garantit **un seul** enregistrement de résultat de pipeline par `sceneRuntimeSignature` (tant que le cache n’est pas vidé).
 */
export function getOrBuildOfficialSolarScene3DFromCalpinageRuntime(
  runtime: unknown,
  options?: OfficialSolarSceneGatewayOptions,
): BuildSolarScene3DFromCalpinageRuntimeWithSyncResult {
  // ── Guard: runtime de hauteur disponible ? ─────────────────────────────────
  // Si getCalpinageRuntime().getHeightAtXY() est absent, RuntimeHeightResolver
  // retournera RUNTIME_FALLBACK (Z=0) sur tous les sommets → toiture plate
  // silencieuse. On détecte ce cas ICI, avant que le pipeline soit lancé, pour
  // notifier l'UI via un CustomEvent. Le pipeline continue malgré tout (rendu 2D
  // non bloqué, résultat 3D dégradé géré par le bridge en emergency fallback).
  const _heightFnAvailable = getCalpinageRuntime()?.getHeightAtXY != null;
  if (!_heightFnAvailable) {
    if (import.meta.env.DEV) {
      console.warn(
        "[3D-GATEWAY] RUNTIME_NOT_MOUNTED — getCalpinageRuntime().getHeightAtXY indisponible.\n" +
        "La reconstruction 3D va produire une toiture plate (Z=0 sur tous les sommets).\n" +
        "Émission de calpinage:3d-degraded pour notification UI.",
      );
    }
    window.dispatchEvent(
      new CustomEvent("calpinage:3d-degraded", {
        detail: { reason: "RUNTIME_NOT_MOUNTED" },
      }),
    );
  }
  // ──────────────────────────────────────────────────────────────────────────

  if (runtime && typeof runtime === "object" && (runtime as Record<string, unknown>).pans) {
    try {
      syncRoofPansMirrorFromPans(runtime as Record<string, unknown>);
    } catch {
      /* défensif — aligné sur buildSolarScene3DFromCalpinageRuntime */
    }
  }

  const sigs = computeRuntimeSceneStructuralSignatures(runtime, options);
  const key = sigs.sceneRuntimeSignature;
  const prevDisplayed = options?.previouslyDisplayedSceneRuntimeSignature;
  const structuralEventDetail = options?.structuralChangeEventDetail ?? null;

  if (options?.forceStructuralRebuild) {
    structuralCache.delete(key);
    evictOfficialRoofTruthForSceneRuntimeSignature(key);
  }

  /**
   * Ne jamais réutiliser une entrée `ok: false` ou sans scène : sinon le bridge bascule en emergency
   * de façon permanente pour cette signature (extensions / chien assis absents du fallback).
   */
  if (!options?.forceStructuralRebuild) {
    const poisoned = structuralCache.get(key);
    if (poisoned != null && (!poisoned.ok || poisoned.scene == null)) {
      structuralCache.delete(key);
      evictOfficialRoofTruthForSceneRuntimeSignature(key);
    }
  }

  if (!options?.forceStructuralRebuild && structuralCache.has(key)) {
    const cached = refreshSceneVisualShadingFromRuntime(structuralCache.get(key)!, runtime);
    structuralCache.set(key, cached);
    if (import.meta.env.DEV) {
      console.log("[3D-RUNTIME][PIPELINE]", {
        cacheHit: true,
        signature: key,
        ok: cached.ok,
        hasScene: cached.scene != null,
        autopsyLegacyPath: cached.autopsyLegacyPath ?? "unknown",
        lastBuildReason: "cache_hit_same_structural_signature",
      });
      if (cached.scene) {
        dump3DRuntimePreViewer(cached.scene, {
          pipeline: "official_ok",
          legacyPath: cached.autopsyLegacyPath ?? "unknown",
          roofGeometrySource: cached.scene.metadata.roofGeometrySource ?? null,
        });
      }
    }
    return {
      ...cached,
      sceneStructuralSignatures: sigs,
      sceneSyncDiagnostics: finalizeDiagnostics({
        key,
        sigs,
        ok: cached.ok,
        hasScene: cached.scene != null,
        usedSceneCache: true,
        lastBuildReason: "cache_hit_same_structural_signature",
        prevDisplayed,
        structuralEventDetail,
      }),
    };
  }

  const built = buildSolarScene3DFromCalpinageRuntime(runtime, options);

  // Guard: ne pas mettre en cache un résultat 0-panneau quand le moteur dispose de panneaux.
  //
  // Scénario reproductible : l'utilisateur pose des panneaux alors que le bloc actif n'est pas
  // encore figé. getAllPanelsFromRuntime() exclut intentionnellement ce bloc (panneaux fantômes
  // non engagés) → pvSig = hash([]) → pipeline produit 0 pvPanels → résultat mis en cache.
  // Tant que le bloc reste actif, la même clé de cache est retournée → vue 3D bloquée à 0
  // panneaux même après que l'utilisateur revient en 2D, fige le bloc et repasse en 3D.
  //
  // Correction : si la scène est valide mais vide (0 pvPanels) alors que getAllPanels() retourne
  // des panneaux, ce résultat est transitoire (bloc actif en cours) → on ne le met PAS en cache.
  //
  // Autre garde : ne jamais mettre en cache un build officiel `ok: false` / sans `scene` — sinon le
  // bridge réutilise éternellement cet échec (fallback emergency, extensions absentes).
  const pvPanelsInScene = built.scene?.pvPanels?.length ?? 0;
  let panelsAvailableInEngine = 0;
  if (built.ok && built.scene != null && pvPanelsInScene === 0 && options?.getAllPanels) {
    try {
      const panelsFromEngine = options.getAllPanels();
      panelsAvailableInEngine = Array.isArray(panelsFromEngine) ? panelsFromEngine.length : 0;
    } catch {
      /* défensif — ne jamais laisser le garde crasher le pipeline */
    }
  }
  const isTransientZeroPanelResult = built.ok && built.scene != null && pvPanelsInScene === 0 && panelsAvailableInEngine > 0;

  const shouldCacheStructuralResult =
    built.ok && built.scene != null && !isTransientZeroPanelResult;

  if (shouldCacheStructuralResult) {
    structuralCache.set(key, built);
  }
  pipelineInvocationCountBySignature.set(key, (pipelineInvocationCountBySignature.get(key) ?? 0) + 1);

  if (import.meta.env.DEV) {
    console.log("[3D-RUNTIME][PIPELINE]", {
      cacheHit: false,
      signature: key,
      ok: built.ok,
      hasScene: built.scene != null,
      autopsyLegacyPath: built.autopsyLegacyPath ?? "unknown",
      lastBuildReason: "full_structural_pipeline",
      ...(isTransientZeroPanelResult
        ? { cacheSkipped: true, cacheSkipReason: "transient_zero_panel_active_block", panelsAvailableInEngine }
        : {}),
    });
    if (isTransientZeroPanelResult) {
      console.warn(
        "[3D-RUNTIME][CACHE GUARD] Scène 0-panneau non mise en cache : bloc actif non figé détecté.",
        { panelsAvailableInEngine, pvPanelsInScene, signature: key },
      );
    } else if (!shouldCacheStructuralResult) {
      console.warn(
        "[3D-RUNTIME][CACHE GUARD] Pipeline officiel en échec ou résultat non stabilisable : non mis en cache (nouvelle tentative au prochain appel même signature).",
        { ok: built.ok, hasScene: built.scene != null, signature: key },
      );
    }
  }

  return {
    ...built,
    sceneStructuralSignatures: sigs,
    sceneSyncDiagnostics: finalizeDiagnostics({
      key,
      sigs,
      ok: built.ok,
      hasScene: built.scene != null,
      usedSceneCache: false,
      lastBuildReason: "full_structural_pipeline",
      prevDisplayed,
      structuralEventDetail,
    }),
  };
}
