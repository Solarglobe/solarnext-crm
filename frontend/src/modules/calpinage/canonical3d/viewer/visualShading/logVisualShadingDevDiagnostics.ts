import type { SolarScene3D } from "../../types/solarScene3d";
import { getEffectivePanelVisualShading } from "./effectivePanelVisualShading";

const PREFIX = "[Canonical3D][VisualShading]";

/**
 * Un log unique en dev : comptage matching / manquants (pas de spam).
 */
export function logVisualShadingDevDiagnosticsOnce(scene: SolarScene3D, key: string): void {
  if (import.meta.env?.DEV !== true) return;
  if (import.meta.env?.MODE === "test") return;

  const seen = (globalThis as unknown as { __snVisualShadingLog?: Set<string> }).__snVisualShadingLog ?? new Set<string>();
  (globalThis as unknown as { __snVisualShadingLog: Set<string> }).__snVisualShadingLog = seen;
  if (seen.has(key)) return;
  seen.add(key);

  const ids = scene.pvPanels.map((p) => String(p.id));
  let matched = 0;
  let missing = 0;
  let invalid = 0;
  for (const id of ids) {
    const v = getEffectivePanelVisualShading(id, scene);
    if (v.state === "AVAILABLE") matched++;
    else if (v.state === "INVALID") invalid++;
    else missing++;
  }

  // eslint-disable-next-line no-console
  console.info(
    `${PREFIX} panels=${ids.length} matched=${matched} missing=${missing} invalid=${invalid} sceneKey=${key}`,
  );
}
