/**
 * Sélecteur de carte Google Satellite pour la base toiture (étape 5.1).
 * Initialise la carte, gère zoom/pan, expose capture du viewport.
 */

declare global {
  interface Window {
    google?: typeof google;
    html2canvas?: (element: HTMLElement, options?: object) => Promise<HTMLCanvasElement>;
  }
}

declare const google: {
  maps: {
    Map: new (el: HTMLElement, opts: object) => {
      getCenter(): { lat(): number; lng(): number } | null;
      getZoom(): number;
      getHeading?(): number;
      setTilt?(tilt: number): void;
      addListener?(event: string, fn: () => void): void;
    };
    MapTypeId: { SATELLITE: string };
    MapTypeControlStyle: { HORIZONTAL_BAR: number };
    ControlPosition: { TOP_RIGHT: number };
    OverlayView: new () => {
      setMap(map: google.maps.Map | null): void;
      getProjection(): {
        fromContainerPixelToLatLng(p: google.maps.Point): google.maps.LatLng | null;
      } | null;
    };
    Point: new (x: number, y: number) => google.maps.Point;
    LatLng: unknown;
    geometry: {
      spherical: {
        computeDistanceBetween(a: unknown, b: unknown): number;
      };
    };
  };
};

const DEFAULT_CENTER = { lat: 48.8566, lng: 2.3522 };
const DEFAULT_ZOOM = 19;

export type MapState = {
  centerLatLng: { lat: number; lng: number };
  zoom: number;
  bearing: number;
};

export type CaptureResult = {
  image: {
    dataUrl: string;
    width: number;
    height: number;
    cssWidth: number;
    cssHeight: number;
  };
  scale: {
    metersPerPixelImage: number;
    sampleMeters: number;
    samplePx: number;
  };
};

export type GoogleMapApi = {
  getState(): MapState;
  capture(): Promise<CaptureResult>;
};

let mapInstance: google.maps.Map | null = null;
let mapContainer: HTMLElement | null = null;
let projectionOverlay: PixelProjectionOverlay | null = null;

function getHeading(map: google.maps.Map): number {
  if (typeof map.getHeading === "function") {
    return map.getHeading() || 0;
  }
  return 0;
}

/**
 * Normalise l’image capturée (flip vertical) pour corriger l’inversion
 * due aux transforms internes de Google Maps lors de la capture html2canvas.
 */
function normalizeCapturedImage(
  sourceCanvas: HTMLCanvasElement
): { dataUrl: string; width: number; height: number } {
  const w = sourceCanvas.width;
  const h = sourceCanvas.height;

  const fixedCanvas = document.createElement("canvas");
  fixedCanvas.width = w;
  fixedCanvas.height = h;

  const ctx = fixedCanvas.getContext("2d");
  if (!ctx) throw new Error("2D context unavailable");

  // Flip vertical pour corriger l’inversion Google Maps
  ctx.translate(0, h);
  ctx.scale(1, -1);

  ctx.drawImage(sourceCanvas, 0, 0, w, h);

  return {
    dataUrl: fixedCanvas.toDataURL("image/png"),
    width: w,
    height: h,
  };
}

/**
 * OverlayView minimal pour exposer getProjection() (container pixels → LatLng).
 */
class PixelProjectionOverlay extends google.maps.OverlayView {
  onAdd(): void {}
  draw(): void {}
  onRemove(): void {}
}

/**
 * Calcule metersPerPixel pour l'image capturée (1 pixel = 1 pixel image).
 * Utilise la projection Google au centre du container (lat-dépendant).
 */
function computeMetersPerPixelImage(params: {
  map: google.maps.Map;
  overlay: InstanceType<typeof PixelProjectionOverlay>;
  containerEl: HTMLElement;
  imageWidthPx: number;
  imageHeightPx: number;
  samplePx?: number;
}): {
  metersPerPixelImage: number;
  sampleMeters: number;
  samplePx: number;
} {
  const samplePx = params.samplePx ?? 200;

  const rect = params.containerEl.getBoundingClientRect();
  const cssW = rect.width;
  const cssH = rect.height;

  const ratioX = params.imageWidthPx / cssW;

  const proj = params.overlay.getProjection();
  if (!proj || typeof proj.fromContainerPixelToLatLng !== "function") {
    throw new Error("Projection Google indisponible (OverlayView).");
  }

  const cx = cssW / 2;
  const cy = cssH / 2;

  const p1 = new google.maps.Point(cx - samplePx / 2, cy);
  const p2 = new google.maps.Point(cx + samplePx / 2, cy);

  const ll1 = proj.fromContainerPixelToLatLng(p1);
  const ll2 = proj.fromContainerPixelToLatLng(p2);
  if (!ll1 || !ll2) {
    throw new Error("Projection Google : fromContainerPixelToLatLng a retourné null.");
  }

  const meters = google.maps.geometry.spherical.computeDistanceBetween(ll1, ll2);
  const metersPerCssPx = meters / samplePx;
  const metersPerImagePx = metersPerCssPx / ratioX;

  return {
    metersPerPixelImage: metersPerImagePx,
    sampleMeters: meters,
    samplePx,
  };
}

/**
 * Initialise la carte Google en mode Satellite dans le conteneur donné.
 * Zoom/pan gérés nativement par la carte.
 */
export function initGoogleMap(container: HTMLElement): GoogleMapApi {
  if (typeof google === "undefined" || !google.maps) {
    throw new Error("Google Maps API non chargée. Vérifiez le script et la clé API.");
  }

  mapContainer = container;
  mapInstance = new google.maps.Map(container, {
    center: DEFAULT_CENTER,
    zoom: 19,
    mapTypeId: "hybrid", // satellite + labels (noms de rues)
    tilt: 0,
    heading: 0,

    mapTypeControl: true,
    mapTypeControlOptions: {
      style: google.maps.MapTypeControlStyle.HORIZONTAL_BAR,
      position: google.maps.ControlPosition.TOP_RIGHT,
      mapTypeIds: ["roadmap", "satellite", "hybrid"],
    },

    rotateControl: true,
    scaleControl: true,
    streetViewControl: false,
    fullscreenControl: false,
  });

  projectionOverlay = new PixelProjectionOverlay();
  projectionOverlay.setMap(mapInstance);

  // Inclinaison de la carte selon le zoom (si l’API le permet)
  if (typeof mapInstance.addListener === "function" && typeof mapInstance.setTilt === "function") {
    mapInstance.addListener("zoom_changed", () => {
      const z = mapInstance ? mapInstance.getZoom() ?? 0 : 0;
      if (z >= 18) {
        mapInstance!.setTilt!(45); // Google active le relief si dispo
      } else {
        mapInstance!.setTilt!(0);
      }
    });
  }

  return {
    getState(): MapState {
      if (!mapInstance) {
        return {
          centerLatLng: DEFAULT_CENTER,
          zoom: DEFAULT_ZOOM,
          bearing: 0,
        };
      }
      const center = mapInstance.getCenter();
      const lat = center ? center.lat() : DEFAULT_CENTER.lat;
      const lng = center ? center.lng() : DEFAULT_CENTER.lng;
      return {
        centerLatLng: { lat, lng },
        zoom: mapInstance.getZoom() ?? DEFAULT_ZOOM,
        bearing: getHeading(mapInstance),
      };
    },

    async capture(): Promise<CaptureResult> {
      if (!mapContainer || !mapInstance) {
        throw new Error("Carte non initialisée");
      }
      if (!projectionOverlay) {
        throw new Error("Overlay de projection non initialisé.");
      }
      if (typeof window.html2canvas !== "function") {
        throw new Error("html2canvas non chargé. Ajoutez le script html2canvas pour la capture.");
      }
      const rect = mapContainer.getBoundingClientRect();
      const rawCanvas = await window.html2canvas(mapContainer, {
        useCORS: true,
        allowTaint: true,
        logging: false,
        scale: 1,
      });
      const fixed = normalizeCapturedImage(rawCanvas);

      const scaleInfo = computeMetersPerPixelImage({
        map: mapInstance,
        overlay: projectionOverlay,
        containerEl: mapContainer,
        imageWidthPx: fixed.width,
        imageHeightPx: fixed.height,
        samplePx: 200,
      });

      return {
        image: {
          dataUrl: fixed.dataUrl,
          width: fixed.width,
          height: fixed.height,
          cssWidth: rect.width,
          cssHeight: rect.height,
        },
        scale: scaleInfo,
      };
    },
  };
}
