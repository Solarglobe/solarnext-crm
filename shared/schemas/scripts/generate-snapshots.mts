/**
 * generate-snapshots.mts
 * Usage (from repo root) : cd frontend && npx tsx ../shared/schemas/scripts/generate-snapshots.mts
 *
 * Genere un snapshot JSON Schema 2020-12 pour chaque schema *Response* et le serialise
 * dans shared/schemas/snapshots/<entity>.json.
 * Ces fichiers sont commites dans le depot et servent de reference pour la detection
 * de breaking changes en CI.
 */

import { toJSONSchema } from "zod";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { SCHEMA_VERSION } from "../version.js";

// Response schemas = contrat expose par l'API
import { LeadResponseSchema } from "../lead.schema.js";
import { StudyResponseSchema } from "../study.schema.js";
import { QuoteResponseSchema } from "../quote.schema.js";
import { InvoiceResponseSchema } from "../invoice.schema.js";
import { EnergyScenarioSchema, FinancialSnapshotSchema } from "../scenario.schema.js";
import {
  RoofPolygonSchema,
  PanelLayoutSchema,
  ShadingResultSchema,
} from "../geometry.schema.js";

// ---------------------------------------------------------------------------
// Catalogue des schemas a snapshotter
// ---------------------------------------------------------------------------

const SCHEMAS = {
  lead: {
    LeadResponse: LeadResponseSchema,
  },
  study: {
    StudyResponse: StudyResponseSchema,
  },
  quote: {
    QuoteResponse: QuoteResponseSchema,
  },
  invoice: {
    InvoiceResponse: InvoiceResponseSchema,
  },
  scenario: {
    EnergyScenario: EnergyScenarioSchema,
    FinancialSnapshot: FinancialSnapshotSchema,
  },
  geometry: {
    RoofPolygon: RoofPolygonSchema,
    PanelLayout: PanelLayoutSchema,
    ShadingResult: ShadingResultSchema,
  },
} as const;

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const snapshotsDir = resolve(__dirname, "../snapshots");

mkdirSync(snapshotsDir, { recursive: true });

let totalSchemas = 0;
const errors: string[] = [];

for (const [entity, entitySchemas] of Object.entries(SCHEMAS)) {
  const snapshot: Record<string, unknown> = {
    _meta: {
      version: SCHEMA_VERSION,
      entity,
      generatedAt: new Date().toISOString().slice(0, 10),
      generator: "shared/schemas/scripts/generate-snapshots.mts",
    },
    schemas: {},
  };

  for (const [schemaName, schema] of Object.entries(entitySchemas)) {
    try {
      const jsonSchema = toJSONSchema(schema as Parameters<typeof toJSONSchema>[0]);
      (snapshot.schemas as Record<string, unknown>)[schemaName] = jsonSchema;
      totalSchemas++;
    } catch (err) {
      const msg = `ERROR: ${entity}.${schemaName}: ${(err as Error).message}`;
      errors.push(msg);
      console.error(msg);
    }
  }

  const outPath = resolve(snapshotsDir, `${entity}.json`);
  writeFileSync(outPath, JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
  console.log(`[snapshot] ${entity}.json (${Object.keys(entitySchemas).length} schema(s))`);
}

console.log(`\nDone: ${totalSchemas} schemas snapshotted.`);

if (errors.length > 0) {
  console.error(`\n${errors.length} error(s) encountered:`);
  errors.forEach((e) => console.error("  " + e));
  process.exit(1);
}
