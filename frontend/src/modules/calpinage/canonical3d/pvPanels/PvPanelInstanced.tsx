/**
 * PvPanelInstanced - Rendu haute performance des panneaux PV via THREE.InstancedMesh.
 *
 * FA-3 : Architecture pool fixe (suppression key={count}).
 *
 * PROBLEME RESOLU
 * L'ancienne architecture utilisait key={count} sur l'instancedMesh.
 * A chaque ajout ou suppression de panneau, React declenchait un remount complet :
 *   - Demontage GPU (dispose geom, suppression scene graph)
 *   - Remontage avec nouveau buffer Float32Array(count * 16)
 *   - Frame intermediaire avec matrices non initialisees = flash / panneaux a l'origine
 *   - Comportements differents selon count (1 panneau vs 50)
 *
 * SOLUTION : buffer GPU alloue une seule fois
 * INSTANCE_POOL_SIZE = 512 instances allouees au montage initial. Jamais realloue.
 * L'InstancedMesh ne remonte PLUS quand le nombre de panneaux change.
 * Les slots inactifs sont masques avec HIDDEN_INSTANCE_MATRIX (scale=0).
 * mesh.count est mis a jour dynamiquement pour l'efficacite du raycasting.
 *
 * CYCLE DE MISE A JOUR (zero flash, zero frame intermediaire) :
 *
 *   Changement panels / colors / hiddenPanelIds
 *     -> React commit (synchrone)
 *     -> useLayoutEffect (synchrone, post-commit, AVANT le premier rendu THREE.js) :
 *         - Met a jour les refs (panels, colors, hidden)
 *         - Init pool complet HIDDEN si premier montage
 *         - flushInstancesToMesh() -> matrices CPU -> needsUpdate = true
 *         - dirtyRef = false
 *     -> RAF suivant (asynchrone) :
 *         - useFrame -> dirtyRef = false -> no-op
 *         - gl.render() -> upload GPU instanceMatrix -> image correcte des le premier frame
 *
 * Pourquoi useLayoutEffect et non useEffect :
 * - useLayoutEffect : synchrone, s'execute AVANT que le navigateur peigne.
 * - useEffect       : asynchrone, peut s'executer APRES un RAF -> flash visible.
 * - Dans R3F, gl.render() s'execute dans la RAF suivante (async par rapport au commit React).
 * - Donc : commit -> useLayoutEffect (matrices CPU) -> RAF -> gl.render (upload GPU)
 *
 * POOL INITIALIZATION
 * new THREE.InstancedMesh(geo, mat, 512) initialise instanceMatrix avec des zeros
 * (Float32Array), soit des matrices nulles - PAS des matrices identite. Sans init,
 * les 512 instances seraient rendues a des positions indefinies (world origin, scale 0,
 * ou artefacts GPU selon le driver). Le premier useLayoutEffect remplit TOUS les 512
 * slots avec HIDDEN_INSTANCE_MATRIX, puis flushInstancesToMesh applique les vraies
 * matrices pour les panneaux actifs. Ce n'est execute QU'UNE SEULE FOIS via poolInitializedRef.
 *
 * FRUSTUM CULLED = FALSE
 * THREE.InstancedMesh.computeBoundingSphere() calcule la sphere englobante depuis la
 * geometrie de base (PlaneGeometry 1x1 centree a l'origine), PAS depuis les matrices
 * d'instance en world space. Le mesh serait souvent culled a tort aux angles camera
 * extremes. frustumCulled=false desactive le culling pour ce mesh uniquement.
 * En usage normal (camera orbitant autour d'une toiture), les panneaux sont toujours
 * dans le frustum - aucun impact perf.
 *
 * MESH.COUNT DYNAMIQUE
 * mesh.count est mis a Math.min(panels.length, INSTANCE_POOL_SIZE) apres chaque flush.
 * THREE.js utilise mesh.count pour limiter le raycasting et le rendu aux instances actives.
 * Les slots 0..count-1 sont actifs (ou masques), count..511 sont masques et ignores par le GPU.
 *
 * SUPPRESSION DE PANNEAUX - CLEANUP SLOTS
 * prevCountRef memorise le count du flush precedent. Quand n < prevCount, les slots
 * n..prevCount-1 sont explicitement remis a HIDDEN_INSTANCE_MATRIX (evite les fantomes).
 *
 * RESIZE > 512
 * Si panels.length > INSTANCE_POOL_SIZE : warning en DEV, troncature silencieuse.
 * Pour des installations > 512 panneaux (non residentiel), augmenter la constante.
 *
 * Garanties anti-regression :
 * 1. NE modifie PAS buildPvPanels3D.ts.
 * 2. Selection par raycasting fonctionne via e.instanceId (guard < count).
 * 3. Aucune logique metier - rendu pur.
 * 4. Drag live overlay : hiddenPanelIds -> scale(0) pendant le drag, scale reel apres.
 * 5. API Props inchangee - PvPanelsLayer.tsx non modifie.
 */

import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import * as THREE from "three";
import { useFrame, type ThreeEvent } from "@react-three/fiber";
import type { PvPanelSurface3D } from "../types/pv-panel-3d";
import { INSPECT_USERDATA_KEY } from "../viewer/inspection/sceneInspectionTypes";
import { getDepthOffset } from "../viewer/DepthRegistry";


// ── Debug runtime [PV3D-RENDER] ───────────────────────────────────────────────
const _pv3dDbg = (): boolean =>
  import.meta.env.DEV ||
  (typeof window !== "undefined" && (window as Record<string, unknown>)["__PV3D_DEBUG"] === true);
// ── Constante pool ────────────────────────────────────────────────────────────

/**
 * Capacite du buffer GPU alloue une fois au montage.
 * 512 couvre toute installation residentielle/petite tertiaire sans reallocation.
 * Instances excedentaires ignorees avec warning DEV.
 */
const INSTANCE_POOL_SIZE = 512;

// ── Geometrie partagee ────────────────────────────────────────────────────────

/** Plan unite 1x1, normal +Z, centre a l'origine. */
function buildSharedPanelGeometry(): THREE.PlaneGeometry {
  return new THREE.PlaneGeometry(1, 1);
}

// ── Matrice d'instance ────────────────────────────────────────────────────────

/**
 * Construit la matrice monde depuis corners3D + center3D + outwardNormal.
 *
 * N'utilise PAS localFrame - meme source de verite que panelQuadGeometry,
 * garantit que la surface InstancedMesh coincide exactement avec les cell lines.
 *
 * Pour PlaneGeometry(1,1) avec vertices a (+/-0.5, +/-0.5, 0) :
 *   col0 = c1 - c0  (vecteur largeur pleine, scale implicite)
 *   col1 = c3 - c0  (vecteur hauteur pleine, scale implicite)
 *   col2 = outwardNormal
 *   col3 = center3D
 */
function applyPanelInstanceMatrix(panel: PvPanelSurface3D, target: THREE.Matrix4): void {
  const c0 = panel.corners3D[0]!;
  const c1 = panel.corners3D[1]!;
  const c3 = panel.corners3D[3]!;
  const ctr = panel.center3D;
  const n = panel.outwardNormal;
  const wx = c1.x - c0.x, wy = c1.y - c0.y, wz = c1.z - c0.z;
  const hx = c3.x - c0.x, hy = c3.y - c0.y, hz = c3.z - c0.z;
  // THREE.Matrix4.set : arguments en ordre row-major
  target.set(
    wx,  hx,  n.x,  ctr.x,
    wy,  hy,  n.y,  ctr.y,
    wz,  hz,  n.z,  ctr.z,
    0,   0,   0,    1,
  );
}

/**
 * Matrice degeneree scale(0,0,0) : masque une instance sans la retirer du buffer.
 * Utilisee pour : slots inactifs du pool, panneaux live pendant un drag.
 */
const HIDDEN_INSTANCE_MATRIX: THREE.Matrix4 = (() => {
  const m = new THREE.Matrix4();
  m.makeScale(0, 0, 0);
  return Object.freeze(m) as THREE.Matrix4;
})();

// ── Flush GPU ─────────────────────────────────────────────────────────────────

/**
 * Applique matrices + couleurs sur l'InstancedMesh pour les panneaux actifs,
 * masque les slots liberes (quand panels.length a diminue), met a jour mesh.count.
 *
 * Retourne le nouveau count actif (Math.min(panels.length, INSTANCE_POOL_SIZE)).
 *
 * Appele depuis useLayoutEffect (synchrone) ET useFrame (filet de securite).
 * Les deux ne s'executent JAMAIS simultanement - dirtyRef sert de mutex logique.
 */
function flushInstancesToMesh(
  mesh: THREE.InstancedMesh,
  panels: readonly PvPanelSurface3D[],
  colors: readonly number[] | undefined,
  hidden: ReadonlySet<string> | undefined,
  prevCount: number,
): number {
  const n = Math.min(panels.length, INSTANCE_POOL_SIZE);

  if (import.meta.env.DEV && panels.length > INSTANCE_POOL_SIZE) {
    console.warn(
      "[PvPanelInstanced] panels.length (" + String(panels.length) + ") > INSTANCE_POOL_SIZE (" + String(INSTANCE_POOL_SIZE) + "). " +
      "Instances excedentaires ignorees. Augmenter INSTANCE_POOL_SIZE pour les installations > 512 panneaux.",
    );
  }

  // ── [PV3D-RENDER] Log entrée flush ──────────────────────────────────
  if (_pv3dDbg()) {
    console.log(
      `[PV3D-RENDER] flushInstancesToMesh: panels=${panels.length} n=${n} prevCount=${prevCount} hidden=${hidden?.size ?? 0}`,
    );
    if (panels.length === 0)
      console.warn("[PV3D-RENDER] ⚠️ panels.length=0 — mesh.count sera 0, rien de rendu.");
  }

  const m = new THREE.Matrix4();
  const c = new THREE.Color();
  const hasColors = colors != null && colors.length >= n;
  let _nanCount = 0;

  // Panneaux actifs : matrices + couleurs
  for (let i = 0; i < n; i++) {
    const panel = panels[i]!;
    const isHidden = hidden?.has(String(panel.id)) ?? false;

    if (isHidden) {
      mesh.setMatrixAt(i, HIDDEN_INSTANCE_MATRIX);
    } else {
      applyPanelInstanceMatrix(panel, m);
      // ── [PV3D-RENDER] NaN check avant upload GPU ────────────────────
      if (_pv3dDbg() && m.elements.some((v) => !Number.isFinite(v))) {
        _nanCount++;
        console.error(
          `[PV3D-RENDER] ⛔ NaN/Inf dans matrice #${i} (panelId=${String(panel.id)})`,
          { center3D: panel.center3D, outwardNormal: panel.outwardNormal,
            corners3D: panel.corners3D, matEls: [...m.elements] },
        );
      }
      mesh.setMatrixAt(i, m);
    }

    if (hasColors) {
      c.setHex(colors![i]!);
      mesh.setColorAt(i, c);
    }
  }

  // Slots liberes - suppression de panneaux
  // Si panels.length a diminue depuis le dernier flush, les anciens slots
  // doivent etre masques pour eviter les instances fantomes.
  for (let i = n; i < prevCount; i++) {
    mesh.setMatrixAt(i, HIDDEN_INSTANCE_MATRIX);
  }

  // mesh.count : THREE.js raycaste et rend uniquement les count premieres instances
  mesh.count = n;

  // Upload GPU
  mesh.instanceMatrix.needsUpdate = true;

  if (hasColors && mesh.instanceColor) {
    mesh.instanceColor.needsUpdate = true;
  } else if (!hasColors && mesh.instanceColor) {
    // Retour a la couleur uniforme (material.color) - libere le buffer per-instance
    mesh.instanceColor = null;
  }

  // ── [PV3D-RENDER] Log sortie flush ──────────────────────────────────
  if (_pv3dDbg()) {
    if (_nanCount > 0)
      console.error(`[PV3D-RENDER] ⛔ ${_nanCount} matrices NaN uploadées sur GPU — panneaux invisibles.`);
    else
      console.log(`[PV3D-RENDER] ✓ mesh.count=${n}  needsUpdate=true  nanCount=0`);
  }

  return n;
}

// ── Props ─────────────────────────────────────────────────────────────────────

export interface PvPanelInstancedProps {
  /** Surfaces 3D des panneaux - issues de buildPvPanels3D (non modifie). */
  readonly panels: readonly PvPanelSurface3D[];
  /**
   * Couleurs hex par instance (meme ordre que panels).
   * Si fourni : material.color = 0xffffff (blanc) pour ne pas teinter instanceColor.
   * Si absent  : material.color = baseColor uniforme.
   */
  readonly panelColors?: readonly number[];
  /** Couleur de base quand panelColors absent (0x111827 = bleu fonce premium). */
  readonly baseColor: number;
  /** Couleur emissive partagee (non per-instance - limitation InstancedMesh). */
  readonly emissiveColor: number;
  /** Intensite emissive partagee. */
  readonly emissiveIntensity: number;
  readonly metalness: number;
  readonly roughness: number;
  /**
   * Intensite des reflections IBL sur les panneaux.
   * Valeur recommandee : 1.45 pour panneaux monocristallins (verre AR + silicon).
   */
  readonly envMapIntensity?: number;
  readonly renderOrder?: number;
  readonly polygonOffsetFactor?: number;
  readonly polygonOffsetUnits?: number;
  /**
   * IDs des panneaux a masquer (matrice scale=0).
   * Utilise en pvLayout3DInteractionMode pour les panneaux "live" rendus separement.
   */
  readonly hiddenPanelIds?: ReadonlySet<string>;
  /**
   * Callback de clic sur un panneau individuel.
   * PvPanelInstanced patche e.object.userData[INSPECT_USERDATA_KEY] AVANT l'appel.
   */
  readonly onPanelClick?: (panel: PvPanelSurface3D, e: ThreeEvent<MouseEvent>) => void;
  /** Callback pointerDown sur un panneau - utilise en pvLayout3DInteractionMode. */
  readonly onPanelPointerDown?: (panel: PvPanelSurface3D, e: ThreeEvent<PointerEvent>) => void;
  /** Callback hover panneau (tooltip). */
  readonly onPanelHover?: (
    payload: { panelId: string; clientX: number; clientY: number } | null,
  ) => void;
  /** Fonction de raycast custom (ex. roofModelingSkipOccluderRaycast). */
  readonly raycastFn?: (raycaster: THREE.Raycaster, intersects: THREE.Intersection[]) => void;
}

// ── Composant ─────────────────────────────────────────────────────────────────

export function PvPanelInstanced({
  panels,
  panelColors,
  baseColor,
  emissiveColor,
  emissiveIntensity,
  metalness,
  roughness,
  envMapIntensity = 1.45,
  renderOrder = 0,
  polygonOffsetFactor = getDepthOffset("PV_PANEL").polygonOffsetFactor,
  polygonOffsetUnits = getDepthOffset("PV_PANEL").polygonOffsetUnits,
  hiddenPanelIds,
  onPanelClick,
  onPanelPointerDown,
  onPanelHover,
  raycastFn,
}: PvPanelInstancedProps) {
  const meshRef = useRef<THREE.InstancedMesh>(null);

  // Geometrie partagee - allouee une fois, disposee au demontage
  const sharedGeometry = useMemo(() => buildSharedPanelGeometry(), []);
  useEffect(() => () => { sharedGeometry.dispose(); }, [sharedGeometry]);

  // Refs : acces depuis useLayoutEffect + useFrame sans closure perimee
  const panelsRef = useRef(panels);
  const panelColorsRef = useRef(panelColors);
  const hiddenPanelIdsRef = useRef(hiddenPanelIds);

  /**
   * Count actif lors du dernier flush - necessaire pour effacer les slots liberes
   * quand panels.length diminue (panneau supprime).
   */
  const prevCountRef = useRef(0);

  /**
   * true -> useFrame doit appliquer les matrices.
   * Arme uniquement si useLayoutEffect n'a pas pu flusher (mesh non disponible).
   * Dans 99.9% des cas, useLayoutEffect flushe avant useFrame -> dirtyRef reste false.
   */
  const dirtyRef = useRef(true);

  /**
   * Indique que la totalite du pool (512 slots) a ete initialisee avec HIDDEN_INSTANCE_MATRIX.
   * Execute une seule fois - evite de reinitialiser 512 slots a chaque mise a jour.
   */
  const poolInitializedRef = useRef(false);

  /**
   * Mise a jour synchrone - zero flash garanti.
   *
   * Execute APRES chaque commit React (synchrone), AVANT le prochain rendu THREE.js
   * (asynchrone, dans la RAF suivante). Les donnees GPU sont donc TOUJOURS a jour
   * pour le frame courant sans aucune frame intermediaire incorrecte.
   */
  useLayoutEffect(() => {
    // Mise a jour des refs en premier - useFrame les lira si dirtyRef est encore true
    panelsRef.current = panels;
    panelColorsRef.current = panelColors;
    hiddenPanelIdsRef.current = hiddenPanelIds;

    const mesh = meshRef.current;
    if (!mesh) {
      // Cas theoriquement impossible (instancedMesh est toujours dans le JSX),
      // mais defensif : useFrame prend le relais via dirtyRef.
      dirtyRef.current = true;
      return;
    }

    // Init pool - premier montage uniquement
    // Float32Array de THREE.InstancedMesh est initialisee a 0 (pas a identite).
    // Une matrice nulle provoque un rendu a des positions indefinies.
    // On remplit TOUS les 512 slots avec HIDDEN avant le premier flush reel.
    if (!poolInitializedRef.current) {
      poolInitializedRef.current = true;
      for (let i = 0; i < INSTANCE_POOL_SIZE; i++) {
        mesh.setMatrixAt(i, HIDDEN_INSTANCE_MATRIX);
      }
      // needsUpdate sera positionne par flushInstancesToMesh ci-dessous.
    }

    const newCount = flushInstancesToMesh(
      mesh,
      panels,
      panelColors,
      hiddenPanelIds,
      prevCountRef.current,
    );
    prevCountRef.current = newCount;
    dirtyRef.current = false;
  }, [panels, panelColors, hiddenPanelIds]);

  /**
   * Filet de securite RAF - no-op dans 99.9% des cas.
   *
   * Actif uniquement si useLayoutEffect n'a pas pu flusher (meshRef.current etait null).
   * Conserve pour la robustesse des cas extremes (montage concurrent, Suspense, etc.).
   */
  useFrame(() => {
    if (!dirtyRef.current) return;
    const mesh = meshRef.current;
    if (!mesh) return;

    if (!poolInitializedRef.current) {
      poolInitializedRef.current = true;
      for (let i = 0; i < INSTANCE_POOL_SIZE; i++) {
        mesh.setMatrixAt(i, HIDDEN_INSTANCE_MATRIX);
      }
    }

    const newCount = flushInstancesToMesh(
      mesh,
      panelsRef.current,
      panelColorsRef.current,
      hiddenPanelIdsRef.current,
      prevCountRef.current,
    );
    prevCountRef.current = newCount;
    dirtyRef.current = false;
  });

  /**
   * Map index d'instance -> panelId - source de verite pour le patch userData.
   * Reconstruit uniquement quand panels change - jamais desynchronise.
   * Utilise dans onClick/onPointerDown pour patcher INSPECT_USERDATA_KEY
   * AVANT d'appeler onPanelClick, eliminant le couplage implicite viewer/InstancedMesh.
   */
  const panelIdByInstanceIndex = useMemo<ReadonlyMap<number, string>>(
    () => new Map(panels.map((p, i) => [i, String(p.id)])),
    [panels],
  );

  // Count courant - utilise dans les handlers d'evenements (guard instanceId < count)
  const count = panels.length;

  return (
    <instancedMesh
      // FA-3 : PAS de key={count}
      // Buffer GPU fixe (INSTANCE_POOL_SIZE = 512).
      // R3F reutilise le meme THREE.InstancedMesh quel que soit le nombre de panneaux.
      // Zero remount, zero reallocation GPU, zero frame avec matrices non initialisees.
      ref={meshRef}
      args={[sharedGeometry, undefined, INSTANCE_POOL_SIZE]}
      // frustumCulled=false : THREE.InstancedMesh calcule sa bounding sphere depuis la
      // geometrie de base (PlaneGeometry 1x1 a l'origine, avant transformation d'instance).
      // Resultat : le mesh est culled a tort aux angles camera extremes.
      // Avec frustumCulled=false, les panneaux sont TOUJOURS rendus - en usage normal
      // (camera orbitant autour de la toiture), ils sont toujours dans le frustum.
      frustumCulled={false}
      castShadow
      receiveShadow
      renderOrder={renderOrder}
      raycast={raycastFn}
      onClick={
        onPanelClick
          ? (e: ThreeEvent<MouseEvent>) => {
              e.stopPropagation();
              if (e.instanceId !== undefined && e.instanceId < count) {
                // Patch userData AVANT onPanelClick : le systeme d'inspection lit
                // e.object.userData[INSPECT_USERDATA_KEY] pour resoudre { kind, id }.
                const panelId = panelIdByInstanceIndex.get(e.instanceId);
                if (panelId != null) {
                  e.object.userData[INSPECT_USERDATA_KEY] = { kind: "PV_PANEL" as const, id: panelId };
                }
                onPanelClick(panels[e.instanceId]!, e);
              }
            }
          : undefined
      }
      onPointerDown={
        onPanelPointerDown
          ? (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (e.instanceId !== undefined && e.instanceId < count) {
                onPanelPointerDown(panels[e.instanceId]!, e);
              }
            }
          : undefined
      }
      onPointerOver={
        onPanelHover
          ? (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (e.instanceId !== undefined && e.instanceId < count) {
                const p = panels[e.instanceId]!;
                onPanelHover({ panelId: String(p.id), clientX: e.clientX, clientY: e.clientY });
              }
            }
          : undefined
      }
      onPointerOut={
        onPanelHover
          ? (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              onPanelHover(null);
            }
          : undefined
      }
      onPointerMove={
        onPanelHover
          ? (e: ThreeEvent<PointerEvent>) => {
              e.stopPropagation();
              if (e.instanceId !== undefined && e.instanceId < count) {
                const p = panels[e.instanceId]!;
                onPanelHover({ panelId: String(p.id), clientX: e.clientX, clientY: e.clientY });
              }
            }
          : undefined
      }
    >
      {/*
       * Quand panelColors est fourni, material.color = blanc (0xffffff) pour que
       * instanceColor dicte la couleur finale sans teinte parasite.
       * Sinon, material.color = baseColor uniforme.
       */}
      <meshStandardMaterial
        color={panelColors != null ? 0xffffff : baseColor}
        emissive={emissiveColor}
        emissiveIntensity={emissiveIntensity}
        metalness={metalness}
        roughness={roughness}
        envMapIntensity={envMapIntensity}
        // FrontSide : les panneaux ont toujours la normale orientee vers l'observateur.
        // DoubleSide causait des artefacts depth en vue rasante (backfaces dans depth buffer).
        side={THREE.FrontSide}
        polygonOffset
        polygonOffsetFactor={polygonOffsetFactor}
        polygonOffsetUnits={polygonOffsetUnits}
      />
    </instancedMesh>
  );
}
