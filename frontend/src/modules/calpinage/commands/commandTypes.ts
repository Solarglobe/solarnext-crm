/**
 * CalpinageCommand — union discriminée de toutes les commandes du domaine Calpinage.
 *
 * Pattern Strangler Fig : chaque action utilisateur qui mutait directement
 * `window.CALPINAGE_STATE` devient une commande typée dispatchée sur le CommandBus.
 * Les handlers traduisent la commande en appels legacy jusqu'à ce que le sous-domaine
 * soit extrait en module TypeScript pur.
 *
 * Convention de nommage : VERBE_SUJET (impératif présent, snake_upper).
 * Chaque type doit rester sérialisable JSON (pas de classe, pas de référence DOM).
 */

import type { Vector3 } from "../canonical3d/types/primitives";

// ── Union discriminée ─────────────────────────────────────────────────────────

export type CalpinageCommand =
  /** Déplacement d'un panneau PV vers un nouveau bloc / position world. */
  | {
      readonly type: "MOVE_PV_PANEL";
      /** ID du panneau déplacé. */
      readonly panelId: string;
      /** ID du bloc PV cible après déplacement. */
      readonly newBlockId: string;
      /** Delta de déplacement en coordonnées world (mètres, convention SolarNext X=Est Y=Nord Z=Up). */
      readonly deltaWorld: Vector3;
    }
  /** Ajout d'un panneau PV sur un pan de toiture à une position world donnée. */
  | {
      readonly type: "ADD_PV_PANEL";
      /** ID de la surface de pan ciblée (`RoofPlanePatch3D.id`). */
      readonly panSurfaceId: string;
      /** Position de pose en coordonnées world. */
      readonly positionWorld: Vector3;
    }
  /** Suppression d'un panneau PV existant. */
  | {
      readonly type: "REMOVE_PV_PANEL";
      /** ID du panneau à supprimer. */
      readonly panelId: string;
    }
  /** Mutation de la hauteur (Z) d'un sommet de pan de toiture. */
  | {
      readonly type: "MOVE_ROOF_VERTEX_Z";
      /** ID stable du sommet (`vertexId` dans le modèle canonique). */
      readonly vertexId: string;
      /** Nouvelle hauteur en mètres (coordonnée Z world). */
      readonly newZ: number;
    }
  /** Mutation de la position XY d'un sommet de pan de toiture. */
  | {
      readonly type: "MOVE_ROOF_VERTEX_XY";
      /** ID stable du sommet. */
      readonly vertexId: string;
      /** Nouvelle position XY en coordonnées image px (convention CALPINAGE_STATE). */
      readonly newXY: { readonly x: number; readonly y: number };
    };

// ── Utilitaires de type ───────────────────────────────────────────────────────

/** Extrait un sous-type de commande par discriminant `type`. */
export type ExtractCommand<T extends CalpinageCommand["type"]> = Extract<
  CalpinageCommand,
  { type: T }
>;
