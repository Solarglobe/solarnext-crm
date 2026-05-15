/**
 * generate-snapshots-to.mts
 * Usage: npx tsx generate-snapshots-to.mts <outputDir>
 *
 * Meme logique que generate-snapshots.mts mais ecrit dans le repertoire passe en argument.
 * Utilise par check-breaking.mts pour generer un snapshot temporaire sans ecraser les fichiers commites.
 */

import { toJSONSchema } from "zod";
import { writeFileSync, mkdirSync } from "fs";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";

import { SCHEMA_VERSION } from "../version.js";
import { LeadResponseSchema } from "../lead.schema.js";
import { StudyResponseSchema } from "../study.schema.js";
import { QuoteResponseSchema } from "../quote.schema.js";
import { InvoiceResponseSchema } from "../invoice.schema.js";
import { EnergyScenarioSchema, FinancialSnapshotSchema } from "../scenario.schema.js";
import { RoofPolygonSchema, PanelLayoutSchema, ShadingResultSchema } from "../geometry.schema.js";

const __filename = fileURLToPath(import.meta.url);

const outputDir = process.argv[2];
if (!outputDir) {
  console.error("Usage: npx tsx generate-snapshots-to.mts <outputDir>");
  process.exit(1);
}

const SCHEMAS = {
  lead: { LeadResponse: LeadResponseSchema },
  study: { StudyResponse: StudyResponseSchema },
  quote: { QuoteResponse: QuoteResponseSchema },
  invoice: { InvoiceResponse: InvoiceResponseSchema },
  scenario: { EnergyScenario: EnergyScenarioSchema, FinancialSnapshot: FinancialSnapshotSchema },
  geometry: { RoofPolygon: RoofPolygonSchema, PanelLayout: PanelLayoutSchema, ShadingResult: ShadingResultSchema },
} as const;

mkdirSync(outputDir, { recursive: true });

for (const [entity, entitySchemas] of Object.entries(SCHEMAS)) {
  const snapshot: Record<string, unknown> = {
    _meta: { version: SCHEMA_VERSION, entity, generatedAt: new Date().toISOString().slice(0, 10) },
    schemas: {},
  };
  for (const [schemaName, schema] of Object.entries(entitySchemas)) {
    (snapshot.schemas as Record<string, unknown>)[schemaName] =
      toJSONSchema(schema as Parameters<typeof toJSONSchema>[0]);
  }
  writeFileSync(resolve(outputDir, `${entity}.json`), JSON.stringify(snapshot, null, 2) + "\n", "utf-8");
}

console.log("Snapshots generated to", outputDir);
