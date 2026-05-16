/**
 * Phase A — Interface de découplage : résolution des hauteurs Z.
 *
 * CONTRAT UNIQUEMENT — aucune implémentation, aucune référence à window.*.
 *
 * Rôle : permettre aux moteurs extraits (pvPlacementEngine, roofGeometryEngine)
 * de demander la hauteur Z d'un point ou d'un sommet sans dépendre directement
 * de la runtime legacy (window.getHeightAtXY, CalpinagePans.fitPlane, etc.).
 *
 * Implémentations prévues :
 *   - RuntimeHeightResolver   (Phase 1 / 2) — lit window.getHeightAtXY via CalpinageRuntime
 *   - StoreHeightResolver     (Phase 3+)    — lit depuis calpinageStore.vertices[id].heightM
 *   - FallbackHeightResolver  (tests)       — retourne une valeur constante configurable
 *
 * Consommateurs prévus :
 *   - engine/pvPlacementEngine/pvPlacementEngine.ts
 *   - engine/roofGeometryEngine/faceSolver.ts
 *   - engine/roofGeometryEngine/heightInterpolator.ts
 *
 * Ne PAS importer dans ce fichier :
 *   - window, document ou tout global browser
 *   - calpinageRuntime.ts, calpinage.module.js
 *   - calpinageStore (dépendance circulaire potentielle)
 */

// ─────────────────────────────────────────────────────────────────────────────
// TYPE AUXILIAIRE — résolution par sommet
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résultat d'une résolution de hauteur avec traçabilité de la source.
 * Permet aux moteurs de décider comment traiter les hauteurs inférées vs explicites.
 */
export interface HeightResolution {
  /** Hauteur résolue (m, repère vertical absolu du chantier). */
  readonly heightM: number;
  /**
   * Source de la résolution — pour diagnostics et confiance downstream.
   *
   * "explicit"  : saisie directe par l'utilisateur (sommet de pan, faîtage…)
   * "runtime"   : calculée par fitPlane via getHeightAtXY (pans-bundle)
   * "fallback"  : valeur par défaut (aucun signal disponible)
   */
  readonly source: "explicit" | "runtime" | "fallback";
  /** true si la valeur est fiable pour les calculs PV (source explicite ou runtime fitPlane). */
  readonly reliable: boolean;
  /**
   * Raison du fallback — présent uniquement quand reliable === false.
   * Permet aux diagnostics aval d'identifier la cause précise sans inspecter la stack.
   *
   * "RUNTIME_NOT_MOUNTED" : getCalpinageRuntime().getHeightAtXY() absent au moment de la résolution.
   */
  readonly reason?: string;
}

// ─────────────────────────────────────────────────────────────────────────────
// INTERFACE PRINCIPALE
// ─────────────────────────────────────────────────────────────────────────────

/**
 * Résolveur de hauteurs Z — contrat d'injection pour les moteurs extraits.
 *
 * Toutes les méthodes sont synchrones (le runtime legacy getHeightAtXY est synchrone).
 * Les implémentations async (ex. DSM serveur) devront adapter via un cache pré-chargé.
 */
export interface HeightResolver {
  /**
   * Hauteur Z en un point image (xPx, yPx), avec contexte pan optionnel.
   *
   * @param xPx    — coordonnée X pixel (origine haut-gauche, +x droite)
   * @param yPx    — coordonnée Y pixel (origine haut-gauche, +y bas)
   * @param panId  — ID du pan porteur (améliore la précision fitPlane si connu)
   * @returns HeightResolution avec source et fiabilité
   */
  getHeightAtImagePoint(xPx: number, yPx: number, panId?: string): HeightResolution;

  /**
   * Hauteur Z d'un sommet identifié par son ID stable (vertex du contour ou pan).
   *
   * @param vertexId — identifiant stable du sommet dans le store ou runtime
   * @returns HeightResolution, ou null si le sommet est inconnu
   */
  getVertexHeight(vertexId: string): HeightResolution | null;

  /**
   * Indique si ce résolveur peut fournir des hauteurs issues du runtime (fitPlane).
   * false → toutes les résolutions seront "fallback" (utile pour les tests).
   */
  readonly isRuntimeAvailable: boolean;
}
