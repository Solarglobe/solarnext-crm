/**
 * backend/lib/schemas/index.js — Barrel des schémas Zod backend.
 *
 * Ces schémas sont la version JS runtime des schémas TypeScript de shared/schemas/.
 * Ils sont utilisés exclusivement par le middleware validate() côté serveur.
 *
 * Note de migration : lorsqu'un build step TypeScript sera ajouté au backend,
 * ces fichiers pourront être remplacés par des imports directs depuis
 * ../../shared/schemas/ sans changer l'interface du middleware validate().
 *
 * Usage :
 *   import { CreateLeadSchema, LeadListQuerySchema } from "../../lib/schemas/index.js";
 *   import { GeometryCalculationSchema } from "../../lib/schemas/index.js";
 */

export * from "./geometry.schema.js";
export * from "./lead.schema.js";
export * from "./quote.schema.js";
export * from "./study.schema.js";
