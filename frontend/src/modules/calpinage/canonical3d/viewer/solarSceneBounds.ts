/**
 * Boîte englobante monde à partir d’une SolarScene3D — pour caméra / repère (lecture géométrie uniquement).
 */

import * as THREE from "three";
import { imagePxToWorldHorizontalM } from "../builder/worldMapping";
import type { SolarScene3D } from "../types/solarScene3d";
import { isCalpinage3DRuntimeDebugEnabled, logCalpinage3DDebug } from "../../core/calpinage3dRuntimeDebug";

export function computeSolarSceneBoundingBox(scene: SolarScene3D): THREE.Box3 {
  const box = new THREE.Box3();
  let roofCornerCount = 0;
  let obstacleVertCount = 0;
  let extensionVertCount = 0;
  let panelCornerCount = 0;

  const expand = (x: number, y: number, z: number) => {
    box.expandByPoint(new THREE.Vector3(x, y, z));
  };

  for (const patch of scene.roofModel.roofPlanePatches) {
    for (const c of patch.cornersWorld) {
      expand(c.x, c.y, c.z);
      roofCornerCount++;
    }
  }

  const shell = scene.buildingShell;
  if (shell?.vertices?.length) {
    for (const v of shell.vertices) {
      const p = v.position;
      expand(p.x, p.y, p.z);
    }
  }

  const addVolume = (
    vol: { vertices: readonly { position: { x: number; y: number; z: number } }[] },
    kind: "obstacle" | "extension",
  ) => {
    for (const v of vol.vertices) {
      expand(v.position.x, v.position.y, v.position.z);
      if (kind === "obstacle") obstacleVertCount++;
      else extensionVertCount++;
    }
  };
  for (const v of scene.obstacleVolumes) addVolume(v, "obstacle");
  for (const v of scene.extensionVolumes) addVolume(v, "extension");

  for (const panel of scene.pvPanels) {
    for (const c of panel.corners3D) {
      expand(c.x, c.y, c.z);
      panelCornerCount++;
    }
  }

  const invalidBeforeFallback = !isFinite(box.min.x) || box.isEmpty();
  if (invalidBeforeFallback) {
    box.setFromCenterAndSize(new THREE.Vector3(0, 0, 5), new THREE.Vector3(40, 40, 10));
  }

  if (isCalpinage3DRuntimeDebugEnabled()) {
    logCalpinage3DDebug("viewer bbox", {
      roofPatchCount: scene.roofModel.roofPlanePatches.length,
      roofCornerExpandCount: roofCornerCount,
      obstacleVolumeCount: scene.obstacleVolumes.length,
      obstacleVertexExpandCount: obstacleVertCount,
      extensionVolumeCount: scene.extensionVolumes.length,
      extensionVertexExpandCount: extensionVertCount,
      pvPanelCount: scene.pvPanels.length,
      panelCornerExpandCount: panelCornerCount,
      bboxMin: { x: box.min.x, y: box.min.y, z: box.min.z },
      bboxMax: { x: box.max.x, y: box.max.y, z: box.max.z },
      fallbackUsed: invalidBeforeFallback,
      wasEmptyOrNonFiniteMinBeforeFallback: invalidBeforeFallback,
    });
  }

  return box;
}

/**
 * Étend une bbox géométrie pour le **cadrage caméra** avec les 4 coins de l’image satellite
 * projetés par `imagePxToWorldHorizontalM` (même loi que toit / sol). Ne modifie aucune géométrie.
 * Z des points d’extension : `geometryBox.min.z` pour n’ajouter que de l’emprise XY.
 */
export function extendBoundingBoxWithSatelliteImageFootprint(
  geometryBox: THREE.Box3,
  widthPx: number,
  heightPx: number,
  metersPerPixel: number,
  northAngleDeg: number,
): THREE.Box3 {
  if (
    !Number.isFinite(widthPx) ||
    !Number.isFinite(heightPx) ||
    widthPx <= 0 ||
    heightPx <= 0 ||
    !Number.isFinite(metersPerPixel) ||
    metersPerPixel <= 0 ||
    !Number.isFinite(northAngleDeg)
  ) {
    return geometryBox;
  }

  const out = geometryBox.clone();
  const zRef = out.min.z;
  const cornersPx: readonly [number, number][] = [
    [0, 0],
    [widthPx, 0],
    [widthPx, heightPx],
    [0, heightPx],
  ];
  for (const [xPx, yPx] of cornersPx) {
    const p = imagePxToWorldHorizontalM(xPx, yPx, metersPerPixel, northAngleDeg);
    out.expandByPoint(new THREE.Vector3(p.x, p.y, zRef));
  }
  return out;
}
