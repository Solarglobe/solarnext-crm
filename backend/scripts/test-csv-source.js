/**
 * Test: source CSV lead et payload (validate-devis-technique).
 * Usage: LEAD_ID=uuid ORG_ID=uuid [STUDY_ID=uuid VERSION_ID=1] node backend/scripts/test-csv-source.js
 * Exit 0 si OK, 1 si csvPath existe mais hourly encore envoyé.
 */

import fs from "fs";
import { pool } from "../config/db.js";
import { resolveLeadConsumptionCsvPath } from "../services/leadConsumptionCsvPath.service.js";
import { buildSolarNextPayload } from "../services/solarnextPayloadBuilder.service.js";

const leadId = process.env.LEAD_ID?.trim();
const orgId = process.env.ORG_ID?.trim();
const studyId = process.env.STUDY_ID?.trim();
const versionId = process.env.VERSION_ID ? parseInt(process.env.VERSION_ID, 10) : 1;

async function main() {
  if (!leadId || !orgId) {
    console.error("LEAD_ID et ORG_ID requis");
    process.exit(1);
  }

  const csvPath = await resolveLeadConsumptionCsvPath({ db: pool, leadId, organizationId: orgId });
  const exists = csvPath ? fs.existsSync(csvPath) : false;

  console.log("csvPath trouvé:", csvPath ?? "null");
  console.log("fs.existsSync(csvPath):", exists);

  let payload = null;
  if (studyId && !isNaN(versionId) && versionId >= 1) {
    try {
      payload = await buildSolarNextPayload({ studyId, versionId: versionId, orgId });
    } catch (e) {
      console.warn("buildSolarNextPayload failed:", e.message);
    }
  } else {
    const r = await pool.query(
      "SELECT id FROM studies WHERE lead_id = $1 AND organization_id = $2 AND (archived_at IS NULL) AND (deleted_at IS NULL) LIMIT 1",
      [leadId, orgId]
    );
    if (r.rows.length > 0) {
      try {
        payload = await buildSolarNextPayload({
          studyId: r.rows[0].id,
          versionId: 1,
          orgId,
        });
      } catch (e) {
        console.warn("buildSolarNextPayload failed:", e.message);
      }
    }
  }

  if (payload) {
    console.log("payload.consommation.csv_path:", payload.consommation?.csv_path ?? "null");
    console.log("payload.consommation.hourly?.length:", payload.consommation?.hourly?.length ?? "undefined");
    const csvSet = payload.consommation?.csv_path;
    const hourlySet = payload.consommation?.hourly != null;
    if (csvSet && hourlySet) {
      console.error("FAIL: csv_path existe mais hourly est encore envoyé");
      process.exit(1);
    }
  }

  console.log("OK");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
