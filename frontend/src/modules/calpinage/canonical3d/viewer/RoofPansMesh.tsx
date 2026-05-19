/**
 * RoofPansMesh — rendu des pans de toiture, contours et faîtages.
 *
 * Extrait de SolarScene3DViewer.tsx (A12 — Strangler Fig).
 * Correspond exactement au bloc `{visRoof && roofGeos.map(...)} + roofClosureGeo + edges + ridges`
 * (lignes 2735–2873 du viewer).
 *
 * Contrat :
 *   - Aucune logique métier — rendu pur.
 *   - Le parent garde `visRoof` comme guard : `{visRoof && <RoofPansMesh ... />}`.
 *   - `panVertexSelectionMarker` est passé comme ReactNode car produit par useMemo dans le viewer.
 */

import type { ReactNode } from "react";
import * as THREE from "three";
import type { ThreeEvent } from "@react-three/fiber";
import { Outlines } from "@react-three/drei";
import { RoofContourLine2 } from "./RoofContourLine2";
import { getDepthOffset } from "./DepthRegistry";
import type { PremiumPbrMaterialToken, PremiumLineMaterialToken } from "./premium/premiumHouse3DSceneTypes";
import type { SceneInspectionSelection, ScenePickHit } from "./inspection/sceneInspectionTypes";
import { pickSceneHitFromIntersections } from "./inspection/pickInspectableIntersection";
import { pickSceneHitForRoofVertexModeling } from "./inspection/pickRoofVertexModelingPick";
import {
  SOLARNEXT_3D_PREMIUM_THEME,
  VIEWER_INSPECT_OUTLINE_HEX,
} from "./viewerVisualTokens";
import {
  inspectData,
  isInspectSelected,
  isPanHittingPatchId,
  r3fGl,
} from "./viewerHelpers";

// ── Types locaux ──────────────────────────────────────────────────────────────

type RoofModelingPointerUi =
  | null
  | {
      readonly clientX: number;
      readonly clientY: number;
      readonly label: string;
      readonly cursor?: string;
    };

// ── Props ─────────────────────────────────────────────────────────────────────

export interface RoofPansMeshProps {
  /** Géométries des pans de toiture — calculées dans le viewer via useMemo. */
  readonly roofGeos: readonly { readonly id: string | number; readonly geo: THREE.BufferGeometry }[];
  /** Sélection inspection courante. */
  readonly inspectionSelection: SceneInspectionSelection | null;
  /** Mode inspection : clic → panneau latéral. */
  readonly inspectMode: boolean;
  /** Mode sélection pan (surbrillance locale, sans persistance). */
  readonly panSelection3DMode: boolean;
  /** Hit sélectionné courant (pour surbrillance pan / sommet). */
  readonly selectedHit: ScenePickHit | null;
  /** Texture satellite projetée sur la toiture (emissiveMap). `null` = couleur assembleur. */
  readonly satelliteTexture: THREE.Texture | null;
  /** Dev only — couleurs vives pour l'autopsy 3D. */
  readonly autopsyDevColors: boolean;
  /** Callback clic mesh toiture (override inspect ou placement PV). */
  readonly onRoofMeshClick?: (e: ThreeEvent<MouseEvent>) => void;
  /** Callback clic mesh inspectable. */
  readonly onInspectClick?: (e: ThreeEvent<MouseEvent>) => void;
  /**
   * Active le tooltip de survol toiture (en mode édition vertex actif).
   * = roofModelingSurfaceUx && (inspectMode || panSelection3DMode) && onRoofModelingPointerUi != null
   */
  readonly showRoofModelingHoverUx: boolean;
  /** Callback mise à jour UI pointeur toiture (cursor, label, position). */
  readonly onRoofModelingPointerUi?: (p: RoofModelingPointerUi) => void;
  /** Callback pointerDown sur la tessellation toiture (sonde PV 3D). */
  readonly onRoofTessellationPv3dProbePointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  /** Épaisseur contour inspection. */
  readonly outlineThickness: number;
  /** Matériau toiture (depuis assembly.materials.roof). */
  readonly mRoof: PremiumPbrMaterialToken;
  /** Géométrie de closure toiture (façade fermée). Null si absente. */
  readonly roofClosureGeo: THREE.BufferGeometry | null;
  /** Afficher les contours d'arêtes. */
  readonly visRoofEdges: boolean;
  /** Géométrie arêtes de toiture. */
  readonly edgeGeo: THREE.BufferGeometry | null;
  /** Matériau arêtes (couleur + opacité). */
  readonly mEdge: PremiumLineMaterialToken;
  /** Afficher les faîtages / noues. */
  readonly visRidges: boolean;
  /** Géométrie faîtages. */
  readonly ridgeGeo: THREE.BufferGeometry | null;
  /** Matériau faîtages. */
  readonly mRidge: PremiumLineMaterialToken;
  /** Active l'édition de hauteur via clic sur ligne de faîtage. */
  readonly enableStructuralRidgeHeightEdit: boolean;
  /** Callback pointerDown sur ligne de faîtage (édition hauteur structurelle). */
  readonly onStructuralRidgeLinePointerDown?: (e: ThreeEvent<PointerEvent>) => void;
  /**
   * Marqueur de sommet sélectionné (React node produit dans le viewer via useMemo).
   * Inséré entre les pans et la closure pour conserver le z-order correct.
   */
  readonly panVertexSelectionMarker: ReactNode;
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function RoofPansMesh({
  roofGeos,
  inspectionSelection,
  inspectMode,
  panSelection3DMode,
  selectedHit,
  satelliteTexture,
  autopsyDevColors,
  onRoofMeshClick,
  onInspectClick,
  showRoofModelingHoverUx,
  onRoofModelingPointerUi,
  onRoofTessellationPv3dProbePointerDown,
  outlineThickness,
  mRoof,
  roofClosureGeo,
  visRoofEdges,
  edgeGeo,
  mEdge,
  visRidges,
  ridgeGeo,
  mRidge,
  enableStructuralRidgeHeightEdit,
  onStructuralRidgeLinePointerDown,
  panVertexSelectionMarker,
}: RoofPansMeshProps) {
  return (
    <>
      {roofGeos.map(({ id, geo }) => {
        const sid = String(id);
        const inspectPan = inspectMode && isInspectSelected(inspectionSelection, "PAN", sid);
        const pan3d = panSelection3DMode && isPanHittingPatchId(selectedHit, sid);
        const panHighlighted = inspectPan || pan3d;
        const emissiveHex = inspectPan
          ? SOLARNEXT_3D_PREMIUM_THEME.roof.selectedEmissive
          : pan3d
            ? SOLARNEXT_3D_PREMIUM_THEME.roof.panSelectionEmissive
            : "#000000";
        const emissiveIntensity = panHighlighted ? (inspectPan ? 0.18 : 0.16) : 0;
        const outlineHex = inspectPan ? VIEWER_INSPECT_OUTLINE_HEX.pan : VIEWER_INSPECT_OUTLINE_HEX.panSelection3d;
        return (
          <mesh
            key={`roof-${id}`}
            userData={inspectData("PAN", sid, "roof_tessellation")}
            geometry={geo}
            castShadow
            receiveShadow
            position={[0, 0, 0]}
            onClick={onRoofMeshClick ?? (inspectMode ? onInspectClick : undefined)}
            onPointerMove={
              showRoofModelingHoverUx
                ? (e) => {
                    e.stopPropagation();
                    const ne = e.nativeEvent;
                    const gl = r3fGl(e);
                    const cam = e.camera;
                    let hit = null as ReturnType<typeof pickSceneHitFromIntersections>;
                    if (panSelection3DMode && cam && gl?.domElement) {
                      hit = pickSceneHitForRoofVertexModeling(e.intersections, {
                        camera: cam,
                        canvasRect: gl.domElement.getBoundingClientRect(),
                        clientX: ne.clientX,
                        clientY: ne.clientY,
                      });
                      if (!hit) {
                        onRoofModelingPointerUi!(null);
                        return;
                      }
                    } else {
                      hit = pickSceneHitFromIntersections(e.intersections);
                      if (!hit || (hit.kind !== "roof_patch" && hit.kind !== "roof_vertex")) {
                        onRoofModelingPointerUi!(null);
                        return;
                      }
                    }
                    const label =
                      hit.kind === "roof_vertex"
                        ? "Sommet — glisser le point orange (vertical) ou panneau pour la hauteur"
                        : "Pan toiture — clic pour sélectionner";
                    onRoofModelingPointerUi!({
                      clientX: ne.clientX,
                      clientY: ne.clientY,
                      label,
                      cursor: "pointer",
                    });
                  }
                : undefined
            }
            onPointerOut={showRoofModelingHoverUx ? () => onRoofModelingPointerUi!(null) : undefined}
            onPointerDown={onRoofTessellationPv3dProbePointerDown}
          >
            {satelliteTexture && !autopsyDevColors ? (
              /* emissiveMap : affiche la texture satellite sans dépendance lumière
                 (même pipeline meshStandardMaterial → pas de conflit depth-buffer avec les panneaux).
                 color="#000000" : zéro diffus — seul l'emissive (= texture satellite) s'affiche. */
              <meshStandardMaterial
                emissiveMap={satelliteTexture}
                emissive={panHighlighted ? "#5577bb" : "#ffffff"}
                emissiveIntensity={panHighlighted ? 0.7 : 1}
                color="#000000"
                metalness={0}
                roughness={1}
                side={THREE.DoubleSide}
                polygonOffset
                {...getDepthOffset("ROOF_PAN")}
              />
            ) : (
              <meshStandardMaterial
                color={autopsyDevColors ? "#00ffff" : mRoof.color}
                metalness={mRoof.metalness}
                roughness={mRoof.roughness}
                flatShading={mRoof.flatShading ?? false}
                side={THREE.DoubleSide}
                polygonOffset
                {...getDepthOffset("ROOF_PAN")}
                emissive={emissiveHex}
                emissiveIntensity={emissiveIntensity}
              />
            )}
            {panHighlighted && (
              <Outlines
                thickness={outlineThickness}
                color={outlineHex}
                opacity={0.95}
                toneMapped={false}
              />
            )}
          </mesh>
        );
      })}
      {panVertexSelectionMarker}
      {roofClosureGeo && (
        <mesh geometry={roofClosureGeo} castShadow receiveShadow position={[0, 0, 0]}>
          <meshStandardMaterial
            color={autopsyDevColors ? "#6666ee" : mRoof.color}
            metalness={mRoof.metalness}
            roughness={Math.min(1, (mRoof.roughness ?? 0.7) + 0.06)}
            flatShading={mRoof.flatShading ?? false}
            side={THREE.DoubleSide}
            polygonOffset
            {...getDepthOffset("ROOF_PAN")}
          />
        </mesh>
      )}
      {visRoofEdges && edgeGeo && (
        <RoofContourLine2
          sourceGeo={edgeGeo}
          color={String(mEdge.color)}
          opacity={mEdge.opacity}
        />
      )}
      {visRidges && ridgeGeo && (
        <RoofContourLine2
          sourceGeo={ridgeGeo}
          color={String(mRidge.color)}
          opacity={mRidge.opacity}
          onPointerDown={
            enableStructuralRidgeHeightEdit && onStructuralRidgeLinePointerDown
              ? (e) => {
                  e.stopPropagation();
                  onStructuralRidgeLinePointerDown(e);
                }
              : undefined
          }
        />
      )}
    </>
  );
}
