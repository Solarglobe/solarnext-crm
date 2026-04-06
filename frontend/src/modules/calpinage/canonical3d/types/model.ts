/**
 * Modèle global toiture 3D canonique — racine du graphe géométrique.
 *
 * REPÈRE WORLD :
 * - Un seul repère cartésien droit pour tout le fichier (souvent ENU local tangent au site :
 *   X Est, Y Nord, Z up — **à documenter dans referenceFrame** si différent).
 *
 * Ce type ne suppose aucune reconstruction : le builder / solver le remplira plus tard.
 */

import type { Vector3 } from "./primitives";
import type { QualityBlock } from "./quality";
import type { RoofEdge3D } from "./edge";
import type { RoofExtension3D } from "./extension";
import type { RoofObstacle3D } from "./obstacle";
import type { RoofPlanePatch3D } from "./roof-surface";
import type { RoofRidge3D } from "./ridge";
import type { RoofVertex3D } from "./vertex";

/**
 * Repère monde unique pour tout le modèle.
 *
 * **Plan horizontal** (empreintes, `projectedHorizontalAreaM2`) : plan affine orthogonal à `upAxis`.
 * Ne pas confondre avec le plan tangent d’un pan (`LocalFrame3D`).
 */
export interface WorldReferenceFrame {
  readonly name: "ENU" | "NED" | "custom";
  /**
   * Si custom : origine monde en coordonnées projetées (ex. EPSG) — **sans** imposer un CRS ici.
   * Hypothèse : même unité que Vector3 (m) si numeric ; sinon chaîne descriptive.
   */
  readonly originDescription?: string;
  /** Vecteur « vertical modèle » unitaire dans WORLD (ex. {0,0,1} pour Z-up). Définit le « horizontal ». */
  readonly upAxis: Vector3;
  /**
   * Convention nommée (audit / interop). `ENU` usuel : X Est, Y Nord, Z up géographique.
   * Ne remplace pas la définition mathématique : les vecteurs du modèle suivent `upAxis` ci-dessus.
   */
  readonly axisConvention?: "ENU_Z_UP" | "NED" | "custom";
}

export interface RoofModelMetadata {
  /**
   * Version du schéma TypeScript / JSON (ex. "1.0.0").
   * Distinct de toute version d’application CRM.
   */
  readonly schemaVersion: string;
  /** Horodatage ISO 8601 de génération du modèle. */
  readonly createdAt: string;
  /** Source de reconstruction prévue ou utilisée (texte stable pour audit). */
  readonly reconstructionSource: "pending" | "from_legacy_2d" | "from_solver" | "import" | "manual";
  readonly units: {
    readonly length: "m";
    readonly angle: "deg";
  };
  readonly referenceFrame: WorldReferenceFrame;
  /** Référence optionnelle au site (ex. identifiant étude) — pas de logique runtime. */
  readonly studyRef?: string;
}

export interface RoofModel3D {
  readonly metadata: RoofModelMetadata;
  /** Sommets topologiques 3D (WORLD). */
  readonly roofVertices: readonly RoofVertex3D[];
  /**
   * Segments entre sommets — **arêtes du maillage** ou guides ; distinguer via `purpose`.
   * Ce ne sont pas des « traits de dessin 2D » : ce sont des entités résolues en WORLD.
   */
  readonly roofEdges: readonly RoofEdge3D[];
  /**
   * Lignes structurantes (faîtage, noue…) : polyligne d’**IDs d’arêtes** déjà présentes dans `roofEdges`.
   * Une ridge référence des arêtes ; la réciproque optionnelle est `RoofEdge3D.ridgeLineId`.
   */
  readonly roofRidges: readonly RoofRidge3D[];
  /** Faces planaires du modèle — coque principale, dérivées, extensions selon `topologyRole`. */
  readonly roofPlanePatches: readonly RoofPlanePatch3D[];
  readonly roofObstacles: readonly RoofObstacle3D[];
  readonly roofExtensions: readonly RoofExtension3D[];
  readonly globalQuality: QualityBlock;
}
