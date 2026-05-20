/**
 * Champs optionnels pour l'interpretation visuelle 3D des chiens assis (`roofExtensions` runtime).
 * Aucune obligation de persistance : les projets sans ces cles conservent le comportement historique.
 */

/** Sous-type de lucarne / chien assis. */
export type RuntimeRoofExtensionDormerType = "gable" | string;

/**
 * Extension toiture cote runtime (sur-ensemble minimal pour le rendu dormer premium).
 * Les proprietes existantes (`ridge`, `contour`, `ridgeHeightRelM`, `id`, `kind`, ...) restent inchangees.
 */
export interface RuntimeRoofExtensionVisualAugment {
  /** Calpinage legacy : `"roof_extension"` + `kind: "dormer"`. */
  readonly type?: string;
  readonly kind?: string;
  readonly dormerType?: RuntimeRoofExtensionDormerType;
  /** Mode visuel 3D explicite : volume metier parametrique, pas extrusion directe des traits de dessin. */
  readonly visualModel?: "parametric_gable" | string;
  /** Profondeur metrique indicative. */
  readonly depthM?: number;
  /** Hauteur de facade verticale (m), derivee si absente. */
  readonly wallHeightM?: number;
  /** Surhausse du toit du chien assis au-dessus des murs verticaux (m). */
  readonly roofRiseM?: number;
  /**
   * @deprecated Compat migration 2D uniquement. La 3D produit, le PV, les safe-zones et
   * le shading doivent lire `canonicalV1` -> `extensionVolumes`.
   */
  readonly dormerModel?: {
    readonly version?: number;
    readonly source?: string;
    readonly front?: {
      readonly a?: { readonly x?: number; readonly y?: number };
      readonly b?: { readonly x?: number; readonly y?: number };
    };
    readonly ridge?: {
      readonly a?: { readonly x?: number; readonly y?: number };
      readonly b?: { readonly x?: number; readonly y?: number };
    };
    readonly hips?: {
      readonly left?: {
        readonly a?: { readonly x?: number; readonly y?: number };
        readonly b?: { readonly x?: number; readonly y?: number };
      };
      readonly right?: {
        readonly a?: { readonly x?: number; readonly y?: number };
        readonly b?: { readonly x?: number; readonly y?: number };
      };
    };
  };
  /**
   * @deprecated Ancien maillage explicite Phase 2. Il ne doit plus redevenir une source
   * produit ; il est seulement conservé pour lire d'anciens dossiers puis migrer vers `canonicalV1`.
   */
  readonly canonicalDormerGeometry?: {
    readonly version?: number;
    readonly coordinateSpace?: "image_px_height_m" | string;
    readonly heightReference?: "vertical_from_main_roof" | string;
    readonly vertices?: ReadonlyArray<{
      readonly id?: string;
      readonly role?: string;
      readonly x?: number;
      readonly y?: number;
      readonly h?: number;
    }>;
    readonly edges?: ReadonlyArray<{
      readonly id?: string;
      readonly a?: string;
      readonly b?: string;
      readonly role?: string;
    }>;
    readonly faces?: ReadonlyArray<{
      readonly id?: string;
      readonly role?: string;
      readonly vertexIds?: readonly string[];
    }>;
  };
}
