/**
 * Test E2E : resolveConsumptionCsv trouve un document CSV inséré en DB + loadConsumption utilise bien la source CSV.
 * Prérequis : DATABASE_URL (.env.dev ou .env), ORG_ID et LEAD_ID (UUID d'une org et d'un lead existants).
 * Usage : node backend/tests/consumptionCsvResolver.e2e.test.js
 *         ou ORG_ID=xxx LEAD_ID=xxx node backend/tests/consumptionCsvResolver.e2e.test.js
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

import fs from "fs";
import { randomUUID } from "crypto";
const { pool } = await import("../config/db.js");
const { resolveConsumptionCsv } = await import("../services/consumptionCsvResolver.service.js");
const { loadConsumption } = await import("../services/consumptionService.js");

const STORAGE_ROOT = path.join(__dirname, "..", "storage");

function buildHourlyCsvContent() {
  const lines = ["startdate,powerinwatts"];
  const baseDate = new Date("2024-01-01T00:00:00Z");
  for (let h = 0; h < 8760; h++) {
    const d = new Date(baseDate.getTime() + h * 3600 * 1000);
    const iso = d.toISOString();
    const w = 1000 + (h % 500);
    lines.push(`${iso},${w}`);
  }
  return lines.join("\n");
}

async function run() {
  const orgId = process.env.ORG_ID?.trim();
  const leadId = process.env.LEAD_ID?.trim();
  if (!orgId || !leadId) {
    console.warn("SKIP consumptionCsvResolver.e2e.test: ORG_ID et LEAD_ID requis");
    process.exit(0);
  }

  const fileName = `${randomUUID()}_conso_test.csv`;
  const storageKey = [orgId, "lead", leadId, fileName].join("/");
  const absolutePath = path.join(STORAGE_ROOT, storageKey.replace(/\//g, path.sep));

  let insertedId = null;

  try {
    await fs.promises.mkdir(path.dirname(absolutePath), { recursive: true });
    await fs.promises.writeFile(absolutePath, buildHourlyCsvContent(), "utf8");

    const ins = await pool.query(
      `INSERT INTO entity_documents
       (organization_id, entity_type, entity_id, file_name, file_size, mime_type, storage_key, url, uploaded_by, document_type)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
       RETURNING id`,
      [orgId, "lead", leadId, "conso_test.csv", 500000, "text/csv", storageKey, "local", null, "consumption_csv"]
    );
    insertedId = ins.rows[0].id;

    const resolved = await resolveConsumptionCsv({
      db: pool,
      organizationId: orgId,
      leadId,
      studyId: null,
    });

    if (!resolved.csvPath) {
      throw new Error("resolveConsumptionCsv doit retourner csvPath non null (got " + JSON.stringify(resolved) + ")");
    }

    const conso = loadConsumption({}, resolved.csvPath, {});
    if (!Array.isArray(conso.hourly) || conso.hourly.length !== 8760) {
      throw new Error("loadConsumption doit retourner hourly.length === 8760 (got " + (conso.hourly?.length ?? "null") + ")");
    }
    if (typeof conso.annual_kwh !== "number" || !Number.isFinite(conso.annual_kwh)) {
      throw new Error("loadConsumption doit retourner annual_kwh nombre fini (got " + conso.annual_kwh + ")");
    }

    console.log("OK resolveConsumptionCsv → csvPath présent, loadConsumption → 8760 rows, annual_kwh =", conso.annual_kwh.toFixed(1));
  } finally {
    if (insertedId) {
      await pool.query("DELETE FROM entity_documents WHERE id = $1", [insertedId]);
    }
    try {
      if (absolutePath && fs.existsSync(absolutePath)) {
        fs.unlinkSync(absolutePath);
      }
    } catch (_) {}
  }

  await pool.end();
  process.exit(0);
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
