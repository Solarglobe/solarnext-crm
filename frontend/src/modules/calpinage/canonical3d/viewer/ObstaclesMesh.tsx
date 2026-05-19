/**
 * ObstaclesMesh — rendu de tous les volumes obstacles (cheminées, velux, VMC, antennes…).
 *
 * Extrait de SolarScene3DViewer.tsx (A12 — Strangler Fig).
 * Correspond exactement au bloc `{visObs && obsGeos.map(...)}` (lignes 2874–3183 du viewer).
 *
 * Contrat :
 *   - Aucune logique métier (calcul, validation) — rendu pur.
 *   - Les géométries (geo, details) sont calculées dans le viewer via useMemo.
 *   - Le parent garde `visObs` comme guard : `{visObs && <ObstaclesMesh ... />}`.
 */

import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { Outlines } from "@react-three/drei";
import type { SolarScene3D } from "../types/solarScene3d";
import { getDepthOffset } from "./DepthRegistry";
import { KeepoutZone3D } from "./KeepoutZone3D";
import { getPremiumRoofObstacleSpec } from "../../catalog/roofObstaclePremiumCatalog";
import type { PremiumObstacleAssetPack } from "./obstacles/premiumObstacleAssets";
import type { PremiumPbrMaterialToken } from "./premium/premiumHouse3DSceneTypes";
import type { SceneInspectionSelection } from "./inspection/sceneInspectionTypes";
import {
  obstacleMaterialForVolume,
  premiumObstacleAssetMaterial,
  inspectData,
  isInspectSelected,
  roofModelingSkipOccluderRaycast,
} from "./viewerHelpers";
import { VIEWER_INSPECT_OUTLINE_HEX } from "./viewerVisualTokens";

// ── Types ─────────────────────────────────────────────────────────────────────

/**
 * Géométries détaillées d'un obstacle (sous-meshes, lignes premium, etc.).
 * Correspond au type de retour de `roofObstacleDetailGeometries` dans le viewer.
 */
export interface ObstacleDetailGeometries {
  readonly topCap: THREE.BufferGeometry | null;
  readonly chimneyFlueOpening: THREE.BufferGeometry | null;
  readonly edgeLines: THREE.BufferGeometry | null;
  readonly brickLines: THREE.BufferGeometry | null;
  readonly windowFrame: THREE.BufferGeometry | null;
  readonly windowHighlight: THREE.BufferGeometry | null;
  readonly windowSashLines: THREE.BufferGeometry | null;
  readonly windowOuterFrame: THREE.BufferGeometry | null;
  readonly vmcCap: THREE.BufferGeometry | null;
  readonly vmcVentLines: THREE.BufferGeometry | null;
  readonly antennaLines: THREE.BufferGeometry | null;
  readonly antennaBase: THREE.BufferGeometry | null;
  readonly roundChimneyBody: THREE.BufferGeometry | null;
  readonly roundChimneyLines: THREE.BufferGeometry | null;
  readonly keepoutHatch: THREE.BufferGeometry | null;
  readonly keepoutCornerMarks: THREE.BufferGeometry | null;
  readonly allEdgeLines: THREE.BufferGeometry | null;
  readonly shadowVolumeRays: THREE.BufferGeometry | null;
  readonly premiumAssets: PremiumObstacleAssetPack;
  readonly replaceBaseMesh: boolean;
}

export interface ObstacleGeoEntry {
  readonly id: string | number;
  readonly volume: SolarScene3D["obstacleVolumes"][number];
  readonly geo: THREE.BufferGeometry;
  readonly details: ObstacleDetailGeometries;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface ObstaclesMeshProps {
  /** Volumes obstacles avec leur géométrie — calculés dans le viewer via useMemo. */
  readonly obsGeos: readonly ObstacleGeoEntry[];
  /** Sélection inspection courante — pour surbrillance obstacle sélectionné. */
  readonly inspectionSelection: SceneInspectionSelection | null;
  /** Matériau de base obstacle (depuis assembly.materials.obstacle). */
  readonly mObs: PremiumPbrMaterialToken;
  /** Mode inspection : clic → panneau latéral métadonnées. */
  readonly inspectMode: boolean;
  /** Callback clic mesh inspectable. */
  readonly onInspectClick?: (e: ThreeEvent<MouseEvent>) => void;
  /**
   * Mode édition toiture — obstacles transparents au raycasting (le rayon
   * doit atteindre le maillage toiture en-dessous).
   */
  readonly roofModelingPassThroughOccluders: boolean;
  /**
   * Mode interaction pose PV 3D — même transparence au raycasting que
   * roofModelingPassThroughOccluders.
   */
  readonly pvLayout3DInteractionMode: boolean;
  /** Épaisseur contour inspection (dérivée de maxDim dans le viewer). */
  readonly outlineThickness: number;
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function ObstaclesMesh({
  obsGeos,
  inspectionSelection,
  mObs,
  inspectMode,
  onInspectClick,
  roofModelingPassThroughOccluders,
  pvLayout3DInteractionMode,
  outlineThickness,
}: ObstaclesMeshProps) {
  return (
    <>
      {obsGeos.map(({ id, volume, geo, details }) => {
        const sid = String(id);
        const sel = isInspectSelected(inspectionSelection, "OBSTACLE", sid);
        const mat = obstacleMaterialForVolume(volume, mObs);
        const premium = getPremiumRoofObstacleSpec(volume.visualKey);
        const hideBaseMesh = details.replaceBaseMesh;
        const premiumAssetActive = details.premiumAssets.meshes.length > 0 || details.premiumAssets.lines.length > 0;
        return (
          <mesh
            key={`obs-${id}`}
            userData={inspectData("OBSTACLE", sid)}
            geometry={geo}
            castShadow
            receiveShadow
            raycast={(roofModelingPassThroughOccluders || pvLayout3DInteractionMode) ? roofModelingSkipOccluderRaycast : undefined}
            onClick={inspectMode ? onInspectClick : undefined}
          >
            <meshStandardMaterial
              color={mat.color}
              metalness={mat.metalness}
              roughness={mat.roughness}
              flatShading={mat.flatShading}
              transparent={hideBaseMesh || mat.transparent}
              opacity={hideBaseMesh ? 0 : mat.opacity}
              depthWrite={!hideBaseMesh && !mat.transparent}
              side={mat.side}
              emissive={sel ? "#6d4c41" : mat.emissive}
              emissiveIntensity={hideBaseMesh ? 0 : sel ? 0.35 : volume.visualRole === "roof_window_flush" ? 0.08 : 0}
              polygonOffset
              {...getDepthOffset("BUILDING_SHELL")}
            />
            {details.premiumAssets.meshes.map((asset) => {
              const assetMat = premiumObstacleAssetMaterial(asset.role);
              return (
                <mesh
                  key={`premium-mesh-${id}-${asset.key}`}
                  geometry={asset.geometry}
                  renderOrder={asset.renderOrder}
                  castShadow={asset.castShadow}
                  receiveShadow={asset.receiveShadow}
                >
                  <meshStandardMaterial
                    color={assetMat.color}
                    metalness={assetMat.metalness}
                    roughness={assetMat.roughness}
                    transparent={assetMat.transparent}
                    opacity={assetMat.opacity}
                    emissive={assetMat.emissive}
                    emissiveIntensity={assetMat.emissiveIntensity}
                    side={THREE.DoubleSide}
                    polygonOffset
                    {...getDepthOffset("BUILDING_SHELL")}
                  />
                </mesh>
              );
            })}
            {details.premiumAssets.lines.map((asset) => (
              <lineSegments key={`premium-line-${id}-${asset.key}`} geometry={asset.geometry} renderOrder={asset.renderOrder}>
                <lineBasicMaterial
                  color={asset.color}
                  transparent
                  opacity={asset.opacity}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ))}
            {details.roundChimneyBody ? (
              <mesh geometry={details.roundChimneyBody} renderOrder={8} castShadow receiveShadow>
                <meshStandardMaterial
                  color="#b77961"
                  metalness={0.03}
                  roughness={0.82}
                  flatShading={false}
                  side={THREE.DoubleSide}
                  polygonOffset
                  {...getDepthOffset("BUILDING_SHELL")}
                />
              </mesh>
            ) : null}
            {details.roundChimneyLines ? (
              <lineSegments geometry={details.roundChimneyLines} renderOrder={9}>
                <lineBasicMaterial
                  color="#e0b195"
                  transparent
                  opacity={0.56}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.topCap && !premiumAssetActive ? (
              <mesh geometry={details.topCap} renderOrder={8}>
                <meshStandardMaterial
                  color={volume.kind === "chimney" ? "#8a5140" : "#8aa3b8"}
                  metalness={volume.kind === "chimney" ? 0.04 : 0.22}
                  roughness={volume.kind === "chimney" ? 0.78 : 0.2}
                  transparent={volume.visualRole === "roof_window_flush"}
                  opacity={volume.visualRole === "roof_window_flush" ? 0.58 : 1}
                  emissive={volume.visualRole === "roof_window_flush" ? "#1b3348" : "#000000"}
                  emissiveIntensity={volume.visualRole === "roof_window_flush" ? 0.04 : 0}
                  side={THREE.DoubleSide}
                  polygonOffset
                  {...getDepthOffset("BUILDING_SHELL")}
                />
              </mesh>
            ) : null}
            {details.chimneyFlueOpening ? (
              <mesh geometry={details.chimneyFlueOpening} renderOrder={11}>
                <meshStandardMaterial
                  color="#1c1412"
                  metalness={0.02}
                  roughness={0.88}
                  transparent
                  opacity={0.96}
                  emissive="#140f0d"
                  emissiveIntensity={0.06}
                  side={THREE.DoubleSide}
                  polygonOffset
                  {...getDepthOffset("ROOF_RIDGE")}
                />
              </mesh>
            ) : null}
            {details.brickLines ? (
              <lineSegments geometry={details.brickLines} renderOrder={9}>
                <lineBasicMaterial
                  color="#e0b195"
                  transparent
                  opacity={0.58}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.windowOuterFrame && !premiumAssetActive ? (
              <mesh geometry={details.windowOuterFrame} renderOrder={10}>
                <meshStandardMaterial
                  color="#b8c2cc"
                  metalness={0.22}
                  roughness={0.32}
                  transparent={false}
                  side={THREE.DoubleSide}
                  polygonOffset
                  {...getDepthOffset("BUILDING_SHELL")}
                />
              </mesh>
            ) : null}
            {details.edgeLines ? (
              <lineSegments geometry={details.edgeLines} renderOrder={10}>
                <lineBasicMaterial
                  color={
                    volume.kind === "chimney"
                      ? "#704332"
                      : volume.visualRole === "roof_window_flush" || volume.visualRole === "keepout_surface"
                        ? "#94a3b8"
                        : "#334155"
                  }
                  transparent
                  opacity={volume.visualRole === "keepout_surface" ? 0.52 : 0.72}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.allEdgeLines && volume.visualRole !== "roof_window_flush" ? (
              <lineSegments geometry={details.allEdgeLines} renderOrder={10}>
                <lineBasicMaterial
                  color={
                    premium?.rendering3d.lineColor ??
                    (volume.visualRole === "abstract_shadow_volume"
                      ? "#cbd5e1"
                      : volume.visualRole === "keepout_surface"
                        ? "#f59e0b"
                        : volume.kind === "hvac"
                          ? "#7dd3fc"
                          : volume.kind === "antenna"
                            ? "#e5e7eb"
                            : "#f8d1bd")
                  }
                  transparent
                  opacity={volume.visualRole === "abstract_shadow_volume" ? 0.5 : 0.68}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.keepoutHatch ? (
              <lineSegments geometry={details.keepoutHatch} renderOrder={12}>
                <lineBasicMaterial
                  color="#fbbf24"
                  transparent
                  opacity={0.86}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.keepoutCornerMarks ? (
              <lineSegments geometry={details.keepoutCornerMarks} renderOrder={13}>
                <lineBasicMaterial
                  color="#fff7ad"
                  transparent
                  opacity={0.95}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.shadowVolumeRays && !premiumAssetActive ? (
              <lineSegments geometry={details.shadowVolumeRays} renderOrder={7}>
                <lineBasicMaterial
                  color="#e2e8f0"
                  transparent
                  opacity={0.36}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.windowFrame && !premiumAssetActive ? (
              <mesh geometry={details.windowFrame} renderOrder={11}>
                <meshStandardMaterial
                  color="#7f8b96"
                  metalness={0.28}
                  roughness={0.34}
                  transparent={false}
                  side={THREE.DoubleSide}
                  polygonOffset
                  {...getDepthOffset("BUILDING_SHELL")}
                />
              </mesh>
            ) : null}
            {details.windowSashLines && !premiumAssetActive ? (
              <lineSegments geometry={details.windowSashLines} renderOrder={12}>
                <lineBasicMaterial
                  color="#d8e5ee"
                  transparent
                  opacity={0.72}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.windowHighlight && !premiumAssetActive ? (
              <lineSegments geometry={details.windowHighlight} renderOrder={12}>
                <lineBasicMaterial
                  color="#e0f2fe"
                  transparent
                  opacity={0.42}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.vmcCap && !premiumAssetActive ? (
              <mesh geometry={details.vmcCap} renderOrder={11}>
                <meshStandardMaterial
                  color="#e5edf4"
                  metalness={0.34}
                  roughness={0.36}
                  side={THREE.DoubleSide}
                />
              </mesh>
            ) : null}
            {details.vmcVentLines && !premiumAssetActive ? (
              <lineSegments geometry={details.vmcVentLines} renderOrder={12}>
                <lineBasicMaterial
                  color="#64748b"
                  transparent
                  opacity={0.82}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.antennaLines && !premiumAssetActive ? (
              <lineSegments geometry={details.antennaLines} renderOrder={12}>
                <lineBasicMaterial
                  color="#dbe4ee"
                  transparent
                  opacity={0.95}
                  toneMapped={false}
                  depthTest
                />
              </lineSegments>
            ) : null}
            {details.antennaBase && !premiumAssetActive ? (
              <mesh geometry={details.antennaBase} renderOrder={11} castShadow receiveShadow>
                <meshStandardMaterial
                  color="#475569"
                  metalness={0.58}
                  roughness={0.28}
                  side={THREE.DoubleSide}
                />
              </mesh>
            ) : null}
            {inspectMode && sel && (
              <Outlines
                thickness={outlineThickness}
                color={VIEWER_INSPECT_OUTLINE_HEX.obstacle}
                opacity={0.95}
                toneMapped={false}
              />
            )}
            {volume.visualRole === "keepout_surface" && <KeepoutZone3D vol={volume} />}
          </mesh>
        );
      })}
    </>
  );
}
