/**
 * Smoke test : calcul avec résolution CSV (lead puis study).
 * Vérifie que buildSolarNextPayload injecte bien le CSV résolu et que le calc reçoit form.conso.csv_path.
 * Usage: node backend/scripts/smoke-calc-csv.js --org <uuid> --study <uuid> --version <num>
 * Ou:   ORG_ID=... STUDY_ID=... VERSION_ID=1 node backend/scripts/smoke-calc-csv.js
 */

import "../config/register-local-env.js";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { pool } = await import("../config/db.js");
const { resolveConsumptionCsv } = await import("../services/consumptionCsvResolver.service.js");
const { buildSolarNextPayload } = await import("../services/solarnextPayloadBuilder.service.js");
const { calculateSmartpitch } = await import("../controllers/calc.controller.js");

function parseArgs() {
  const args = process.argv.slice(2);
  let orgId = process.env.ORG_ID?.trim();
  let studyId = process.env.STUDY_ID?.trim();
  let versionId = process.env.VERSION_ID ? parseInt(process.env.VERSION_ID, 10) : null;
  for (let i = 0; i < args.length; i++) {
    if (args[i] === "--org" && args[i + 1]) orgId = args[++i].trim();
    else if (args[i] === "--study" && args[i + 1]) studyId = args[++i].trim();
    else if (args[i] === "--version" && args[i + 1]) versionId = parseInt(args[++i], 10);
  }
  return { orgId, studyId, versionId };
}

async function main() {
  const { orgId, studyId, versionId } = parseArgs();
  if (!orgId || !studyId || !versionId || isNaN(versionId)) {
    console.error("Usage: node backend/scripts/smoke-calc-csv.js --org <uuid> --study <uuid> --version <num>");
    process.exit(1);
  }

  const studyRes = await pool.query(
    "SELECT id, lead_id FROM studies WHERE id = $1 AND organization_id = $2 AND (archived_at IS NULL)",
    [studyId, orgId]
  );
  if (studyRes.rows.length === 0) {
    console.error("Study not found or not in org");
    process.exit(1);
  }
  const leadId = studyRes.rows[0].lead_id;

  console.log("1) Resolve CSV (lead then study)...");
  const resolved = await resolveConsumptionCsv({
    db: pool,
    organizationId: orgId,
    leadId,
    studyId,
  });

  console.log("   resolved.csvPath:", resolved.csvPath ?? "null");
  console.log("   resolved.reason:", resolved.reason);

  console.log("2) Build solarnext payload...");
  let payload;
  try {
    payload = await buildSolarNextPayload({ studyId, versionId, orgId });
  } catch (e) {
    console.error("buildSolarNextPayload failed:", e.message);
    process.exit(1);
  }

  const payloadCsvPath = payload?.consommation?.csv_path ?? null;
  console.log("   payload.consommation.csv_path:", payloadCsvPath ?? "null");

  if (resolved.csvPath && !payloadCsvPath) {
    console.error("FAIL: resolver returned csvPath but payload has no csv_path");
    process.exit(1);
  }
  if (resolved.csvPath && payloadCsvPath !== resolved.csvPath) {
    console.error("FAIL: payload csv_path differs from resolved path");
    process.exit(1);
  }

  console.log("3) Run calc (mock req/res)...");
  const mockReq = { body: { solarnext_payload: payload }, file: null };
  const captured = { done: false, data: null, statusCode: 200 };
  const mockRes = {
    status(code) {
      captured.statusCode = code;
      return mockRes;
    },
    json(data) {
      captured.data = data;
      captured.done = true;
    },
  };

  await calculateSmartpitch(mockReq, mockRes);

  if (!captured.done || captured.statusCode !== 200) {
    console.error("Calc failed:", captured.statusCode, captured.data?.error);
    process.exit(1);
  }

  const ctx = captured.data;
  const annualKwh = ctx?.conso?.annual_kwh;
  console.log("   conso.annual_kwh:", annualKwh);

  if (typeof annualKwh !== "number" || !Number.isFinite(annualKwh)) {
    console.error("FAIL: conso.annual_kwh not a finite number");
    process.exit(1);
  }

  if (resolved.csvPath) {
    console.log("OK: CSV résolu et injecté, annual_kwh calculé depuis CSV =", annualKwh.toFixed(1));
  } else {
    console.log("OK: Pas de CSV (source synthétique), annual_kwh =", annualKwh.toFixed(1));
  }
  await pool.end();
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
