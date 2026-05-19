/**
 * diffSolarScene3D — diff incrémental entre deux versions de SolarScene3D.
 *
 * Permet à ViewerSceneContent de distinguer une mutation partielle (ajout/déplacement
 * de panneau, déplacement de sommet) d'un rebuild structurel complet, sans démonter
 * le sous-arbre React THREE (key= instable supprimée — D2).
 *
 * Règles :
 *   - Pure (no side-effects).
 *   - Retourne [FULL_REBUILD] si la topologie change (nb pans, obstacles, sommets).
 *   - Retourne [] si rien n'a changé (scene identique par référence ou valeur).
 *   - Pour les mutations fines (panneaux, vertex Z) : retourne les deltas sans FULL_REBUILD.
 */

import type { SolarScene3D } from "../types/solarScene3d";
import type { Vector3 } from "../types/primitives";

// ── Types publics ─────────────────────────────────────────────────────────────

export type SceneUpdateDelta =
  | { readonly type: "PANEL_ADDED"; readonly panelId: string }
  | {
      readonly type: "PANEL_MOVED";
      readonly panelId: string;
      readonly newCorners: readonly [Vector3, Vector3, Vector3, Vector3];
    }
  | { readonly type: "VERTEX_Z_CHANGED"; readonly vertexId: string; readonly newZ: number }
  | { readonly type: "FULL_REBUILD" };

// ── Helpers ───────────────────────────────────────────────────────────────────

const EPS = 1e-9;

function vec3Eq(a: Vector3, b: Vector3): boolean {
  return Math.abs(a.x - b.x) < EPS && Math.abs(a.y - b.y) < EPS && Math.abs(a.z - b.z) < EPS;
}

// ── Fonction principale ───────────────────────────────────────────────────────

/**
 * Compare `prev` et `next` et retourne la liste des deltas minimaux.
 *
 * Cas FULL_REBUILD (rebuilds complets — les useMemo deps les gèrent déjà) :
 *   - Premier chargement (prev === null)
 *   - Nombre de pans de toiture différent
 *   - Identité d'un pan changée (id différent à même position)
 *   - Nombre d'obstacles ou d'extensions différent
 *   - Nombre de sommets différent
 *   - Identité d'un sommet changée
 *   - Panneau supprimé (count next < count prev pour un id donné)
 *
 * Cas incrémentaux (sans FULL_REBUILD) :
 *   - Panneau ajouté → PANEL_ADDED
 *   - Coins d'un panneau existant déplacés → PANEL_MOVED
 *   - Z d'un sommet modifié → VERTEX_Z_CHANGED
 */
export function diffSolarScene3D(
  prev: SolarScene3D | null,
  next: SolarScene3D,
): SceneUpdateDelta[] {
  // Identité référence — aucun changement
  if (prev === next) return [];

  // Premier rendu — rebuild complet
  if (prev === null) return [{ type: "FULL_REBUILD" }];

  // ── Garde topologique : toiture ───────────────────────────────────────────
  if (prev.roofModel.roofPlanePatches.length !== next.roofModel.roofPlanePatches.length) {
    return [{ type: "FULL_REBUILD" }];
  }
  for (let i = 0; i < prev.roofModel.roofPlanePatches.length; i++) {
    if (prev.roofModel.roofPlanePatches[i].id !== next.roofModel.roofPlanePatches[i].id) {
      return [{ type: "FULL_REBUILD" }];
    }
  }

  // ── Garde topologique : obstacles / extensions ────────────────────────────
  if (
    prev.obstacleVolumes.length !== next.obstacleVolumes.length ||
    prev.extensionVolumes.length !== next.extensionVolumes.length
  ) {
    return [{ type: "FULL_REBUILD" }];
  }
  for (let i = 0; i < prev.obstacleVolumes.length; i++) {
    if (prev.obstacleVolumes[i].id !== next.obstacleVolumes[i].id) {
      return [{ type: "FULL_REBUILD" }];
    }
  }

  // ── Garde topologique : sommets ───────────────────────────────────────────
  if (prev.roofModel.roofVertices.length !== next.roofModel.roofVertices.length) {
    return [{ type: "FULL_REBUILD" }];
  }

  // ── Deltas vertex Z ───────────────────────────────────────────────────────
  const deltas: SceneUpdateDelta[] = [];
  const prevVertexById = new Map(prev.roofModel.roofVertices.map((v) => [String(v.id), v]));
  for (const nextV of next.roofModel.roofVertices) {
    const vid = String(nextV.id);
    const prevV = prevVertexById.get(vid);
    if (!prevV) {
      // Identité de sommet changée → topologie différente
      return [{ type: "FULL_REBUILD" }];
    }
    if (Math.abs(prevV.position.z - nextV.position.z) >= EPS) {
      deltas.push({ type: "VERTEX_Z_CHANGED", vertexId: vid, newZ: nextV.position.z });
    }
  }

  // ── Deltas panneaux ───────────────────────────────────────────────────────
  const prevPanelById = new Map(prev.pvPanels.map((p) => [String(p.id), p]));
  const nextPanelIds = new Set(next.pvPanels.map((p) => String(p.id)));

  // Panneau supprimé → FULL_REBUILD (InstancedMesh doit être reconstruit)
  for (const prevPanel of prev.pvPanels) {
    if (!nextPanelIds.has(String(prevPanel.id))) {
      return [{ type: "FULL_REBUILD" }];
    }
  }

  // Panneau ajouté ou déplacé
  for (const nextPanel of next.pvPanels) {
    const pid = String(nextPanel.id);
    const prevPanel = prevPanelById.get(pid);
    if (!prevPanel) {
      deltas.push({ type: "PANEL_ADDED", panelId: pid });
    } else {
      const corners = nextPanel.corners3D;
      const prevCorners = prevPanel.corners3D;
      const moved =
        !vec3Eq(corners[0], prevCorners[0]) ||
        !vec3Eq(corners[1], prevCorners[1]) ||
        !vec3Eq(corners[2], prevCorners[2]) ||
        !vec3Eq(corners[3], prevCorners[3]);
      if (moved) {
        deltas.push({
          type: "PANEL_MOVED",
          panelId: pid,
          newCorners: corners as readonly [Vector3, Vector3, Vector3, Vector3],
        });
      }
    }
  }

  return deltas;
}
