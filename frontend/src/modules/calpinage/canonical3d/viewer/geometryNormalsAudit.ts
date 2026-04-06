/**
 * Audit léger des normales côté viewer (dev uniquement) — pas de correction géométrique.
 */

import * as THREE from "three";

function warnDev(message: string, extra?: Record<string, unknown>): void {
  if (typeof import.meta !== "undefined" && import.meta.env?.PROD) return;
  // eslint-disable-next-line no-console
  console.warn(`[SolarScene3DViewer][normals] ${message}`, extra ?? "");
}

/**
 * Vérifie présence et longueur des normales (sommaire). À appeler en dev après création des géométries.
 */
export function logIfGeometryNormalsSuspect(geometries: readonly THREE.BufferGeometry[], context: string): void {
  if (typeof import.meta !== "undefined" && import.meta.env?.PROD) return;

  for (let i = 0; i < geometries.length; i++) {
    const g = geometries[i]!;
    const attr = g.getAttribute("normal") as THREE.BufferAttribute | undefined;
    if (!attr || attr.count === 0) {
      warnDev(`Geometry #${i} (${context}) : attribut normal absent ou vide`, { uuid: g.uuid });
      continue;
    }
    const arr = attr.array as Float32Array;
    let bad = 0;
    for (let v = 0; v < attr.count; v++) {
      const x = arr[v * 3]!;
      const y = arr[v * 3 + 1]!;
      const z = arr[v * 3 + 2]!;
      const len = Math.hypot(x, y, z);
      if (!Number.isFinite(len) || len < 1e-8) bad++;
    }
    if (bad > 0) {
      warnDev(`Geometry #${i} (${context}) : ${bad} normale(s) nulle(s) ou non finie(s)`, { uuid: g.uuid });
    }
  }
}
