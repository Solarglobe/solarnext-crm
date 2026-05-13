/**
 * Fond plan texturé — orthophoto dans la scène ENU (Z up).
 *
 * IMPORTANT PRODUIT : le canvas 2D fait
 *   drawImage(roofImg, 0, 0, imgW, imgH, …)
 * avec imgW/imgH = CALPINAGE_STATE.roof.image.width/height.
 * Si le bitmap décodé (naturalWidth × naturalHeight) est plus grand, seule la zone
 * [0, imgW) × [0, imgH) est utilisée en 2D. Sans correction, le plane 3D étirait
 * toute la texture sur imgW*mpp × imgH*mpp → décalage bâtiment / toit.
 *
 * Ici : repeat/offset sur la texture pour n’afficher que la même sous-rectangle source
 * que le canvas 2D (quand natural ≥ déclaré).
 */

import { useEffect, useLayoutEffect, useMemo, useState } from "react";
import * as THREE from "three";

export interface GroundPlaneImageData {
  readonly dataUrl: string;
  readonly widthPx: number;
  readonly heightPx: number;
}

export interface GroundPlaneConfig {
  readonly image: GroundPlaneImageData;
  readonly metersPerPixel: number;
  readonly northAngleDeg: number;
}

function useDataUrlTexture(dataUrl: string): THREE.Texture | null {
  const [texture, setTexture] = useState<THREE.Texture | null>(null);

  useEffect(() => {
    const img = new Image();
    const tex = new THREE.Texture(img);
    /** true (défaut Three.js) : corrige la convention WebGL (V=0=bas) pour aligner image HTML (row 0=haut)
     *  avec l'UV Three.js (V=1=local+Y=monde Y=0=haut image per imagePxToWorldHorizontalM).
     *  flipY=false provoquait une inversion N/S de l'orthophoto par rapport aux panneaux. */
    tex.flipY = true;
    tex.colorSpace = THREE.SRGBColorSpace;
    tex.minFilter = THREE.LinearMipmapLinearFilter;
    tex.magFilter = THREE.LinearFilter;
    tex.wrapS = THREE.ClampToEdgeWrapping;
    tex.wrapT = THREE.ClampToEdgeWrapping;

    img.onload = () => {
      tex.needsUpdate = true;
      setTexture(tex);
    };
    img.onerror = () => {
      if (import.meta.env.DEV) {
        console.error("[GroundPlaneTexture] impossible de décoder l’image fond plan");
      }
    };
    img.src = dataUrl;

    return () => {
      tex.dispose();
    };
  }, [dataUrl]);

  return texture;
}

/**
 * Ajuste la texture pour coller au recadrage source du canvas 2D (voir en-tête).
 */
function applyTextureCropToMatch2DCanvas(
  texture: THREE.Texture,
  declaredW: number,
  declaredH: number,
): { naturalW: number; naturalH: number; repeatX: number; repeatY: number } {
  const img = texture.image as HTMLImageElement | undefined;
  const nw = img?.naturalWidth || (img as { width?: number })?.width || declaredW;
  const nh = img?.naturalHeight || (img as { height?: number })?.height || declaredH;

  if (nw <= 0 || nh <= 0 || declaredW <= 0 || declaredH <= 0) {
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    texture.needsUpdate = true;
    return { naturalW: nw, naturalH: nh, repeatX: 1, repeatY: 1 };
  }

  if (nw < declaredW || nh < declaredH) {
    console.warn(
      "[GroundPlaneTexture] Bitmap plus petit que les dimensions déclarées — alignement 2D/3D incertain",
      { naturalW: nw, naturalH: nh, declaredW, declaredH },
    );
    texture.repeat.set(1, 1);
    texture.offset.set(0, 0);
    texture.needsUpdate = true;
    return { naturalW: nw, naturalH: nh, repeatX: 1, repeatY: 1 };
  }

  const repeatX = declaredW / nw;
  const repeatY = declaredH / nh;
  texture.repeat.set(repeatX, repeatY);
  /** Même sous-rectangle source que le canvas 2D ; avec flipY=false l’offset reste la cheville ouvrière V. */
  texture.offset.set(0, 1 - repeatY);
  texture.needsUpdate = true;
  return { naturalW: nw, naturalH: nh, repeatX, repeatY };
}

function computeGroundPlacement(
  widthPx: number,
  heightPx: number,
  metersPerPixel: number,
  northAngleDeg: number,
) {
  const widthM = widthPx * metersPerPixel;
  const heightM = heightPx * metersPerPixel;
  const rad = (northAngleDeg * Math.PI) / 180;
  const cos = Math.cos(rad);
  const sin = Math.sin(rad);
  const halfW = widthM / 2;
  const halfH = heightM / 2;
  const cx = halfW * cos + halfH * sin;
  const cy = halfW * sin - halfH * cos;
  return { widthM, heightM, cx, cy, rad, cos, sin };
}

export function GroundPlaneTexture({
  config,
  zLevel,
  debugMode = false,
}: {
  readonly config: GroundPlaneConfig;
  readonly zLevel: number;
  readonly debugMode?: boolean;
}) {
  const { image, metersPerPixel, northAngleDeg } = config;
  const texture = useDataUrlTexture(image.dataUrl);

  const placement = useMemo(
    () => computeGroundPlacement(image.widthPx, image.heightPx, metersPerPixel, northAngleDeg),
    [image.widthPx, image.heightPx, metersPerPixel, northAngleDeg],
  );

  const [intrinsicLog, setIntrinsicLog] = useState<{
    naturalW: number;
    naturalH: number;
    repeatX: number;
    repeatY: number;
  } | null>(null);

  useLayoutEffect(() => {
    if (!texture?.image) return;
    const meta = applyTextureCropToMatch2DCanvas(texture, image.widthPx, image.heightPx);
    setIntrinsicLog(meta);
    if (debugMode || (typeof window !== "undefined" && (window as unknown as { __CALPINAGE_3D_DEBUG__?: boolean }).__CALPINAGE_3D_DEBUG__)) {
      const mismatch =
        meta.naturalW !== image.widthPx || meta.naturalH !== image.heightPx;
      console.info("[GroundPlaneTexture] alignement texture ↔ canvas 2D", {
        declaredPx: { w: image.widthPx, h: image.heightPx },
        naturalPx: { w: meta.naturalW, h: meta.naturalH },
        textureRepeat: { x: meta.repeatX, y: meta.repeatY },
        cropApplied: mismatch && meta.naturalW >= image.widthPx && meta.naturalH >= image.heightPx,
      });
    }
  }, [texture, image.widthPx, image.heightPx, debugMode]);

  if (!texture) return null;

  return (
    <group>
      <mesh position={[placement.cx, placement.cy, zLevel]} rotation={[0, 0, placement.rad]}>
        <planeGeometry args={[placement.widthM, placement.heightM]} />
        <meshBasicMaterial map={texture} side={THREE.FrontSide} toneMapped={false} />
      </mesh>
      {debugMode && intrinsicLog && (
        <GroundDebugMarkers
          placement={placement}
          zLevel={zLevel}
          config={config}
          intrinsic={intrinsicLog}
        />
      )}
    </group>
  );
}

function GroundDebugMarkers({
  placement,
  zLevel,
  config,
  intrinsic,
}: {
  readonly placement: ReturnType<typeof computeGroundPlacement>;
  readonly zLevel: number;
  readonly config: GroundPlaneConfig;
  readonly intrinsic: { naturalW: number; naturalH: number; repeatX: number; repeatY: number };
}) {
  const { cos, sin } = placement;
  const mpp = config.metersPerPixel;
  const W = config.image.widthPx;
  const H = config.image.heightPx;

  const corners = useMemo(() => {
    function px2w(xPx: number, yPx: number) {
      const x0 = xPx * mpp;
      const y0 = -yPx * mpp;
      return { x: x0 * cos - y0 * sin, y: x0 * sin + y0 * cos };
    }
    return {
      tl: px2w(0, 0),
      tr: px2w(W, 0),
      bl: px2w(0, H),
      br: px2w(W, H),
    };
  }, [W, H, mpp, cos, sin]);

  const dz = zLevel + 0.02;

  const wireGeo = useMemo(() => {
    const pts = new Float32Array([
      corners.tl.x, corners.tl.y, dz,
      corners.tr.x, corners.tr.y, dz,
      corners.tr.x, corners.tr.y, dz,
      corners.br.x, corners.br.y, dz,
      corners.br.x, corners.br.y, dz,
      corners.bl.x, corners.bl.y, dz,
      corners.bl.x, corners.bl.y, dz,
      corners.tl.x, corners.tl.y, dz,
    ]);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.Float32BufferAttribute(pts, 3));
    return geo;
  }, [corners, dz]);

  useEffect(() => {
    return () => {
      wireGeo.dispose();
    };
  }, [wireGeo]);

  return (
    <group>
      <lineSegments geometry={wireGeo}>
        <lineBasicMaterial color="#00ff88" />
      </lineSegments>
      {/* Légende discrète : mismatch déclaré / naturel */}
      {intrinsic.naturalW !== W || intrinsic.naturalH !== H ? (
        <mesh position={[placement.cx, placement.cy, dz + 0.05]}>
          <sphereGeometry args={[Math.max(placement.widthM, placement.heightM) * 0.015, 6, 6]} />
          <meshBasicMaterial color="#ff00ff" />
        </mesh>
      ) : null}
    </group>
  );
}
