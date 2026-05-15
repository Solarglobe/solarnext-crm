/**
 * domains/studies/index.js — Domaine Etudes PV.
 *
 * Sous-domaines :
 *   geometry/  → Moteur géométrique (production, PVGIS, ombrage)
 *   financial/ → Moteur financier (scenarios, batteries, finance)
 *
 * Le router HTTP des études reste dans domains/studies/studies.router.js
 * (TODO Phase 3 — migrer depuis routes/studies.routes.js).
 */

// Re-export des moteurs pour tests
export * from "./geometry/index.js";
// export * from "./financial/index.js"; // Phase 5
