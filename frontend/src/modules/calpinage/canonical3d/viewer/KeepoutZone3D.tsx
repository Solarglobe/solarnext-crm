/**
 * Composant R3F — rendu 3D des zones keepout (visualRole === "keepout_surface").
 *
 * Visuel :
 *   - Nappe translucide rouge (#ff4444, opacity 0.35) sur la face supérieure du volume.
 *   - Marqueurs cubiques blancs aux coins du contour supérieur.
 *
 * Contraintes :
 *   - Aucun mesh ne bloque le raycasting (raycast={() => null} sur tous les objets 3D).
 *   - Ne modifie ni le store ni la logique de placement PV.
 *   - dispose() GPU appelé à l'unmount pour éviter les fuites mémoire.
 *
 * Séparé de SolarScene3DViewer.tsx — utilisé dans la boucle obstacle :
 *   {volume.visualRole === "keepout_surface" && <KeepoutZone3D vol={volume} />}
 */

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import type { RoofObstacleVolume3D } from "../types/roof-obstacle-volume";

// ── types ─────────────────────────────────────────────────────────────────────

interface KeepoutZone3DProps {
  readonly vol: RoofObstacleVolume3D;
}

// ── constantes visuelles ──────────────────────────────────────────────────────

const FILL_COLOR = "#ff4444";
const FILL_OPACITY = 0.35;
const MARKER_COLOR = "#ffffff";
/** Taille du cube marqueur en mètres. */
const MARKER_SIZE = 0.10;
/** Lift Z de la nappe au-dessus de la face supérieure du volume (au-dessus des hachures). */
const FILL_LIFT = 0.032;
/** Lift Z légèrement supérieur pour les marqueurs de coins. */
const MARKER_LIFT = 0.038;

// ── helpers ───────────────────────────────────────────────────────────────────

/** Retourne les sommets du contour supérieur du volume en coordonnées monde. */
function buildTopRing(vol: RoofObstacleVolume3D, lift: number): THREE.Vector3[] {
  const n = vol.footprintWorld.length;
  if (n < 3 || vol.vertices.length < n * 2) return [];
  return Array.from({ length: n }, (_, i) => {
    const top = vol.vertices[i + n]!.position;
    return new THREE.Vector3(top.x, top.y, top.z + lift);
  });
}

/**
 * Géométrie de remplissage : triangle fan depuis le premier sommet.
 * Valide pour tout polygone convexe (cas nominal des keepouts rectangulaires).
 */
function buildFillGeometry(ring: THREE.Vector3[]): THREE.BufferGeometry | null {
  if (ring.length < 3) return null;
  const positions: number[] = [];
  const indices: number[] = [];
  for (const p of ring) positions.push(p.x, p.y, p.z);
  for (let i = 1; i < ring.length - 1; i++) indices.push(0, i, i + 1);
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  return geo;
}

// ── raycast no-op (réutilisé par tous les meshes) ────────────────────────────

const NO_RAYCAST = (): null => null;

// ── composant ─────────────────────────────────────────────────────────────────

/**
 * Rendu 3D d'une zone keepout : nappe rouge translucide + marqueurs de coins blancs.
 * Doit être rendu à l'intérieur du <mesh> obstacle de SolarScene3DViewer
 * (le parent n'a pas de transform — les coordonnées monde s'appliquent directement).
 */
export function KeepoutZone3D({ vol }: KeepoutZone3DProps): React.ReactElement | null {
  if (vol.visualRole !== "keepout_surface") return null;

  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fillRing = useMemo(() => buildTopRing(vol, FILL_LIFT), [vol]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const markerRing = useMemo(() => buildTopRing(vol, MARKER_LIFT), [vol]);
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const fillGeo = useMemo(() => buildFillGeometry(fillRing), [fillRing]);

  // Libère la géométrie GPU lors du changement de vol ou de l'unmount.
  // eslint-disable-next-line react-hooks/rules-of-hooks
  useEffect(() => {
    return () => {
      fillGeo?.dispose();
    };
  }, [fillGeo]);

  if (!fillGeo || fillRing.length === 0) return null;

  return (
    <>
      {/* ── Nappe translucide rouge ────────────────────────────────────────── */}
      <mesh geometry={fillGeo} renderOrder={11} raycast={NO_RAYCAST}>
        <meshBasicMaterial
          color={FILL_COLOR}
          transparent
          opacity={FILL_OPACITY}
          side={THREE.DoubleSide}
          depthWrite={false}
          toneMapped={false}
        />
      </mesh>

      {/* ── Marqueurs cubiques blancs aux coins ────────────────────────────── */}
      {markerRing.map((p, i) => (
        <mesh
          key={i}
          position={[p.x, p.y, p.z]}
          renderOrder={15}
          raycast={NO_RAYCAST}
        >
          <boxGeometry args={[MARKER_SIZE, MARKER_SIZE, MARKER_SIZE]} />
          <meshBasicMaterial
            color={MARKER_COLOR}
            transparent
            opacity={0.88}
            depthWrite={false}
            toneMapped={false}
          />
        </mesh>
      ))}
    </>
  );
}
