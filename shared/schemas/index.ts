/**
 * shared/schemas/index.ts — Barrel export des schémas Zod canoniques SolarNext.
 *
 * Importer depuis le frontend :
 *   import { CreateLeadSchema, LeadResponse } from "@shared/schemas";
 *   import { VirtualBatteryConfigSchema } from "@shared/schemas/scenario.schema";
 *
 * @module shared/schemas
 */

// Géométrie
export * from "./geometry.schema";

// Scénarios énergétiques & financiers
export * from "./scenario.schema";

// CRM
export * from "./lead.schema";
export * from "./study.schema";
export * from "./quote.schema";
export * from "./invoice.schema";
