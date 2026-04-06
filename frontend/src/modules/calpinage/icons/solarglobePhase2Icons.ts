/**
 * SolarGlobe Icon System v2 — Phase 2
 * Icônes premium architecturales pour toolbar et dropdowns.
 * Charte : 24x24 viewBox, stroke-width 1.75, stroke-linecap/join round,
 * stroke="currentColor", fill="none". SVG inner uniquement.
 * Attributs stroke-width/linecap/linejoin hérités du parent <svg class="sg-icon">.
 */
export const SG_P2_ICONS = {
  /** Dessin toiture — polygone toit stylisé */
  roofDraw: `<path d="M5 16L8 9h8l3 7H5z"/>`,

  /** Contour bâti — polygone fermé */
  buildingOutline: `<path d="M4 18V8l8-4 8 4v10H4z"/>`,

  /** Arête — ligne libre */
  edge: `<path d="M5 12h14"/>`,

  /** Faîtage — ligne de rupture */
  ridge: `<path d="M4 12h6M14 12h6M10 8v8"/>`,

  /** Éditer hauteur — double flèche verticale */
  heightEdit: `<path d="M12 5v14M9 8l3-3 3 3M9 16l3 3 3-3"/>`,

  /** Obstacle toiture — forme d’emprise au sol */
  roofObstacle: `<path d="M6 6h12v12H6zM9 9v6M15 9v6M9 12h6"/>`,

  /** Cercle */
  circle: `<circle cx="12" cy="12" r="7"/>`,

  /** Rectangle */
  rect: `<path d="M6 6h12v12H6z"/>`,

  /** Polygone libre */
  polygon: `<path d="M12 4l6 6-2 8h-8l-2-8 6-6z"/>`,

  /** Obstacle ombrant — volume 3D */
  shadingObstacle: `<path d="M6 18V6l6-3 6 3v12l-6 3-6-3z"/><path d="M6 6l6 3 6-3M12 21V9"/>`,

  /** Tube — cylindre */
  tube: `<path d="M8 6c0-2 1.5-3 4-3s4 1 4 3v12c0 2-1.5 3-4 3s-4-1-4-3V6z"/><path d="M8 9h8M8 15h8"/>`,

  /** Cube — prisme rectangulaire */
  cube: `<path d="M12 3l8 4.5v9L12 21l-8-4.5v-9L12 3z"/><path d="M12 12v9M20 7.5L12 12 4 7.5"/>`,

  /** Extension toiture — chien assis */
  roofExtension: `<path d="M4 18V10l4-4h8l4 4v8"/><path d="M8 6v4M16 6v4M12 14v4"/>`,
};
