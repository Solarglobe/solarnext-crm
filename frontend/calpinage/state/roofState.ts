/**
 * State global de la base toiture (étapes 5.1 / 5.2 calpinage).
 * map : paramètres de la carte au moment de la capture.
 * image : image capturée (dataUrl + dimensions pixels image + css au moment capture).
 * scale : échelle (metersPerPixel = mètres par pixel IMAGE), rempli automatiquement à la capture.
 * calibration : méta en mode auto-google (sans points A/B).
 * roof.north : orientation du Nord dans le référentiel IMAGE (0 = haut image).
 */
export type NorthMode = "auto-google" | "manual";

export type NorthState = {
  mode: NorthMode;
  /** Angle du Nord par rapport à l'axe Y image (0 = haut image). Non normalisé (angle signé). */
  angleDeg: number;
};

export const roofState = {
  map: null as null | {
    provider: "google";
    centerLatLng: { lat: number; lng: number };
    zoom: number;
    bearing: number;
  },

  image: null as null | {
    dataUrl: string;
    width: number; // pixels image
    height: number; // pixels image
    cssWidth: number; // largeur DOM au moment capture (css px)
    cssHeight: number;
  },

  scale: null as null | {
    metersPerPixel: number; // mètres par pixel IMAGE
  },

  calibration: null as null | {
    mode: "auto-google";
    samplePx: number;
    sampleMeters: number;
    atLat: number;
    atZoom: number;
    bearing: number;
    note: string;
  },

  /** Référence Nord pour azimuts (pans, panneaux, export SmartPitch). */
  roof: {
    north: null as null | NorthState,
  },
};
