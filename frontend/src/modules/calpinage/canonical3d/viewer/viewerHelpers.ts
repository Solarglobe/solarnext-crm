/**
 * viewerHelpers — fonctions pures partagées entre SolarScene3DViewer et les sous-composants
 * extraits par le Strangler Fig (A12) : ObstaclesMesh, RoofPansMesh, PvPanelsLayer.
 *
 * Règles :
 *   - Aucune dépendance React (pas de hooks, pas de JSX).
 *   - Toutes les fonctions sont pures (no side-effects) ou noop explicite.
 *   - Importées dans le viewer ET dans les composants fils — source de vérité unique.
 */

import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import type { SolarScene3D } from "../types/solarScene3d";
import { getPremiumRoofObstacleSpec } from "../../catalog/roofObstaclePremiumCatalog";
import type { PremiumObstacleBodyRole } from "./obstacles/premiumObstacleAssets";
import {
  INSPECT_USERDATA_KEY,
  type SceneInspectableKind,
  type SceneInspectionSelection,
  type SceneInspectMeshRole,
  type SceneInspectUserData,
  type ScenePickHit,
} from "./inspection/sceneInspectionTypes";

// ── Raycast helpers ───────────────────────────────────────────────────────────

/**
 * @react-three/fiber : `gl` exposé sur l'événement mais absent des types ThreeEvent — cast explicite documenté.
 */
export function r3fGl(e: ThreeEvent<PointerEvent | MouseEvent>): THREE.WebGLRenderer {
  return (e as ThreeEvent<PointerEvent | MouseEvent> & { gl: THREE.WebGLRenderer }).gl;
}

/**
 * En mode édition sommet toit : laisse le rayon atteindre le maillage toiture
 * (ignore PV / obstacles / extensions). Utilisé comme `raycast` prop sur les meshes
 * qui doivent être transparents au picking en mode modélisation toiture.
 */
export function roofModelingSkipOccluderRaycast(
  this: THREE.Object3D,
  _raycaster: THREE.Raycaster,
  _intersects: THREE.Intersection[],
): void {
  void this;
  void _raycaster;
  void _intersects;
}

// ── Matériaux obstacles ───────────────────────────────────────────────────────

/**
 * Résout les paramètres PBR pour un volume obstacle.
 * Priorité : catalogue premium (visualKey) > rôle visuel > kind > fallback.
 */
export function obstacleMaterialForVolume(
  vol: SolarScene3D["obstacleVolumes"][number],
  fallback: {
    readonly color: number;
    readonly metalness: number;
    readonly roughness: number;
    readonly flatShading?: boolean;
  },
): {
  readonly color: number | string;
  readonly metalness: number;
  readonly roughness: number;
  readonly flatShading: boolean;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly emissive: string;
  readonly side: THREE.Side;
} {
  const premium = getPremiumRoofObstacleSpec(vol.visualKey);
  if (premium) {
    const profile = premium.rendering3d.materialProfile;
    return {
      color: premium.rendering3d.baseColor,
      metalness:
        profile === "brushed_metal" ? 0.58 :
        profile === "painted_metal" || profile === "roof_edge_metal" ? 0.32 :
        profile === "glass" ? 0.12 : 0.03,
      roughness:
        profile === "glass" ? 0.18 :
        profile === "brushed_metal" ? 0.3 :
        profile === "shadow_volume" ? 0.85 :
        profile === "keepout_warning" ? 0.62 : 0.78,
      flatShading: profile === "brick" || profile === "dark_brick" || profile === "shadow_volume",
      transparent: premium.rendering3d.transparent,
      opacity: premium.rendering3d.opacity,
      emissive:
        profile === "glass" ? "#102a44" :
        profile === "keepout_warning" ? "#3b1f05" :
        profile === "shadow_volume" ? "#0f172a" : "#000000",
      side: THREE.DoubleSide,
    };
  }
  if (vol.visualRole === "roof_window_flush" || vol.kind === "skylight") {
    return {
      color: "#6f879b",
      metalness: 0.12,
      roughness: 0.18,
      flatShading: false,
      transparent: true,
      opacity: 0.52,
      emissive: "#102a44",
      side: THREE.DoubleSide,
    };
  }
  if (vol.visualRole === "keepout_surface") {
    return {
      color: vol.kind === "other" ? "#f59e0b" : "#111827",
      metalness: 0.02,
      roughness: 0.62,
      flatShading: false,
      transparent: true,
      opacity: vol.kind === "other" ? 0.24 : 0.78,
      emissive: vol.kind === "other" ? "#3b1f05" : "#050816",
      side: THREE.DoubleSide,
    };
  }
  if (vol.visualRole === "abstract_shadow_volume") {
    return {
      color: "#64748b",
      metalness: 0.02,
      roughness: 0.85,
      flatShading: true,
      transparent: true,
      opacity: 0.28,
      emissive: "#0f172a",
      side: THREE.DoubleSide,
    };
  }
  if (vol.kind === "chimney") {
    return {
      color: "#b77961",
      metalness: 0.03,
      roughness: 0.88,
      flatShading: true,
      transparent: false,
      opacity: 1,
      emissive: "#000000",
      side: THREE.DoubleSide,
    };
  }
  if (vol.kind === "hvac" || vol.kind === "antenna") {
    return {
      color: vol.kind === "antenna" ? "#4b5563" : "#d9e2ea",
      metalness: vol.kind === "antenna" ? 0.52 : 0.34,
      roughness: vol.kind === "antenna" ? 0.3 : 0.42,
      flatShading: false,
      transparent: vol.kind === "antenna",
      opacity: vol.kind === "antenna" ? 0.18 : 1,
      emissive: "#000000",
      side: THREE.DoubleSide,
    };
  }
  return {
    color: fallback.color,
    metalness: fallback.metalness,
    roughness: fallback.roughness,
    flatShading: fallback.flatShading ?? false,
    transparent: false,
    opacity: 1,
    emissive: "#000000",
    side: THREE.DoubleSide,
  };
}

/**
 * Résout les paramètres PBR pour un asset premium (sous-mesh d'un obstacle).
 */
export function premiumObstacleAssetMaterial(role: PremiumObstacleBodyRole): {
  readonly color: string;
  readonly metalness: number;
  readonly roughness: number;
  readonly transparent: boolean;
  readonly opacity: number;
  readonly emissive: string;
  readonly emissiveIntensity: number;
} {
  switch (role) {
    case "brick":
      return { color: "#b77961", metalness: 0.03, roughness: 0.82, transparent: false, opacity: 1, emissive: "#000000", emissiveIntensity: 0 };
    case "metal":
      return { color: "#7f8b96", metalness: 0.42, roughness: 0.32, transparent: false, opacity: 1, emissive: "#000000", emissiveIntensity: 0 };
    case "cap":
      return { color: "#d9e2ea", metalness: 0.34, roughness: 0.36, transparent: false, opacity: 1, emissive: "#000000", emissiveIntensity: 0 };
    case "darkInset":
      return { color: "#1c1412", metalness: 0.02, roughness: 0.88, transparent: true, opacity: 0.96, emissive: "#140f0d", emissiveIntensity: 0.06 };
    case "glass":
      return { color: "#6f879b", metalness: 0.12, roughness: 0.18, transparent: true, opacity: 0.56, emissive: "#102a44", emissiveIntensity: 0.08 };
    case "warning":
      return { color: "#f59e0b", metalness: 0.02, roughness: 0.62, transparent: true, opacity: 0.24, emissive: "#3b1f05", emissiveIntensity: 0 };
    case "shadow":
      return { color: "#64748b", metalness: 0.02, roughness: 0.85, transparent: true, opacity: 0.28, emissive: "#0f172a", emissiveIntensity: 0 };
  }
}

// ── Inspection helpers ────────────────────────────────────────────────────────

/**
 * Construit le `userData` THREE.js pour un mesh inspectable.
 * Doit être appliqué sur `mesh.userData` pour que le système d'inspection
 * puisse résoudre { kind, id } depuis l'event raycasting.
 */
export function inspectData(
  kind: SceneInspectableKind,
  id: string,
  meshRole?: SceneInspectMeshRole,
): Record<string, unknown> {
  const payload: SceneInspectUserData =
    meshRole != null ? { kind, id: String(id), meshRole } : { kind, id: String(id) };
  return { [INSPECT_USERDATA_KEY]: payload };
}

/**
 * Retourne `true` si la sélection courante correspond à (kind, id).
 */
export function isInspectSelected(
  sel: SceneInspectionSelection | null,
  kind: SceneInspectableKind,
  id: string,
): boolean {
  return sel != null && sel.kind === kind && String(sel.id) === String(id);
}

/**
 * Retourne `true` si le hit de picking correspond au pan `panId`.
 */
export function isPanHittingPatchId(hit: ScenePickHit | null, panId: string): boolean {
  if (hit == null) return false;
  if (hit.kind === "roof_patch") return String(hit.roofPlanePatchId) === String(panId);
  if (hit.kind === "roof_vertex") return String(hit.roofPlanePatchId) === String(panId);
  return false;
}
