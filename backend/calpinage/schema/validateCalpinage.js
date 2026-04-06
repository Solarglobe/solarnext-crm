// ======================================================================
// Validation Calpinage — schema v1 (calpinage.v1.json)
// ======================================================================

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import Ajv from "ajv";
import addFormats from "ajv-formats";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const schemaPath = path.join(__dirname, "calpinage.v1.json");

const schema = JSON.parse(fs.readFileSync(schemaPath, "utf8"));
const ajv = new Ajv({ allErrors: true });
addFormats(ajv);
const validate = ajv.compile(schema);

/**
 * Valide data contre le schema Calpinage v1.
 * @throws {Error} err.statusCode = 400 si invalide
 */
export function validateCalpinage(data) {
  const ok = validate(data);
  if (!ok) {
    const msg = validate.errors
      .map((e) => `${e.instancePath} ${e.message}`)
      .join("; ");
    const err = new Error(`Calpinage schema invalid: ${msg}`);
    err.statusCode = 400;
    throw err;
  }
}
