/**
 * Interface MapProvider — Normalisation des providers cartographiques
 *
 * Garantit init/destroy propres, heading cohérent (nord = 0°, sens horaire),
 * et interchangeabilité sans impact sur le calpinage.
 *
 * @see RAPPORT_AUTOPSIE_CALPINAGE_COMPLET.md
 */

/** Options d'initialisation de la carte */
export interface MapInitOptions {
  /** Centre initial { lat, lon } */
  center?: { lat: number; lon: number };
  /** Niveau de zoom initial */
  zoom?: number;
  /** Orientation initiale en degrés (nord = 0, sens horaire) */
  heading?: number;
}

/** Événements exposés par le provider */
export type MapEvent = "dragstart" | "heading_changed" | "center_changed" | "zoom_changed";

/**
 * Interface unique et stable de provider cartographique.
 * Implémentée par Google Maps et Ortho/IGN/Leaflet.
 *
 * Note : createMapProvider(source, container) crée et initialise le provider en une seule étape.
 * init() est optionnel (no-op si déjà initialisé).
 */
export interface MapProvider {
  /** Optionnel : createMapProvider initialise déjà la carte. */
  init?(container: HTMLElement, options?: MapInitOptions): Promise<void>;

  /**
   * Détruit la carte et libère toutes les ressources.
   * Aucun listener ne doit rester actif après destroy.
   */
  destroy(): void;

  /** Centre actuel (lat, lon) */
  getCenter(): { lat: number; lon: number };

  /** Niveau de zoom actuel */
  getZoom(): number;

  /**
   * Orientation en degrés.
   * Convention : nord = 0°, sens horaire.
   * Même référence pour tous les providers.
   */
  getHeading(): number;

  /** Définit l'orientation (degrés). No-op si le provider ne supporte pas la rotation. */
  setHeading(deg: number): void;

  /** Projette lat/lon → pixels du conteneur */
  projectLatLonToPixel(lat: number, lon: number): { x: number; y: number };

  /** Projette pixels du conteneur → lat/lon */
  projectPixelToLatLon(x: number, y: number): { lat: number; lon: number };

  /** Abonne un handler à un événement */
  on(event: MapEvent, handler: () => void): void;

  /** Désabonne un handler */
  off(event: MapEvent, handler: () => void): void;

  /**
   * Déplace la vue vers center/zoom (sans animation).
   */
  setView(center: { lat: number; lon: number } | [number, number], zoom: number): void;

  /**
   * Déplace la vue avec animation (si supporté).
   */
  flyTo?(center: { lat: number; lon: number } | [number, number], zoom: number, options?: { duration?: number }): void;

  /**
   * Capture la vue actuelle (image + échelle).
   */
  capture(): Promise<CaptureResult>;

  /**
   * Force un recalcul de la taille (après resize du conteneur).
   */
  resize?(): void;
}

/** Résultat de la capture de la carte */
export interface CaptureResult {
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
}
