/**
 * Modèle canonique cible — Moteur Maison 3D SolarNext.
 *
 * Contrat logique uniquement : aucun parseur runtime, aucune dépendance au legacy calpinage.
 * Repère cœur : LOCAL BÂTIMENT (m) — voir docs/architecture/canonical-house3d-model.md
 * Alignement 2D : docs/architecture/2d-entity-dictionary.md + .csv + 2d-entity-ambiguities.md
 */

/** Identifiant stable d’entité (UUID ou préfixe métier + hash). */
export type CanonicalHouseEntityId = string;

/** Vecteur position dans le repère local bâtiment (m). Z = hauteur métier locale, Z=0 = base officielle. */
export interface BuildingLocalVec3 {
  readonly x: number;
  readonly y: number;
  readonly z: number;
}

/** Polygone fermé dans le plan (X,Y) local, mètres — sens CCW recommandé pour extérieur. */
export type Polygon2DLocal = readonly Readonly<{ x: number; y: number }>[];

/** Statut de persistance sémantique d’un champ dans le document canonique. */
export type CanonicalFieldDataStatus = "primary" | "derived" | "future" | "optional" | "external";

/** Traçabilité obligatoire pour toute cote Z métier. */
export type HeightProvenance =
  | "user_input"
  | "business_rule"
  | "solver"
  | "fallback"
  | "reconstruction";

export type HeightRole =
  | "z_ground_local_optional"
  | "z_base"
  | "z_wall_top"
  | "z_eave"
  | "z_ridge"
  | "z_obstacle_base"
  | "z_obstacle_top"
  | "z_panel_mount"
  | "custom";

/** Hauteur métier locale traçable (m). */
export interface HeightQuantity {
  readonly id: CanonicalHouseEntityId;
  readonly role: HeightRole;
  readonly valueM: number;
  readonly provenance: HeightProvenance;
  /** Référence vers sommet / arête / patch / annexe source. */
  readonly sourceRef?: CanonicalHouseEntityId;
  /** Identifiant stable de règle métier (ex. height.default-eave-v1). */
  readonly derivationRuleId?: string;
}

export interface HeightConventionNotes {
  /** Texte court : définition de la base Z=0 pour ce document. */
  readonly basePlaneDescription: string;
}

export interface HeightModelBlock {
  readonly quantities: readonly HeightQuantity[];
  /** Convention : z base locale = 0, portée par HeightQuantity dédiée. */
  readonly zBase: HeightQuantity;
  readonly conventions: HeightConventionNotes;
}

/** Classification d’arête toit — couvre faîtage, noue, arêtier, rive, égout, pignon, etc. */
export type RoofEdgeKind =
  | "ridge"
  | "hip"
  | "valley"
  | "eave"
  | "gable"
  | "rake"
  | "wall_plate"
  | "internal_structural"
  | "unknown_structural"
  | "contour_perimeter";

export interface RoofTopologyVertex {
  readonly vertexId: CanonicalHouseEntityId;
  /** Position plan (X,Y) — Z peut être porté par heightModel ou sommet 3D dérivé. */
  readonly positionXY: Readonly<{ x: number; y: number }>;
  readonly heightQuantityId?: CanonicalHouseEntityId;
}

export interface RoofTopologyEdge {
  readonly edgeId: CanonicalHouseEntityId;
  readonly vertexIdA: CanonicalHouseEntityId;
  readonly vertexIdB: CanonicalHouseEntityId;
  readonly kind: RoofEdgeKind;
  /** Ex. entity_id du dictionnaire 2D ou id runtime source (trace parseur). */
  readonly source2dTrace?: string;
}

export interface RoofTopologyPatchRef {
  readonly roofPatchId: CanonicalHouseEntityId;
  readonly boundaryVertexIds: readonly CanonicalHouseEntityId[];
  readonly boundaryEdgeIds: readonly CanonicalHouseEntityId[];
}

export interface BindingRoofToBuilding {
  readonly roofPatchId: CanonicalHouseEntityId;
  readonly buildingId: CanonicalHouseEntityId;
  readonly note?: string;
}

export interface RoofTopology {
  readonly roofId: CanonicalHouseEntityId;
  readonly vertices: readonly RoofTopologyVertex[];
  readonly edges: readonly RoofTopologyEdge[];
  readonly patches: readonly RoofTopologyPatchRef[];
  readonly roofToBuildingBindings: readonly BindingRoofToBuilding[];
}

/** Géométrie 3D locale d’un patch (pan) — surface porteuse. */
export interface RoofPatchGeometry {
  readonly roofPatchId: CanonicalHouseEntityId;
  readonly boundaryLoop3d: readonly BuildingLocalVec3[];
  /** Normale unitaire sortante dans le repère local bâtiment. */
  readonly outwardNormal?: BuildingLocalVec3;
  readonly dataStatus: Extract<CanonicalFieldDataStatus, "derived" | "primary">;
}

export interface RoofEdgeGeometry {
  readonly edgeId: CanonicalHouseEntityId;
  readonly segment3d: readonly [BuildingLocalVec3, BuildingLocalVec3];
  readonly dataStatus: Extract<CanonicalFieldDataStatus, "derived" | "primary">;
}

export interface RoofGeometry {
  readonly roofPatches: readonly RoofPatchGeometry[];
  readonly roofEdges: readonly RoofEdgeGeometry[];
}

export interface RoofBlock {
  readonly topology: RoofTopology;
  readonly geometry: RoofGeometry;
}

/** Familles d’annexes — interdiction de fusionner sémantiquement. */
export type AnnexFamily =
  | "layout_keepout"
  | "physical_roof_obstacle"
  | "shading_volume"
  | "roof_extension"
  | "future_opening"
  | "future_parapet_acrotere";

export interface AnnexBase {
  readonly annexId: CanonicalHouseEntityId;
  readonly family: AnnexFamily;
  readonly attachedRoofPatchIds: readonly CanonicalHouseEntityId[];
  readonly dataStatus: CanonicalFieldDataStatus;
}

/** Géométrie annexe : union extensible — le parseur choisira la variante. */
export type AnnexGeometryLocal =
  | { readonly kind: "footprint_extrusion"; readonly footprint: Polygon2DLocal; readonly zBottomId: CanonicalHouseEntityId; readonly zTopId: CanonicalHouseEntityId }
  | { readonly kind: "mesh_ref"; readonly meshId: string }
  | { readonly kind: "placeholder"; readonly note: string };

export type AnnexDiscriminated = AnnexBase & {
  readonly geometry: AnnexGeometryLocal;
};

// ——— Annexes toiture 3D officielles (Prompt 8 — couche géométrique / métier) ———

/** Famille métier unique par objet annexe (pas de fusion sémantique). */
export type RoofAnnexOfficialFamily =
  | "roof_obstacle_solid"
  | "roof_opening"
  | "roof_keepout_zone"
  | "roof_shadow_volume"
  | "roof_extension_volume"
  | "roof_edge_uplift"
  | "roof_unknown_annex";

/** Résultat du rattachement XY d’une annexe aux pans topologiques résolus. */
export type RoofAnnexBindingStatus =
  | "fully_contained_single_patch"
  | "partial_overlap_single_patch"
  | "straddles_multiple_patches"
  | "outside_all_patches"
  | "ambiguous_patch_choice"
  | "no_solved_plane_for_primary_patch"
  | "no_footprint_geometry"
  | "degenerate_footprint";

export type RoofAnnexBindingConfidence = "high" | "medium" | "low" | "none";

/** Base Z issue du plan de pan résolu (vérité métier — pas getHeightAtXY / snap visuel). */
export interface RoofAnnexBaseReference {
  readonly method: "roof_patch_plane_evaluation";
  readonly roofPatchId: CanonicalHouseEntityId;
  readonly planeEquationImplicit: { readonly normal: BuildingLocalVec3; readonly d: number };
  /** Identifiants hauteur canonique utilisés pour l’extrusion (traçabilité). */
  readonly heightQuantityIds: Readonly<{
    readonly bottomId: CanonicalHouseEntityId;
    readonly topId: CanonicalHouseEntityId;
  }>;
}

export interface RoofAnnexHeightInfo {
  readonly heightM: number | null;
  readonly extrusionDirection: "along_patch_outward_normal" | "world_vertical_z" | "opening_no_extrusion";
  readonly notes?: string;
}

export type RoofAnnexGeometryStatus =
  | "volume_ok"
  | "opening_footprint_only"
  | "edge_uplift_deferred"
  | "height_missing"
  | "plane_unresolved"
  | "unsupported_non_planar_footprint";

export type RoofAnnexTopologyCompatibility =
  | "compatible"
  | "partial_overlap"
  | "crosses_roof_edge"
  | "crosses_patch_boundary"
  | "needs_roof_split"
  | "invalid_position"
  | "unsupported_geometry";

export interface CanonicalRoofAnnexItem {
  readonly annexId: CanonicalHouseEntityId;
  readonly annexFamily: RoofAnnexOfficialFamily;
  readonly sourceEntityKind: string;
  readonly roofPatchId: CanonicalHouseEntityId | null;
  readonly bindingStatus: RoofAnnexBindingStatus;
  readonly bindingConfidence: RoofAnnexBindingConfidence;
  readonly footprintOnRoofPlane: Polygon2DLocal | null;
  readonly bindingDiagnostics: readonly string[];
  readonly baseReference: RoofAnnexBaseReference | null;
  readonly footprint2D: Polygon2DLocal | null;
  readonly footprint3D: readonly BuildingLocalVec3[] | null;
  readonly heightInfo: RoofAnnexHeightInfo;
  readonly geometryStatus: RoofAnnexGeometryStatus;
  readonly topologyCompatibility: RoofAnnexTopologyCompatibility;
  readonly shadingRelevance: boolean;
  readonly cutCandidate: boolean;
  /** Extensions / lucarnes : statut de découpe topologique future (pas de fake split ici). */
  readonly extensionTopologyIntent: "simple_volume" | "sub_roof_structure" | "needs_dedicated_topology_split" | "n_a";
  readonly sideFacesTriangleIndices: readonly Readonly<{ a: number; b: number; c: number }>[] | null;
  readonly topFacePolygonVertexIndices: readonly number[] | null;
  readonly diagnostics: readonly string[];
}

export interface RoofAnnexesLayerDiagnostics {
  readonly annexCount: number;
  readonly boundCount: number;
  readonly volumeBuiltCount: number;
  readonly errors: readonly string[];
  readonly warnings: readonly string[];
}

export const ROOF_ANNEXES_CANONICAL_SCHEMA_ID = "roof-annexes-canonical-v1" as const;

export interface RoofAnnexesCanonicalBlock {
  readonly schemaId: typeof ROOF_ANNEXES_CANONICAL_SCHEMA_ID;
  readonly items: readonly CanonicalRoofAnnexItem[];
  readonly diagnostics: RoofAnnexesLayerDiagnostics;
}

export interface BuildingBlock {
  readonly buildingId: CanonicalHouseEntityId;
  readonly buildingFootprint: Polygon2DLocal;
  /** Sémantiquement identique ou affine à footprint selon produit. */
  readonly buildingOuterContour: Polygon2DLocal;
  /** Toujours 0 — convention ; détails dans heightModel. */
  readonly baseZ: 0;
  readonly wallTopContour?: readonly BuildingLocalVec3[];
  readonly wallHeightM?: number;
  readonly buildingShellRef?: string;
}

/** Bloc PV — emplacement réservé ; pas de moteur ici. */
export interface PvPanelInstance {
  readonly panelInstanceId: CanonicalHouseEntityId;
  readonly roofPatchId: CanonicalHouseEntityId;
  readonly mountPlaneRef: string;
  readonly panelLocalTransform: {
    readonly translation: BuildingLocalVec3;
    readonly rotationDegAroundMountNormal: number;
  };
  readonly orientationDeg?: number;
  readonly layoutMetadata?: Readonly<Record<string, unknown>>;
  readonly projection2dTraceId?: string;
}

export interface PvGroup {
  readonly groupId: CanonicalHouseEntityId;
  readonly panelInstanceIds: readonly CanonicalHouseEntityId[];
}

export interface PvBlock {
  readonly pvGroups: readonly PvGroup[];
  readonly pvPanels: readonly PvPanelInstance[];
}

export interface WorldPlacementBlock {
  readonly gpsLatLon?: Readonly<{ lat: number; lon: number }>;
  readonly northAngleDeg?: number;
  readonly metersPerPixel?: number;
  readonly imageSpaceOriginPolicy?: string;
}

export interface CanonicalHouseDocumentMetadata {
  readonly createdAtIso?: string;
  readonly generator?: string;
  readonly texturesRef?: readonly string[];
}

/**
 * Document racine du moteur Maison 3D.
 * Toutes les coordonnées géométriques du cœur sont en repère local bâtiment (m).
 */
export interface CanonicalHouseDocument {
  readonly schemaId: "canonical-house3d-model-v1";
  readonly building: BuildingBlock;
  readonly roof: RoofBlock;
  readonly heightModel: HeightModelBlock;
  readonly annexes: readonly AnnexDiscriminated[];
  /**
   * Couche annexes toiture 3D (binding pans + volumes) — produite par `buildCanonicalRoofAnnexesLayer3D`,
   * pas par le parseur runtime seul.
   */
  readonly roofAnnexes?: RoofAnnexesCanonicalBlock;
  /** Absent tant que la pose PV n’est pas importée — évite un sous-système parallèle plus tard. */
  readonly pv?: PvBlock;
  readonly worldPlacement?: WorldPlacementBlock;
  readonly metadata?: CanonicalHouseDocumentMetadata;
}

/** Marqueur de type pour futurs validateurs — pas de logique ici. */
export const CANONICAL_HOUSE_DOCUMENT_SCHEMA_ID = "canonical-house3d-model-v1" as const;
