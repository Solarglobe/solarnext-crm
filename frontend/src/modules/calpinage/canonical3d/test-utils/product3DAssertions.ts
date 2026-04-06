/**
 * Invariants produit 3D (structurels, sans rendu pixel) — Prompt 27.
 * S’appuie sur la même bbox / cadrage que le viewer officiel lorsque c’est pertinent.
 */

import * as THREE from "three";
import type { SolarScene3D } from "../types/solarScene3d";
import { computeSolarSceneBoundingBox } from "../viewer/solarSceneBounds";
import { computeViewerFraming } from "../viewer/viewerFraming";
import {
  VIEWER_MAX_DISTANCE_RADIUS_RATIO,
  VIEWER_MIN_DISTANCE_RADIUS_RATIO,
} from "../viewer/viewerConstants";
import { validate2DTo3DCoherence } from "../validation/validate2DTo3DCoherence";

const EPS_DIM_M = 0.08;
const EPS_CENTER_M = 0.02;
const MIN_ROOF_FOOTPRINT_M = 0.5;
const MIN_SLOPE_TILT_DEG = 0.35;
const MIN_CORNER_Z_SPAN_M = 0.04;
const MAX_HORIZONTAL_NORMAL_Z = 0.985;

function isFinite3(x: number, y: number, z: number): boolean {
  return Number.isFinite(x) && Number.isFinite(y) && Number.isFinite(z);
}

/** Bbox monde à partir des seuls patches toiture (pas de repli viewer). */
export function computeRoofOnlyBoundingBox(scene: SolarScene3D): THREE.Box3 | null {
  const box = new THREE.Box3();
  for (const patch of scene.roofModel.roofPlanePatches) {
    for (const c of patch.cornersWorld) {
      if (!isFinite3(c.x, c.y, c.z)) continue;
      box.expandByPoint(new THREE.Vector3(c.x, c.y, c.z));
    }
  }
  if (!Number.isFinite(box.min.x) || box.isEmpty()) return null;
  return box;
}

/**
 * Toiture « visible » produit : au moins un patch avec empreinte horizontale non dégénérée.
 */
export function assertProductSceneHasVisibleHouse(scene: SolarScene3D): void {
  const patches = scene.roofModel?.roofPlanePatches;
  if (!Array.isArray(patches) || patches.length === 0) {
    throw new Error("PRODUCT_3D_NO_ROOF_PATCHES: aucun roofPlanePatch — maison non rendable");
  }
  const roofBox = computeRoofOnlyBoundingBox(scene);
  if (!roofBox) {
    throw new Error("PRODUCT_3D_ROOF_BBOX_EMPTY: sommets toiture absents ou non finis");
  }
  const size = new THREE.Vector3();
  roofBox.getSize(size);
  const footprint = Math.hypot(size.x, size.y);
  if (footprint < MIN_ROOF_FOOTPRINT_M) {
    throw new Error(
      `PRODUCT_3D_ROOF_TOO_SMALL: empreinte ${footprint.toFixed(4)} m — suspect pour une vue bâtiment`,
    );
  }
}

/**
 * Cadrage identique au viewer : centre cible = centre bbox scène complète ; distance caméra cohérente avec la taille.
 */
export function assertProductSceneCameraFramingCoherent(
  scene: SolarScene3D,
  aspect = 16 / 9,
): void {
  const box = computeSolarSceneBoundingBox(scene);
  if (box.isEmpty() || !Number.isFinite(box.min.x)) {
    throw new Error("PRODUCT_3D_SCENE_BBOX_INVALID: bbox scène vide ou non finie");
  }
  const center = new THREE.Vector3();
  box.getCenter(center);
  const sphere = new THREE.Sphere();
  box.getBoundingSphere(sphere);
  const radius = Math.max(sphere.radius, 1e-4);

  const f = computeViewerFraming(box, aspect);
  const dist = f.position.distanceTo(f.target);
  const errTarget = f.target.distanceTo(center);
  if (errTarget > EPS_CENTER_M) {
    throw new Error(
      `PRODUCT_3D_CAMERA_TARGET_OFF_CENTER: écart cible vs centre bbox ${errTarget.toFixed(4)} m`,
    );
  }
  if (dist < radius * VIEWER_MIN_DISTANCE_RADIUS_RATIO * 0.85) {
    throw new Error("PRODUCT_3D_CAMERA_TOO_CLOSE: distance caméra suspecte vs taille bâtiment");
  }
  if (dist > radius * VIEWER_MAX_DISTANCE_RADIUS_RATIO * 2.8) {
    throw new Error("PRODUCT_3D_CAMERA_TOO_FAR: distance caméra suspecte vs taille bâtiment");
  }
  if (!(f.far > f.near && f.near > 0)) {
    throw new Error("PRODUCT_3D_CAMERA_CLIPPING_RANGE_INVALID: near/far incohérents");
  }
}

/** Alias lisible côté tests produit (Prompt 27). */
export const assertProductCameraFramingCoherent = assertProductSceneCameraFramingCoherent;

/**
 * Au moins un pan montre une pente / relief non plat (après passage pipeline).
 */
export function assertProductRoofNotGloballyFlatWhenSlopedExpected(scene: SolarScene3D): void {
  let ok = false;
  for (const p of scene.roofModel.roofPlanePatches) {
    const tilt = typeof p.tiltDeg === "number" && Number.isFinite(p.tiltDeg) ? Math.abs(p.tiltDeg) : 0;
    if (tilt >= MIN_SLOPE_TILT_DEG) {
      ok = true;
      break;
    }
    const zs = p.cornersWorld.map((c) => c.z).filter((z) => Number.isFinite(z));
    if (zs.length >= 2) {
      const zMin = Math.min(...zs);
      const zMax = Math.max(...zs);
      if (zMax - zMin >= MIN_CORNER_Z_SPAN_M) {
        ok = true;
        break;
      }
    }
    const nz = p.normal?.z;
    if (typeof nz === "number" && Number.isFinite(nz) && Math.abs(nz) < MAX_HORIZONTAL_NORMAL_Z) {
      ok = true;
      break;
    }
  }
  if (!ok) {
    throw new Error(
      "PRODUCT_3D_ROOF_APPEARS_FLAT: aucun pan avec tilt, relief Z ou normale oblique détecté — risque d’aplatissement",
    );
  }
}

/**
 * Panneaux présents : cohérence 2D→3D sans erreur PANEL ; pas de patch fantôme.
 */
export function assertProductPanelsAnchoredWhenPresent(scene: SolarScene3D): void {
  if (scene.pvPanels.length === 0) return;
  const r = validate2DTo3DCoherence(scene);
  const panelErrors = r.issues.filter((i) => i.scope === "PANEL" && i.severity === "ERROR");
  if (panelErrors.length > 0) {
    const codes = panelErrors.map((i) => i.code).join(", ");
    throw new Error(`PRODUCT_3D_PANEL_ANCHOR_ERRORS: ${codes}`);
  }
}

/**
 * Obstacles / extensions : erreurs SHADOW_VOLUME / OBSTACLE bloquantes + volume vertical plausible.
 */
export function assertProductObstaclesAnchoredWhenPresent(scene: SolarScene3D): void {
  const vols = [...scene.obstacleVolumes, ...scene.extensionVolumes];
  if (vols.length === 0) return;
  const r = validate2DTo3DCoherence(scene);
  const volErrors = r.issues.filter(
    (i) =>
      (i.scope === "OBSTACLE" || i.scope === "SHADOW_VOLUME") && i.severity === "ERROR",
  );
  if (volErrors.length > 0) {
    const codes = volErrors.map((i) => i.code).join(", ");
    throw new Error(`PRODUCT_3D_VOLUME_ANCHOR_ERRORS: ${codes}`);
  }
  for (const v of vols) {
    const verts = v.vertices;
    if (!verts?.length) continue;
    const zs = verts.map((x) => x.position.z).filter((z) => Number.isFinite(z));
    if (zs.length < 2) continue;
    const zMin = Math.min(...zs);
    const zMax = Math.max(...zs);
    if (zMax <= zMin + EPS_DIM_M) {
      throw new Error(
        `PRODUCT_3D_VOLUME_Z_DEGENERATE: volume ${v.id} sans épaisseur verticale plausible`,
      );
    }
  }
}
