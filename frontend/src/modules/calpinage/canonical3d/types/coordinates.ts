/**
 * Repères explicites — lecture obligatoire avant toute consommation du modèle.
 *
 * ─── WORLD (global) ───
 * Un seul repère cartésien droit pour tout `RoofModel3D` : défini par
 * `RoofModelMetadata.referenceFrame` (nom + `upAxis` unitaire).
 * - Toute position ou direction « monde » est en mètres dans ce repère.
 * - Le plan « horizontal » métier (empreinte, projection au sol) est le plan **orthogonal à `upAxis`**
 *   passant par l’origine du repère monde (l’origine absolue peut être arbitraire / site).
 * - `SurfaceMeasures.projectedHorizontalAreaM2` : aire dans ce plan horizontal (pas en UV pan).
 *
 * ─── LOCAL (LocalFrame3D) ───
 * Repère orthonormé direct attaché à une entité (pan, footprint…).
 * - `origin`, `xAxis`, `yAxis`, `zAxis` sont exprimés en **WORLD** (vecteurs base aux origines monde).
 * - Point local (u,v,w) : combinaison linéaire `origin + u*xAxis + v*yAxis + w*zAxis` (voir commentaires frame).
 *
 * ─── PLAN DU PAN (UV) ───
 * `Point2DInPlane` / `PlaneFrameUv2D` : coordonnées (u,v) dans le repère tangent du pan
 * (souvent aligné sur `localFrame.xAxis` / `localFrame.yAxis`), **pas** des coordonnées monde.
 *
 * Ce fichier n’importe pas le legacy calpinage (pixels image, etc.).
 *
 * Passage image px → plan horizontal monde (m) : `builder/worldMapping.ts` et
 * `core/worldConvention.ts` — documenté dans `docs/architecture/3d-world-convention.md`.
 */

import type { Vector3 } from "./primitives";

/**
 * Point ou vecteur translation en coordonnées **WORLD** (m).
 * Alias sémantique : même structure que `Vector3`, contrat de nommage renforcé.
 */
export type WorldPosition3D = Vector3;

/**
 * Vecteur direction en **WORLD** (m). Pour une direction **unitaire**, la validation exige ‖v‖≈1.
 */
export type WorldDirection3D = Vector3;

/**
 * Coordonnées 2D dans le **repère tangent du pan** (axes u,v du patch), en mètres.
 * Distinct de toute projection géographique East/North sauf si le builder l’a explicitement aligné.
 */
export type PlaneFrameUv2D = Readonly<{ readonly u: number; readonly v: number }>;
