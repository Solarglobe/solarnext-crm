/**
 * shared/schemas/index.ts — Barrel export des schemas Zod canoniques SolarNext.
 *
 * Importer depuis le frontend :
 *   import { CreateLeadSchema, LeadResponse } from "@shared/schemas";
 *   import { SCHEMA_VERSION } from "@shared/schemas/version";
 *
 * @module shared/schemas
 */

// Version des contrats
export { SCHEMA_VERSION, SCHEMA_ENTITIES } from "./version";
export type { SchemaEntity } from "./version";

// Geometrie
export * from "./geometry.schema";

// Scenarios energetiques & financiers
export * from "./scenario.schema";

// CRM
export * from "./lead.schema";
export * from "./study.schema";
export * from "./quote.schema";
export * from "./invoice.schema";
