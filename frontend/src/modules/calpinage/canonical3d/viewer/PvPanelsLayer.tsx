/**
 * PvPanelsLayer — rendu des panneaux PV (InstancedMesh), cell lines et outlines d'inspection.
 *
 * Extrait de SolarScene3DViewer.tsx (A12 — Strangler Fig).
 * Correspond exactement au bloc `{visPanels && <>...</>}` (lignes 3375–3452 du viewer).
 *
 * Contrat :
 *   - Aucune logique métier — rendu pur.
 *   - Le parent garde `visPanels` comme guard : `{visPanels && <PvPanelsLayer ... />}`.
 *   - PvPanelInstanced patche userData (INSPECT_USERDATA_KEY) en interne via panelIdByInstanceIndex.
 */

import * as THREE from "three";
import { useEffect } from "react";
import type { ThreeEvent } from "@react-three/fiber";
import { Outlines } from "@react-three/drei";
import { PvPanelInstanced } from "../pvPanels/PvPanelInstanced";
import { getDepthOffset } from "./DepthRegistry";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";
import type { SceneInspectionSelection } from "./inspection/sceneInspectionTypes";
import { isInspectSelected, roofModelingSkipOccluderRaycast } from "./viewerHelpers";
import { SOLARNEXT_3D_PREMIUM_THEME, VIEWER_INSPECT_OUTLINE_HEX } from "./viewerVisualTokens";

// ── Debug runtime [PV3D-RENDER] ─────────────────────────────────────────────
const _pv3dDbg = (): boolean =>
  import.meta.env.DEV ||
  (typeof window !== "undefined" && (window as Record<string, unknown>)["__PV3D_DEBUG"] === true);

// ── Constantes visuelles PV ───────────────────────────────────────────────────

// #0c131f = quasi-noir bleu nuit : couleur réelle cellule monocristalline
const PREMIUM_PV_SURFACE_HEX = new THREE.Color("#0c131f").getHex();
const PREMIUM_PV_EMISSIVE_HEX = new THREE.Color(SOLARNEXT_3D_PREMIUM_THEME.pv.liveEmissive).getHex();
const PREMIUM_PV_CELL_LINE = SOLARNEXT_3D_PREMIUM_THEME.pv.cellLine;

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PvPanelsLayerProps {
  /** Surfaces 3D des panneaux — depuis scene.pvPanels (non modifié). */
  readonly panels: readonly PvPanelSurface3D[];
  /** Couleurs hex par instance (shading + état selected/invalid). Undefined = baseColor uniforme. */
  readonly panelColors: readonly number[] | undefined;
  /** Bonus d'intensité emissive (depuis assembly.pvBoost). */
  readonly pvPanelEmissiveIntensityBonus: number;
  /** Metalness PV (depuis assembly.pvBoost). */
  readonly pvPanelMetalness: number;
  /** Roughness PV (depuis assembly.pvBoost). */
  readonly pvPanelRoughness: number;
  /** Mode interaction pose PV 3D — influence renderOrder et polygonOffset. */
  readonly pvLayout3DInteractionMode: boolean;
  /** IDs de panneaux à masquer (scale=0) — live panels pendant un drag actif. */
  readonly pvLayout3DEffectiveHiddenIds: ReadonlySet<string> | undefined;
  /**
   * Si vrai, les panneaux laissent passer le raycasting (mode édition toiture).
   * = roofModelingPassThroughOccluders && !pvLayout3DInteractionMode
   */
  readonly pvPanelRaycastPassThrough: boolean;
  /** Mode inspection : clic panneau → panneau latéral. */
  readonly inspectMode: boolean;
  /** Callback clic mesh inspectable. */
  readonly onInspectClick?: (e: ThreeEvent<MouseEvent>) => void;
  /** Callback pointerDown panneau en mode pvLayout3D (début drag). */
  readonly onPvPanelPvLayout3dPointerDown?: (e: ThreeEvent<PointerEvent>, panelId: string) => void;
  /** Callback hover panneau (tooltip). */
  readonly onPanelHover?: (payload: { panelId: string; clientX: number; clientY: number } | null) => void;
  /** Géométrie consolidée des cell lines (1 draw call pour N panneaux). Null si 0 panneaux. */
  readonly consolidatedPvCellLinesGeo: THREE.BufferGeometry | null;
  /**
   * Géométries individuelles par panneau — utilisées pour les outlines d'inspection.
   * Seuls les panneaux sélectionnés en inspect mode génèrent un mesh invisible + Outlines.
   */
  readonly panelGeos: readonly { readonly id: string; readonly geo: THREE.BufferGeometry }[];
  /** Sélection inspection courante — pour outlines panneau sélectionné. */
  readonly inspectionSelection: SceneInspectionSelection | null;
  /** Épaisseur contour inspection. */
  readonly outlineThickness: number;
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function PvPanelsLayer({
  panels,
  panelColors,
  pvPanelEmissiveIntensityBonus,
  pvPanelMetalness,
  pvPanelRoughness,
  pvLayout3DInteractionMode,
  pvLayout3DEffectiveHiddenIds,
  pvPanelRaycastPassThrough,
  inspectMode,
  onInspectClick,
  onPvPanelPvLayout3dPointerDown,
  onPanelHover,
  consolidatedPvCellLinesGeo,
  panelGeos,
  inspectionSelection,
  outlineThickness,
}: PvPanelsLayerProps) {
  // ── [PV3D-RENDER] Log render-level state ──────────────────────────────
  useEffect(() => {
    if (!_pv3dDbg()) return;
    const hiddenCount = pvLayout3DEffectiveHiddenIds?.size ?? 0;
    const tag = `[PV3D-RENDER] PvPanelsLayer: panels=${panels.length} hidden=${hiddenCount}`
      + ` interactionMode=${String(pvLayout3DInteractionMode)}`
      + (panels.length === 0 ? " ⚠️ AUCUN PANNEAU" : "");
    console.groupCollapsed(tag);
    console.log("panels.length:", panels.length);
    console.log("panelColors:", panelColors ? `${panelColors.length} couleurs` : "absent");
    console.log("pvLayout3DInteractionMode:", pvLayout3DInteractionMode);
    console.log("pvLayout3DEffectiveHiddenIds:", pvLayout3DEffectiveHiddenIds ? [...pvLayout3DEffectiveHiddenIds] : "undefined");
    console.log("consolidatedPvCellLinesGeo:", consolidatedPvCellLinesGeo ? "présente" : "null");
    console.log("renderOrder:", pvLayout3DInteractionMode ? 20 : 2);
    if (panels.length === 0)
      console.error("[PV3D-RENDER] ⛔ 0 panneaux transmis à PvPanelInstanced — GPU ne rendra rien.");
    if (hiddenCount > 0 && hiddenCount === panels.length)
      console.warn("[PV3D-RENDER] ⚠️ Tous les panneaux sont hidden (scale=0).");
    console.groupEnd();
  }, [panels, panelColors, pvLayout3DInteractionMode, pvLayout3DEffectiveHiddenIds, consolidatedPvCellLinesGeo]);

  return (
    <>
      {/*
       * Rendu InstancedMesh : 1 draw call pour N panneaux.
       * Sélection individuelle via e.instanceId (raycasting THREE.js).
       * Panneaux masqués en pvLayout3D (pv3dSelectedLivePanelIds) → scale=0.
       * Couleurs per-instance via instanceColor (shading viz + invalid/selected states).
       * Note : outlines pv3dSelected/pv3dInvalid perdues (limitation InstancedMesh) ;
       * les états sont compensés par la couleur d'instance.
       */}
      <PvPanelInstanced
        panels={panels}
        panelColors={panelColors}
        baseColor={PREMIUM_PV_SURFACE_HEX}
        emissiveColor={PREMIUM_PV_EMISSIVE_HEX}
        {/* LOT3-C3 : base emissiveIntensity 0.1 → 0.40 — plancher de visibilité garanti même sans
         * env map (pendant le chargement HDRI Suspense) ou sur GPU mobile sans IBL complet.
         * Metalness=0.72 tire 72 % de sa couleur de l'IBL ; sans elle, diffuse = albedo × (1-0.72) ≈ 7 % → invisible.
         * 0.40 + bonus (0–0.06) = 0.40–0.46 : panneaux visibles mais non saturés (PBR conservé). */}
        emissiveIntensity={pvPanelEmissiveIntensityBonus + 0.40}
        metalness={pvPanelMetalness}
        roughness={pvPanelRoughness}
        envMapIntensity={1.45}
        renderOrder={pvLayout3DInteractionMode ? 20 : 2}
        polygonOffsetFactor={getDepthOffset("PV_PANEL").polygonOffsetFactor}
        polygonOffsetUnits={getDepthOffset("PV_PANEL").polygonOffsetUnits}
        hiddenPanelIds={pvLayout3DEffectiveHiddenIds}
        raycastFn={pvPanelRaycastPassThrough ? roofModelingSkipOccluderRaycast : undefined}
        onPanelClick={
          inspectMode
            ? (_panel, e) => {
                // PvPanelInstanced patche userData (INSPECT_USERDATA_KEY) en interne
                // via panelIdByInstanceIndex — mutation déjà faite avant ce callback.
                onInspectClick!(e);
              }
            : undefined
        }
        onPanelPointerDown={
          pvLayout3DInteractionMode && onPvPanelPvLayout3dPointerDown
            ? (panel, e) => {
                onPvPanelPvLayout3dPointerDown(e, String(panel.id));
              }
            : undefined
        }
        onPanelHover={onPanelHover}
      />
      {/* Cell lines consolidées : 1 draw call pour N panneaux (vs N draw calls individuels). */}
      {consolidatedPvCellLinesGeo && (
        <lineSegments
          geometry={consolidatedPvCellLinesGeo}
          renderOrder={pvLayout3DInteractionMode ? 21 : 3}
        >
          <lineBasicMaterial
            color={PREMIUM_PV_CELL_LINE}
            transparent
            opacity={0.55}
            depthWrite={false}
            toneMapped={false}
            depthTest
            polygonOffset
            {...getDepthOffset("PV_CELL_LINE")}
          />
        </lineSegments>
      )}
      {/* Outline inspection : rendu individuel pour les panneaux sélectionnés en inspect mode */}
      {inspectMode &&
        panelGeos.map(({ id, geo }) => {
          const pvSel = isInspectSelected(inspectionSelection, "PV_PANEL", id);
          if (!pvSel) return null;
          return (
            <mesh key={`pvsel-${id}`} geometry={geo}>
              <meshStandardMaterial visible={false} />
              <Outlines
                thickness={outlineThickness}
                color={VIEWER_INSPECT_OUTLINE_HEX.pvPanelSelected}
                opacity={0.9}
                toneMapped={false}
              />
            </mesh>
          );
        })}
    </>
  );
}
