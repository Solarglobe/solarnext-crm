/**
 * Phase 3 — Moteur de géométrie toiture (roofGeometryEngine).
 *
 * Exports publics :
 *   solveFace                   — RoofFace + WorldTransform + HeightResolver → RoofFaceDerived3D
 *   computeRoofFaceNormal       — normale Newell (Vec3)
 *   computeTiltAzimuth          — pente + azimut + axes (depuis normale)
 *   RuntimeHeightResolver       — HeightResolver branché sur CalpinageRuntime
 *   FallbackHeightResolver      — HeightResolver à hauteur constante (tests)
 *   buildConstraintHeightResolver — HeightResolver depuis ridges/traits (validatedRoofData)
 *
 * Dépendances : canonical3d/builder/* (pure TS geometry) + calpinageRuntime (RuntimeHeightResolver)
 * Zéro référence directe à window.* dans faceSolver, normalCalc, tiltAzimuthCalc, ridgeSolver.
 */

export { solveFace } from "./faceSolver";
export { computeRoofFaceNormal } from "./normalCalc";
export { computeTiltAzimuth } from "./tiltAzimuthCalc";
export type { TiltAzimuthResult } from "./tiltAzimuthCalc";
export { RuntimeHeightResolver, FallbackHeightResolver } from "./heightInterpolator";
export { buildConstraintHeightResolver, ConstraintHeightResolver } from "./ridgeSolver";
export type { StructuralConstraintLine } from "./ridgeSolver";
