/**
 * Chargement scène pour la sandbox 3D dev — lecture seule, aucune persistance métier.
 *
 * - mode=demo (défaut) : `buildDemoSolarScene3D`
 * - mode=runtime : `buildSolarScene3DFromCalpinageRuntime` avec :
 *   - `?fixture=<id>` → batterie `runtime3DFixtureBattery` (prioritaire sur la fixture minimale),
 *   - sinon JSON `sessionStorage` clé `solarnext_dev_3d_runtime_json`,
 *   - sinon fixture minimale.
 *
 * `Dev3DPage` : `?parity=1` affiche `compareLegacyAndCanonical3D` (JSON + console) quand `runtimeBuildInput` est défini.
 *
 * Injection optionnelle (dev) : `sessionStorage.setItem("solarnext_dev_3d_runtime_json", JSON.stringify(runtime))`
 */

import { useMemo } from "react";
import { useSearchParams } from "react-router-dom";
import type { SolarScene3D } from "../types/solarScene3d";
import { buildDemoSolarScene3D } from "../viewer/demoSolarScene3d";
import { buildSolarScene3DFromCalpinageRuntime } from "../buildSolarScene3DFromCalpinageRuntime";
import { minimalCalpinageRuntimeFixture } from "./minimalCalpinageRuntimeFixture";
import { getRuntime3DFixture } from "./runtime3DFixtureBattery";

const RUNTIME_SESSION_KEY = "solarnext_dev_3d_runtime_json";

export type Dev3DSceneMode = "demo" | "runtime";

/** Entrée commune builder canonical + rapport de parité legacy (sandbox dev). */
export type Dev3DRuntimeBuildInput = {
  readonly sceneId: string;
  readonly runtime: Record<string, unknown>;
  readonly getAllPanels?: () => unknown[];
};

export type Dev3DSceneState =
  | {
      readonly status: "ok";
      readonly mode: Dev3DSceneMode;
      readonly scene: SolarScene3D;
      readonly runtimeSource: "demo" | "fixture" | "sessionStorage" | "battery";
      /** Présent en mode runtime pour `compareLegacyAndCanonical3D` (parity=1). */
      readonly runtimeBuildInput?: Dev3DRuntimeBuildInput;
    }
  | {
      readonly status: "error";
      readonly mode: Dev3DSceneMode;
      readonly scene: null;
      readonly message: string;
      readonly runtimeSource: "fixture" | "sessionStorage" | "battery";
      readonly runtimeBuildInput?: Dev3DRuntimeBuildInput;
    };

type ParsedSession =
  | { kind: "empty" }
  | { kind: "error"; message: string }
  | { kind: "ok"; value: object };

function parseRuntimeFromSessionStorage(): ParsedSession {
  if (typeof sessionStorage === "undefined") return { kind: "empty" };
  try {
    const raw = sessionStorage.getItem(RUNTIME_SESSION_KEY);
    if (raw == null || raw.trim() === "") return { kind: "empty" };
    const v = JSON.parse(raw) as unknown;
    if (v == null || typeof v !== "object") {
      return { kind: "error", message: "JSON runtime : objet racine attendu" };
    }
    return { kind: "ok", value: v as object };
  } catch (e) {
    const m = e instanceof Error ? e.message : String(e);
    return { kind: "error", message: `JSON invalide : ${m}` };
  }
}

export function useDev3DScene(): Dev3DSceneState {
  const [params] = useSearchParams();
  const modeParam = params.get("mode");
  const fixtureParam = params.get("fixture");
  const mode: Dev3DSceneMode = modeParam === "runtime" ? "runtime" : "demo";

  return useMemo((): Dev3DSceneState => {
    if (mode === "demo") {
      return {
        status: "ok",
        mode: "demo",
        scene: buildDemoSolarScene3D(),
        runtimeSource: "demo",
        runtimeBuildInput: undefined,
      };
    }

    const batteryBundle = fixtureParam ? getRuntime3DFixture(fixtureParam) : undefined;
    if (batteryBundle) {
      const runtime = batteryBundle.runtime as Record<string, unknown>;
      const res = buildSolarScene3DFromCalpinageRuntime(runtime, {
        getAllPanels: () => batteryBundle.panels,
      });
      if (!res.ok || !res.scene) {
        const codes = res.diagnostics.errors.map((e) => e.code).join(", ");
        const err = res.diagnostics.errors[0]?.message ?? "build runtime échoué";
        return {
          status: "error",
          mode: "runtime",
          scene: null,
          message: codes ? `${err} [${codes}]` : err,
          runtimeSource: "battery",
          runtimeBuildInput: {
            sceneId: batteryBundle.id,
            runtime,
            getAllPanels: () => batteryBundle.panels,
          },
        };
      }
      return {
        status: "ok",
        mode: "runtime",
        scene: res.scene,
        runtimeSource: "battery",
        runtimeBuildInput: {
          sceneId: batteryBundle.id,
          runtime,
          getAllPanels: () => batteryBundle.panels,
        },
      };
    }

    const parsed = parseRuntimeFromSessionStorage();
    if (parsed.kind === "error") {
      return {
        status: "error",
        mode: "runtime",
        scene: null,
        message: parsed.message,
        runtimeSource: "sessionStorage",
        runtimeBuildInput: undefined,
      };
    }

    const runtime = (parsed.kind === "ok" ? parsed.value : minimalCalpinageRuntimeFixture) as Record<
      string,
      unknown
    >;
    const runtimeSource = parsed.kind === "ok" ? ("sessionStorage" as const) : ("fixture" as const);
    const sceneId = parsed.kind === "ok" ? "dev-session-storage" : "minimal-fixture";

    const res = buildSolarScene3DFromCalpinageRuntime(runtime);
    if (!res.ok || !res.scene) {
      const err = res.diagnostics.errors[0]?.message ?? "build runtime échoué";
      return {
        status: "error",
        mode: "runtime",
        scene: null,
        message: err,
        runtimeSource,
        runtimeBuildInput: { sceneId, runtime },
      };
    }

    return {
      status: "ok",
      mode: "runtime",
      scene: res.scene,
      runtimeSource,
      runtimeBuildInput: { sceneId, runtime },
    };
  }, [mode, fixtureParam]);
}
