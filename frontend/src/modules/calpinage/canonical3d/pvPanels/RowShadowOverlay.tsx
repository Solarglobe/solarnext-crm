/**
 * RowShadowOverlay — Visualisation 3D des ombres inter-rangées (row-to-row shading).
 *
 * Pour chaque panneau, si la position solaire courante crée une ombre portée
 * sur la rangée suivante, un plan translucide est rendu au sol devant la rangée.
 *
 * Formule ombre : L_ombre = H × cos(β) / sin(α)
 *   avec H = hauteur du panneau projetée verticalement (heightM × sin(tiltDeg))
 *        β = inclinaison du panneau (tiltDeg)
 *        α = élévation solaire (elevationDeg)
 *
 * L'ombre n'est rendue que si :
 *   - elevationDeg > 0 (jour)
 *   - L_ombre > 0 (géométrie cohérente)
 *   - La face du panneau est exposée au soleil (dot produit normal × direction soleil > 0)
 *
 * Composant @react-three/fiber pur — aucune mutation store, aucun effet de bord.
 */

import { useEffect, useMemo } from "react";
import * as THREE from "three";
import { computeSunPosition } from "../../dsmOverlay/solarPosition";

// ── Types ─────────────────────────────────────────────────────────────────────

export interface RowShadowPanelInput {
  centerWorld: [number, number, number];
  normalWorld: [number, number, number];
  widthM: number;
  heightM: number;
  tiltDeg: number;
  azimuthDeg: number;
}

export interface RowShadowOverlayProps {
  panels: RowShadowPanelInput[];
  pitchM: number;
  currentHourUTC: number; // timestamp ms UTC
  lat: number;
  lon: number;
  visible: boolean;
}

// ── Constantes visuelles ──────────────────────────────────────────────────────

const SHADOW_COLOR = new THREE.Color("#4466aa");
const SHADOW_OPACITY = 0.35;

// ── Helpers géométriques ──────────────────────────────────────────────────────

/** Converti deg → rad */
function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}

/**
 * Calcule la longueur de l'ombre projetée au sol par un panneau incliné.
 * Retourne null si l'ombre n'est pas calculable (soleil sous l'horizon, etc.).
 *
 * @param heightM     hauteur physique du panneau (le long du plan incliné)
 * @param tiltDeg     inclinaison du panneau par rapport à l'horizontale
 * @param elevationDeg élévation solaire (degrés au-dessus de l'horizon)
 */
function computeShadowLengthM(
  heightM: number,
  tiltDeg: number,
  elevationDeg: number,
): number | null {
  if (elevationDeg <= 0) return null;
  const alpha = toRad(elevationDeg);
  const beta = toRad(tiltDeg);
  // Hauteur verticale du haut du panneau au-dessus de la base
  const H = heightM * Math.sin(beta);
  if (H <= 0) return null;
  const shadowLen = (H * Math.cos(beta)) / Math.sin(alpha);
  return shadowLen > 0 ? shadowLen : null;
}

/**
 * Vecteur direction du soleil en world space (ENU : X=Est, Y=Nord, Z=haut).
 * azimuth 0° = Nord, 90° = Est (convention météo → convertie en ENU).
 */
function sunDirectionENU(azimuthDeg: number, elevationDeg: number): THREE.Vector3 {
  const az = toRad(azimuthDeg);
  const el = toRad(elevationDeg);
  // Convention ENU : X=Est, Y=Nord
  const x = Math.sin(az) * Math.cos(el);
  const y = Math.cos(az) * Math.cos(el);
  const z = Math.sin(el);
  return new THREE.Vector3(x, y, z).normalize();
}

// ── Composant ─────────────────────────────────────────────────────────────────

/**
 * Rend les ombres inter-rangées pour une liste de panneaux.
 * Doit être placé à l'intérieur d'un <Canvas> @react-three/fiber.
 */
export function RowShadowOverlay({
  panels,
  pitchM: _pitchM,
  currentHourUTC,
  lat,
  lon,
  visible,
}: RowShadowOverlayProps) {
  // Calcul de la position solaire pour l'heure sélectionnée
  const sunPos = useMemo(() => {
    return computeSunPosition(new Date(currentHourUTC), lat, lon);
  }, [currentHourUTC, lat, lon]);

  // Géométrie des ombres — recalculée uniquement si sun/panels changent
  const shadowMeshes = useMemo(() => {
    if (!visible) return [];
    if (!sunPos || sunPos.elevationDeg <= 0) return [];

    const { azimuthDeg, elevationDeg } = sunPos;
    const sunDir = sunDirectionENU(azimuthDeg, elevationDeg);

    return panels
      .map((panel, idx) => {
        // Test d'exposition : la normale du panneau doit pointer vers le soleil
        const normal = new THREE.Vector3(...panel.normalWorld).normalize();
        const exposure = normal.dot(sunDir);
        if (exposure <= 0) return null; // panneau dos au soleil

        const shadowLen = computeShadowLengthM(
          panel.heightM,
          panel.tiltDeg,
          elevationDeg,
        );
        if (shadowLen === null || shadowLen <= 0) return null;

        // Direction de projection de l'ombre au sol (projection horizontale du soleil)
        // L'ombre va dans la direction opposée à la composante horizontale du soleil
        const shadowDirHoriz = new THREE.Vector3(sunDir.x, sunDir.y, 0).normalize();
        // Si la composante horizontale est quasi nulle (soleil au zénith), pas d'ombre portée
        if (shadowDirHoriz.lengthSq() < 1e-6) return null;

        // Centre de l'ombre : part du bas du panneau, s'étend dans la direction opposée au soleil
        const cx = panel.centerWorld[0];
        const cy = panel.centerWorld[1];
        const cz = panel.centerWorld[2];

        // Bas du panneau : center - (heightM/2) × (direction montante du panneau dans le plan incliné)
        // En simplifiant : on positionne l'ombre devant le centre, légèrement décalé vers le bas
        const halfHeight = panel.heightM / 2;
        const tiltRad = toRad(panel.tiltDeg);
        // Point de base du panneau au sol (approximation : projection verticale du bas du panneau)
        const baseZ = cz - halfHeight * Math.sin(tiltRad);

        // Centre de l'ombre au sol : décalé dans la direction opposée au soleil
        const shadowCenterX = cx - shadowDirHoriz.x * (shadowLen / 2);
        const shadowCenterY = cy - shadowDirHoriz.y * (shadowLen / 2);
        const shadowCenterZ = baseZ; // au sol (hauteur du bas du panneau)

        // Géométrie créée une seule fois dans ce useMemo — disposée via useEffect ci-dessous.
        // Évite la fuite GPU de <planeGeometry args> inline qui recréait une PlaneGeometry
        // à chaque changement de width/depth sans disposer l'ancienne.
        const geo = new THREE.PlaneGeometry(panel.widthM, shadowLen);
        return {
          key: `row-shadow-${idx}`,
          position: [shadowCenterX, shadowCenterY, shadowCenterZ] as [number, number, number],
          geo,
          // Rotation pour aligner le plan avec la direction d'ombre
          rotationZ: Math.atan2(shadowDirHoriz.x, shadowDirHoriz.y),
        };
      })
      .filter((m): m is NonNullable<typeof m> => m !== null);
  }, [panels, sunPos, visible]);

  // Dispose propre : libère la mémoire GPU quand shadowMeshes change ou au démontage.
  useEffect(() => {
    return () => {
      for (const m of shadowMeshes) m.geo.dispose();
    };
  }, [shadowMeshes]);

  if (!visible || shadowMeshes.length === 0) return null;

  return (
    <group name="row-shadow-overlay">
      {shadowMeshes.map((shadow) => (
        <mesh
          key={shadow.key}
          geometry={shadow.geo}
          position={shadow.position}
          rotation={[-Math.PI / 2, 0, shadow.rotationZ]}
          raycast={() => null}
        >
          <meshBasicMaterial
            color={SHADOW_COLOR}
            transparent
            opacity={SHADOW_OPACITY}
            depthWrite={false}
            side={THREE.DoubleSide}
          />
        </mesh>
      ))}
    </group>
  );
}
